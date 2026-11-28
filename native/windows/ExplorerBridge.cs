// Windows Explorer selection and keyboard integration for QuickLook Fast.
// The preview and file decoding live in the Electron renderer.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class ExplorerBridge
{
    private const int WhKeyboardLl = 13;
    private const int WhMouseLl = 14;
    private const int WmLButtonDown = 0x0201;
    private const int WmKeyDown = 0x0100;
    private const int WmKeyUp = 0x0101;
    private const int VkSpace = 0x20;
    private const int VkControl = 0x11;
    private const int VkShift = 0x10;
    private const int VkAlt = 0x12;
    private const int VkLeftWindows = 0x5B;
    private const int VkRightWindows = 0x5C;
    private const int Injected = 0x10;

    private static readonly object Gate = new object();
    private static readonly AutoResetEvent Wake = new AutoResetEvent(false);
    private static readonly HookProc KeyboardCallback = KeyboardHook;
    private static readonly HookProc MouseCallback = MouseHook;
    private static IntPtr hook;
    private static IntPtr mouseHook;
    private static IntPtr lastClickedWindow;
    private static IntPtr lastClickedLister;
    private static int lastClickAt;
    private static IntPtr lastSelectionWindow;
    private static int lastSelectionAt;
    private static KeyboardRecovery hookRecovery;
    private static readonly SelectionCache CachedSelection = new SelectionCache();
    private static readonly PreviewRequestTracker Requests = new PreviewRequestTracker();
    private static bool swallowedSpace;
    private static int swallowedAt;
    private static int parentProcessId;
    private static SourceContext source;
    private static readonly Queue<Navigation> NavigationQueue = new Queue<Navigation>();
    private static readonly Queue<PreviewRequest> PreviewQueue = new Queue<PreviewRequest>();
    private static string pendingStatus;

    private sealed class SourceContext
    {
        internal IntPtr Window;
        internal IntPtr Focus;
        internal string Kind;
        internal string Runtime;
        internal string Id;
        internal string Path;
    }

    private sealed class Navigation
    {
        internal string Key;
        internal string SourceId;
    }

    private sealed class PreviewRequest
    {
        internal IntPtr Window;
        internal IntPtr Focus;
        internal string Kind;
        internal long Timestamp;
        internal PreviewRequestTracker.Ticket Ticket;
    }

    [STAThread]
    private static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        if (args.Length != 1) return 1;
        int parentId;
        if (!Int32.TryParse(args[0], out parentId)) return 1;
        parentProcessId = parentId;

        Thread selectionThread = new Thread(MonitorSelection);
        selectionThread.IsBackground = true;
        selectionThread.SetApartmentState(ApartmentState.STA);
        selectionThread.Start();

        Thread parentThread = new Thread(delegate() { WatchParent(parentId); });
        parentThread.IsBackground = true;
        parentThread.Start();

        Thread inputThread = new Thread(ReadCommands);
        inputThread.IsBackground = true;
        inputThread.Start();

        hook = SetWindowsHookEx(WhKeyboardLl, KeyboardCallback, GetModuleHandle(null), 0);
        if (hook == IntPtr.Zero)
        {
            Console.Error.WriteLine("无法安装键盘钩子，错误码 " + Marshal.GetLastWin32Error());
            return 1;
        }
        // Optional: remember only the last clicked window briefly so a click
        // immediately followed by Space can target the correct Opus pane.
        mouseHook = SetWindowsHookEx(WhMouseLl, MouseCallback, GetModuleHandle(null), 0);
        try
        {
            hookRecovery = new KeyboardRecovery(RepairKeyboardHook);
            if (!hookRecovery.Start()) { hookRecovery.Dispose(); hookRecovery = null; }
        }
        catch (Exception) { if (hookRecovery != null) hookRecovery.Dispose(); hookRecovery = null; }
        Console.WriteLine("{\"type\":\"ready\",\"recovery\":" + (hookRecovery == null ? "false" : "true") + "}");
        Console.Out.Flush();

        try
        {
            Application.Run();
        }
        finally
        {
            if (hookRecovery != null) hookRecovery.Dispose();
            UnhookWindowsHookEx(hook);
            if (mouseHook != IntPtr.Zero) UnhookWindowsHookEx(mouseHook);
        }
        return 0;
    }

    private static void ReadCommands()
    {
        JavaScriptSerializer json = new JavaScriptSerializer();
        string line;
        while ((line = Console.ReadLine()) != null)
        {
            try
            {
                Dictionary<string, object> command = json.Deserialize<Dictionary<string, object>>(line);
                string type = command.ContainsKey("type") ? command["type"] as string : null;
                if (type == "pin" || type == "raise")
                {
                    long value;
                    string handle = command.ContainsKey("handle") ? command["handle"] as string : null;
                    if (Int64.TryParse(handle, out value) && command.ContainsKey("enabled") && command["enabled"] is bool)
                    {
                        IntPtr window = new IntPtr(value);
                        uint owner;
                        GetWindowOwnerProcessId(window, out owner);
                        if (owner == parentProcessId && IsWindow(window))
                        {
                            bool keepOnTop = (bool)command["enabled"];
                            const uint flags = 0x0001 | 0x0002 | 0x0010 | 0x0200; // no resize, move, activation or owner z-order
                            if (type == "raise") SetWindowPos(window, new IntPtr(-1), 0, 0, 0, 0, flags);
                            if (type == "pin" || !keepOnTop)
                                SetWindowPos(window, new IntPtr(keepOnTop ? -1 : -2), 0, 0, 0, 0, flags);
                        }
                    }
                    continue;
                }
                SourceContext restore = null;
                lock (Gate)
                {
                    if (type == "forget")
                    {
                        string requestedSourceId = command.ContainsKey("sourceId") ? command["sourceId"] as string : null;
                        bool matchesSource = String.IsNullOrEmpty(requestedSourceId) || (source != null && source.Id == requestedSourceId);
                        if (matchesSource && source != null && source.Kind != "dopus")
                        {
                            CachedSelection.Remember(source.Window, source.Path, Environment.TickCount);
                        }
                        if (matchesSource && command.ContainsKey("restoreFocus") && command["restoreFocus"] is bool && (bool)command["restoreFocus"])
                            restore = source;
                        if (matchesSource) { source = null; NavigationQueue.Clear(); }
                    }
                    if (type == "navigate" && command.ContainsKey("key") && command.ContainsKey("sourceId"))
                    {
                        string key = command["key"] as string;
                        string id = command["sourceId"] as string;
                        if (source != null && source.Id == id && (key == "ArrowUp" || key == "ArrowDown" || key == "ArrowLeft" || key == "ArrowRight") && NavigationQueue.Count < 32)
                            NavigationQueue.Enqueue(new Navigation { Key = key, SourceId = id });
                    }
                }
                if (restore != null) RestoreSourceFocus(restore);
                Wake.Set();
            }
            catch (Exception) { }
        }
    }

    private static void WatchParent(int parentId)
    {
        try
        {
            using (Process parent = Process.GetProcessById(parentId)) parent.WaitForExit();
            Environment.Exit(0);
        }
        catch (ArgumentException) { Environment.Exit(0); }
        catch (InvalidOperationException) { Environment.Exit(0); }
        catch (System.ComponentModel.Win32Exception error) { Console.Error.WriteLine(error.Message); }
    }

    private static IntPtr KeyboardHook(int code, IntPtr message, IntPtr data)
    {
        if (code < 0) return CallNextHookEx(hook, code, message, data);
        if (hookRecovery != null) hookRecovery.SawHookEvent();
        KeyboardEvent key = (KeyboardEvent)Marshal.PtrToStructure(data, typeof(KeyboardEvent));
        if ((key.Flags & Injected) == 0 && message.ToInt32() == WmKeyUp && key.VirtualKey >= 0x25 && key.VirtualKey <= 0x28)
        {
            lock (Gate)
            {
                Requests.SelectionInput();
                lastSelectionWindow = GetForegroundWindow();
                lastSelectionAt = Environment.TickCount;
                if (source != null && source.Kind == "dopus" && GetForegroundWindow() == source.Window && NavigationQueue.Count < 32)
                {
                    NavigationQueue.Enqueue(new Navigation { Key = "observe", SourceId = source.Id });
                    Wake.Set();
                }
            }
        }
        if (key.VirtualKey != VkSpace || (key.Flags & Injected) != 0)
            return CallNextHookEx(hook, code, message, data);

        int kind = message.ToInt32();
        if (SelectionCache.IsSpaceRelease(kind) && swallowedSpace)
        {
            swallowedSpace = false;
            return new IntPtr(1);
        }
        if (kind != WmKeyDown) return CallNextHookEx(hook, code, message, data);
        if (SelectionCache.ShouldClearStuckSpace(swallowedSpace, GetAsyncKeyState(VkSpace), unchecked(Environment.TickCount - swallowedAt))) swallowedSpace = false;
        if (swallowedSpace) return new IntPtr(1);
        if (ModifierDown()) return CallNextHookEx(hook, code, message, data);

        string focusFailure;
        SourceContext foreground = GetFocusedSource(out focusFailure);
        if (foreground == null)
        {
            if (focusFailure != null && ClassName(GetForegroundWindow()).Equals("dopus.lister", StringComparison.OrdinalIgnoreCase))
            {
                lock (Gate) { pendingStatus = "DOpus：" + focusFailure; }
                Wake.Set();
            }
            return CallNextHookEx(hook, code, message, data);
        }
        lock (Gate)
        {
            // A key can arrive between the window hiding and the input thread
            // refreshing its cache. The still-live source covers that short gap.
            bool sameSource = source != null && SelectionCache.MatchesSource(foreground.Window, foreground.Focus, foreground.Kind,
                source.Window, source.Focus, source.Kind, source.Path);
            if (!CachedSelection.CanIntercept(foreground.Window, foreground.Kind, Environment.TickCount) && !sameSource)
                return CallNextHookEx(hook, code, message, data);
            if (PreviewQueue.Count >= 64) return CallNextHookEx(hook, code, message, data);
            PreviewQueue.Enqueue(new PreviewRequest { Window = foreground.Window, Focus = foreground.Focus, Kind = foreground.Kind,
                Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), Ticket = Requests.Issue(foreground.Window, foreground.Focus, foreground.Kind) });
        }
        swallowedSpace = true;
        swallowedAt = Environment.TickCount;
        Wake.Set();
        return new IntPtr(1);
    }

    private static IntPtr MouseHook(int code, IntPtr message, IntPtr data)
    {
        if (code >= 0 && message.ToInt32() == WmLButtonDown)
        {
            MouseEvent mouse = (MouseEvent)Marshal.PtrToStructure(data, typeof(MouseEvent));
            if ((mouse.Flags & 1) == 0)
            {
                IntPtr clicked = WindowFromPoint(mouse.Position);
                IntPtr lister = GetAncestor(clicked, 2);
                lock (Gate)
                {
                    lastClickedWindow = clicked;
                    lastClickedLister = lister;
                    lastClickAt = Environment.TickCount;
                    lastSelectionWindow = lister;
                    lastSelectionAt = lastClickAt;
                    Requests.SelectionInput();
                }
            }
        }
        return CallNextHookEx(mouseHook, code, message, data);
    }

    private static bool RepairKeyboardHook()
    {
        IntPtr replacement = SetWindowsHookEx(WhKeyboardLl, KeyboardCallback, GetModuleHandle(null), 0);
        if (replacement == IntPtr.Zero) return false;
        IntPtr previous = hook;
        hook = replacement;
        swallowedSpace = false;
        if (previous != IntPtr.Zero) UnhookWindowsHookEx(previous);
        lock (Gate) { pendingStatus = "键盘监听已自动恢复"; }
        Wake.Set();
        return true;
    }

    private static bool ModifierDown()
    {
        return (GetAsyncKeyState(VkControl) & 0x8000) != 0 ||
            (GetAsyncKeyState(VkShift) & 0x8000) != 0 ||
            (GetAsyncKeyState(VkAlt) & 0x8000) != 0 ||
            (GetAsyncKeyState(VkLeftWindows) & 0x8000) != 0 ||
            (GetAsyncKeyState(VkRightWindows) & 0x8000) != 0;
    }

    private static SourceContext GetFocusedSource()
    {
        string ignored;
        return GetFocusedSource(out ignored);
    }

    private static SourceContext GetFocusedSource(out string failure)
    {
        failure = null;
        IntPtr foreground = GetForegroundWindow();
        string windowClass = ClassName(foreground);
        string kind = windowClass == "CabinetWClass" || windowClass == "ExploreWClass" ? "explorer" :
            windowClass == "Progman" || windowClass == "WorkerW" ? "desktop" :
            windowClass.Equals("dopus.lister", StringComparison.OrdinalIgnoreCase) ? "dopus" : null;
        if (kind == null) return null;
        if (kind == "desktop" && FindWindowEx(foreground, IntPtr.Zero, "SHELLDLL_DefView", null) == IntPtr.Zero) return null;
        uint thread = GetWindowThreadProcessId(foreground, IntPtr.Zero);
        GuiThreadInfo info = new GuiThreadInfo();
        info.Size = Marshal.SizeOf(typeof(GuiThreadInfo));
        if (!GetGUIThreadInfo(thread, ref info)) { if (kind == "dopus") failure = "无法读取当前焦点"; return null; }
        if (info.MenuOwner != IntPtr.Zero) { if (kind == "dopus") failure = "菜单打开时不接管空格"; return null; }
        IntPtr focused = kind == "dopus" ? SelectionCache.EffectiveDopusFocus(foreground, info.Focus, info.Caret) : info.Focus;
        int clickAge = unchecked(Environment.TickCount - lastClickAt);
        if (kind == "dopus" && clickAge >= 0 && clickAge <= 350 && lastClickedLister == foreground &&
            IsChild(foreground, lastClickedWindow) && IsDopusFileDisplay(lastClickedWindow, foreground)) focused = lastClickedWindow;
        string focusedClass = ClassName(focused);
        if (SelectionCache.IsTextInputClass(focusedClass)) { if (kind == "dopus") failure = "焦点在文本输入框"; return null; }
        bool dopusFileDisplay = kind == "dopus" && (focused == foreground || IsDopusFileDisplay(focused, foreground));
        // Opus uses several custom file-display classes (including in other
        // Listers). Unknown focused children can still be file lists; reject
        // known auxiliary controls and text carets instead of a strict list.
        if (kind == "dopus" && !dopusFileDisplay && (focused == IntPtr.Zero || !IsChild(foreground, focused) ||
            info.Caret != IntPtr.Zero || SelectionCache.IsDopusAuxiliaryClass(focusedClass))) { failure = "焦点不在文件列表"; return null; }
        // Opus can use a caret in its custom file list even when no text is
        // being edited. Do not confuse that with a filename or search editor.
        if (info.Caret != IntPtr.Zero && !(dopusFileDisplay && (info.Caret == foreground || IsDopusFileDisplay(info.Caret, foreground)) &&
            !SelectionCache.IsTextInputClass(ClassName(info.Caret)))) { if (kind == "dopus") failure = "检测到文本输入光标"; return null; }
        if (kind != "dopus" && focusedClass != "DirectUIHWND" && focusedClass != "SysListView32") return null;
        return new SourceContext { Window = foreground, Focus = focused, Kind = kind };
    }

    private static bool IsDopusFileDisplay(IntPtr window, IntPtr lister)
    {
        for (int i = 0; i < 24 && window != IntPtr.Zero && window != lister; i++, window = GetParent(window))
            if (SelectionCache.IsDopusFileDisplayClass(ClassName(window))) return true;
        return false;
    }

    private static string ClassName(IntPtr window)
    {
        if (window == IntPtr.Zero) return "";
        StringBuilder name = new StringBuilder(256);
        GetClassName(window, name, name.Capacity);
        return name.ToString();
    }

    private static void MonitorSelection()
    {
        object shell = null;
        try
        {
            Type shellType = Type.GetTypeFromProgID("Shell.Application");
            shell = Activator.CreateInstance(shellType);
            JavaScriptSerializer json = new JavaScriptSerializer();
            while (true)
            {
                PreviewRequest requested = null;
                Navigation navigation = null;
                SourceContext navigationSource = null;
                string status;
                long previewSerial;
                lock (Gate)
                {
                    status = pendingStatus;
                    pendingStatus = null;
                    if (PreviewQueue.Count > 0) requested = PreviewQueue.Dequeue();
                    else if (NavigationQueue.Count > 0)
                    {
                        navigation = NavigationQueue.Dequeue();
                        if (source != null && source.Id == navigation.SourceId) navigationSource = source;
                    }
                    previewSerial = Requests.LatestSerial;
                }
                if (status != null)
                {
                    Console.WriteLine(json.Serialize(new { type = "status", message = status }));
                    Console.Out.Flush();
                }
                // A physical Space request has priority over background follows.
                // Otherwise a follow can change the current path just before the
                // same Space is interpreted as a toggle and close the preview.
                if (requested != null)
                {
                    ProcessPreviewRequest(shell, requested, json);
                    continue;
                }
                if (navigation != null && navigationSource != null)
                    NavigateSelection(shell, navigationSource, navigation, json, previewSerial);

                SourceContext foreground = GetFocusedSource();
                string selected = foreground == null || foreground.Kind == "dopus" ? null : GetSelectedFile(shell, foreground);
                lock (Gate)
                {
                    // The preview itself becomes foreground while open. Keep the
                    // last shell selection until the source can be sampled again.
                    CachedSelection.Sample(foreground == null ? IntPtr.Zero : foreground.Window, foreground == null ? null : foreground.Kind, selected, Environment.TickCount);
                }
                // Follow a selection made directly in Explorer or on the desktop
                // while the preview is already open, without stealing focus.
                if (foreground != null && selected != null && foreground.Kind != "dopus")
                {
                    string sourceId = null;
                    lock (Gate)
                    {
                        if (Requests.LatestSerial == previewSerial && source != null && source.Window == foreground.Window && source.Focus == foreground.Focus &&
                            !String.Equals(source.Path, selected, StringComparison.OrdinalIgnoreCase))
                        {
                            source.Path = selected;
                            sourceId = source.Id;
                        }
                    }
                    if (sourceId != null)
                    {
                        Console.WriteLine(json.Serialize(new { type = "selection", path = selected, timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), sourceId = sourceId }));
                        Console.Out.Flush();
                    }
                }
                bool pending;
                lock (Gate) { pending = PreviewQueue.Count > 0 || NavigationQueue.Count > 0; }
                if (!pending) Wake.WaitOne(80);
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            Environment.Exit(1);
        }
        finally
        {
            Release(shell);
        }
    }

    private static PreviewRequestTracker.Decision CheckPreviewRequest(PreviewRequest request, SourceContext foreground)
    {
        if (!IsWindow(request.Window) || !IsWindow(request.Focus) || foreground == null) return PreviewRequestTracker.Decision.Discard;
        IntPtr focus = foreground.Focus;
        // Opus may report the clicked child first and its file-display parent
        // after the click settles. Both identify the same pane.
        if (request.Kind == "dopus" && foreground.Window == request.Window &&
            (IsChild(request.Focus, focus) || IsChild(focus, request.Focus))) focus = request.Focus;
        return Requests.Check(request.Ticket, foreground.Window, focus, foreground.Kind);
    }

    private static void ProcessPreviewRequest(object shell, PreviewRequest request, JavaScriptSerializer json)
    {
        // One retry covers a selection change that occurred during a slow read.
        // Repeated changes or a newer Space request make this result obsolete.
        for (int attempt = 0; attempt < 2; attempt++)
        {
            SourceContext foreground = GetFocusedSource();
            PreviewRequestTracker.Decision before;
            int remaining = 0;
            lock (Gate)
            {
                before = CheckPreviewRequest(request, foreground);
                if (before == PreviewRequestTracker.Decision.Retry) Requests.Refresh(request.Ticket);
                int age = unchecked(Environment.TickCount - lastSelectionAt);
                if (lastSelectionWindow == request.Window && age >= 0 && age < 70) remaining = 70 - age;
            }
            if (before == PreviewRequestTracker.Decision.Discard) return;
            if (remaining > 0) Thread.Sleep(remaining);

            string runtime = null;
            string selected;
            if (request.Kind == "dopus")
            {
                runtime = DopusSelection.FindRuntime(request.Window);
                DopusSelection.Selection result = DopusSelection.Query(runtime, request.Window, request.Focus);
                selected = result == null ? null : result.Path;
            }
            else selected = GetSelectedFile(shell, new SourceContext { Window = request.Window, Focus = request.Focus, Kind = request.Kind });

            foreground = GetFocusedSource();
            PreviewRequestTracker.Decision after;
            SourceContext active = null;
            lock (Gate)
            {
                after = CheckPreviewRequest(request, foreground);
                if (after == PreviewRequestTracker.Decision.Accept && selected != null)
                {
                    active = new SourceContext { Window = request.Window, Focus = request.Focus, Kind = request.Kind,
                        Runtime = runtime, Path = selected, Id = Guid.NewGuid().ToString("N") };
                    source = active;
                    NavigationQueue.Clear();
                }
            }
            if (after == PreviewRequestTracker.Decision.Discard) return;
            if (after == PreviewRequestTracker.Decision.Retry) continue;
            if (active != null)
            {
                if (request.Kind == "dopus") Console.WriteLine(json.Serialize(new { type = "status", message = "DOpus：已读取选中项" }));
                Console.WriteLine(json.Serialize(new { type = "preview", path = selected, timestamp = request.Timestamp, sourceId = active.Id }));
                Console.Out.Flush();
            }
            else
            {
                if (request.Kind == "dopus")
                {
                    Console.WriteLine(json.Serialize(new { type = "status", message = "DOpus：未读取到选中项，请确认文件已选中且快捷键没有冲突" }));
                    Console.Out.Flush();
                }
                // No usable selection: return the intercepted key to its original control.
                PostMessage(request.Focus, WmKeyDown, new IntPtr(VkSpace), new IntPtr(1));
                PostMessage(request.Focus, WmKeyUp, new IntPtr(VkSpace), new IntPtr(unchecked((int)0xC0000001)));
            }
            return;
        }
    }

    private static void RestoreSourceFocus(SourceContext restore)
    {
        if (!IsWindow(restore.Window)) return;
        SetForegroundWindow(restore.Window);
        // Only restore the previously focused child if activating its source
        // window succeeded and the user has not switched elsewhere meanwhile.
        if (GetForegroundWindow() != restore.Window || !IsWindow(restore.Focus) ||
            restore.Focus == restore.Window || !IsChild(restore.Window, restore.Focus)) return;
        uint targetThread = GetWindowThreadProcessId(restore.Focus, IntPtr.Zero);
        if (targetThread == 0) return;
        GuiThreadInfo info = new GuiThreadInfo();
        info.Size = Marshal.SizeOf(typeof(GuiThreadInfo));
        if (GetGUIThreadInfo(targetThread, ref info) && info.Focus == restore.Focus) return;
        // AttachThreadInput requires a message queue for this otherwise
        // non-GUI command thread. The attachment is removed immediately.
        NativeMessage ignored;
        PeekMessage(out ignored, IntPtr.Zero, 0, 0, 0);
        uint currentThread = GetCurrentThreadId();
        bool attached = currentThread == targetThread || AttachThreadInput(currentThread, targetThread, true);
        if (!attached) return;
        try { if (GetForegroundWindow() == restore.Window) SetFocus(restore.Focus); }
        finally { if (currentThread != targetThread) AttachThreadInput(currentThread, targetThread, false); }
    }

    private static void NavigateSelection(object shell, SourceContext active, Navigation navigation, JavaScriptSerializer json, long previewSerial)
    {
        if (!IsWindow(active.Window) || !IsWindow(active.Focus)) return;
        string selected = null;
        if (active.Kind == "dopus")
        {
            DopusSelection.Selection result = navigation.Key == "observe"
                ? DopusSelection.Query(active.Runtime, active.Window, active.Focus)
                : DopusSelection.Navigate(active.Runtime, active.Window, navigation.Key);
            selected = result == null ? null : result.Path;
        }
        else
        {
            if (active.Focus != active.Window && !IsChild(active.Window, active.Focus)) return;
            int key = navigation.Key == "ArrowLeft" ? 0x25 : navigation.Key == "ArrowUp" ? 0x26 : navigation.Key == "ArrowRight" ? 0x27 : 0x28;
            if (!PostMessage(active.Focus, WmKeyDown, new IntPtr(key), new IntPtr(1))) return;
            PostMessage(active.Focus, WmKeyUp, new IntPtr(key), new IntPtr(unchecked((int)0xC0000001)));
            for (int i = 0; i < 6; i++)
            {
                Thread.Sleep(35);
                selected = GetSelectedFile(shell, active);
                if (selected != null && !String.Equals(selected, active.Path, StringComparison.OrdinalIgnoreCase)) break;
            }
        }
        lock (Gate)
        {
            if (Requests.LatestSerial != previewSerial || source == null || source.Id != navigation.SourceId || selected == null || String.Equals(selected, source.Path, StringComparison.OrdinalIgnoreCase)) return;
            source.Path = selected;
        }
        if (!File.Exists(selected) && !Directory.Exists(selected)) return;
        Console.WriteLine(json.Serialize(new { type = "selection", path = selected, timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), sourceId = navigation.SourceId }));
        Console.Out.Flush();
    }

    private static string GetSelectedFile(object shell, SourceContext context)
    {
        object windows = null;
        try
        {
            windows = ((dynamic)shell).Windows();
            if (context.Kind == "desktop")
            {
                object desktop = null;
                try
                {
                    object location = null;
                    object root = null;
                    int desktopWindow;
                    desktop = ((dynamic)windows).FindWindowSW(ref location, ref root, 8, out desktopWindow, 1);
                    return GetSelectedFromBrowser(desktop);
                }
                catch (Exception) { return null; }
                finally { Release(desktop); }
            }
            int count = ((dynamic)windows).Count;
            for (int i = 0; i < count; i++)
            {
                object browser = null;
                try
                {
                    browser = ((dynamic)windows).Item(i);
                    if (new IntPtr(Convert.ToInt64(((dynamic)browser).HWND)) != context.Window) continue;
                    if (FindWindowEx(context.Window, IntPtr.Zero, "ShellTabWindowClass", null) != IntPtr.Zero && !MatchesTab(browser, context.Focus)) continue;
                    return GetSelectedFromBrowser(browser);
                }
                catch (Exception) { }
                finally
                {
                    Release(browser);
                }
            }
        }
        catch (Exception) { }
        finally { Release(windows); }
        return null;
    }

    private static string GetSelectedFromBrowser(object browser)
    {
        object document = null;
        object selectedItems = null;
        object item = null;
        try
        {
            document = ((dynamic)browser).Document;
            selectedItems = ((dynamic)document).SelectedItems();
            if ((int)((dynamic)selectedItems).Count < 1) return null;
            item = ((dynamic)selectedItems).Item(0);
            string filePath = ((dynamic)item).Path as string;
            return !String.IsNullOrEmpty(filePath) && (File.Exists(filePath) || Directory.Exists(filePath)) ? filePath : null;
        }
        catch (Exception) { return null; }
        finally { Release(item); Release(selectedItems); Release(document); }
    }

    private static bool MatchesTab(object browser, IntPtr focus)
    {
        object shellBrowser = null;
        try
        {
            ComServiceProvider provider = (ComServiceProvider)browser;
            Guid service = new Guid("4C96BE40-915C-11CF-99D3-00AA004AE837");
            Guid browserInterface = new Guid("000214E2-0000-0000-C000-000000000046");
            if (provider.QueryService(ref service, ref browserInterface, out shellBrowser) != 0) return false;
            IntPtr tab;
            return ((ShellBrowser)shellBrowser).GetWindow(out tab) == 0 && (tab == focus || IsChild(tab, focus));
        }
        catch (Exception) { return false; }
        finally { Release(shellBrowser); }
    }

    private static void Release(object value)
    {
        if (value != null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value);
    }

    private delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);

    [ComImport, Guid("6D5140C1-7436-11CE-8034-00AA006009FA"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ComServiceProvider
    {
        [PreserveSig]
        int QueryService(ref Guid service, ref Guid interfaceId, [MarshalAs(UnmanagedType.Interface)] out object result);
    }

    [ComImport, Guid("000214E2-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ShellBrowser
    {
        [PreserveSig]
        int GetWindow(out IntPtr window);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardEvent
    {
        public int VirtualKey;
        public int ScanCode;
        public int Flags;
        public int Time;
        public IntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Point { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)]
    private struct MouseEvent
    {
        public Point Position;
        public int MouseData;
        public int Flags;
        public int Time;
        public IntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct GuiThreadInfo
    {
        public int Size;
        public int Flags;
        public IntPtr Active;
        public IntPtr Focus;
        public IntPtr Capture;
        public IntPtr MenuOwner;
        public IntPtr MoveSize;
        public IntPtr Caret;
        public int CaretLeft;
        public int CaretTop;
        public int CaretRight;
        public int CaretBottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeMessage
    {
        public IntPtr Window;
        public uint Message;
        public UIntPtr WParam;
        public IntPtr LParam;
        public uint Time;
        public int X;
        public int Y;
        public uint Private;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int id, HookProc callback, IntPtr module, uint thread);
    [DllImport("user32.dll")]
    private static extern bool UnhookWindowsHookEx(IntPtr hookHandle);
    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hookHandle, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int virtualKey);
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    private static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr window, uint flags);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")]
    private static extern IntPtr SetFocus(IntPtr window);
    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [DllImport("user32.dll")]
    private static extern bool PeekMessage(out NativeMessage message, IntPtr window, uint min, uint max, uint remove);
    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr window, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll", EntryPoint = "GetWindowThreadProcessId")]
    private static extern uint GetWindowOwnerProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, IntPtr processId);
    [DllImport("user32.dll")]
    private static extern bool GetGUIThreadInfo(uint thread, ref GuiThreadInfo info);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr window, StringBuilder name, int capacity);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string className, string windowName);
    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")]
    private static extern bool IsChild(IntPtr parent, IntPtr child);
    [DllImport("user32.dll")]
    private static extern IntPtr GetParent(IntPtr window);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool PostMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string moduleName);
}
