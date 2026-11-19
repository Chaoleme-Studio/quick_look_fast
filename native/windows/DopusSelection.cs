// Directory Opus selection uses window-message IPC, with DOpusRT /info as fallback.
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Xml;
using Microsoft.Win32;

internal static class DopusSelection
{
    internal sealed class Selection
    {
        internal string Path;
        internal long Lister;
    }

    internal static string FindRuntime(IntPtr window)
    {
        try
        {
            uint id;
            GetWindowThreadProcessId(window, out id);
            using (Process process = Process.GetProcessById((int)id))
            {
                string executable = process.MainModule.FileName;
                string runtime = RuntimeBeside(executable);
                if (runtime != null) return runtime;
            }
        }
        catch (Exception) { }
        foreach (RegistryKey hive in new RegistryKey[] { Registry.CurrentUser, Registry.LocalMachine })
        {
            try
            {
                using (RegistryKey key = hive.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\dopus.exe"))
                {
                    string runtime = key == null ? null : RuntimeBeside(key.GetValue(null) as string);
                    if (runtime != null) return runtime;
                }
            }
            catch (Exception) { }
        }
        return null;
    }

    private static string RuntimeBeside(string executable)
    {
        if (String.IsNullOrEmpty(executable) || !String.Equals(System.IO.Path.GetFileName(executable), "dopus.exe", StringComparison.OrdinalIgnoreCase)) return null;
        string runtime = System.IO.Path.Combine(System.IO.Path.GetDirectoryName(executable), "dopusrt.exe");
        return File.Exists(runtime) ? runtime : null;
    }

    internal static Selection Parse(string xml)
    {
        Selection selection;
        return TryParse(xml, out selection) ? selection : null;
    }

    private static bool TryParse(string xml, out Selection selection)
    {
        selection = null;
        try
        {
            XmlDocument document = new XmlDocument();
            document.XmlResolver = null;
            using (StringReader input = new StringReader(xml))
            using (XmlReader reader = XmlReader.Create(input, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null }))
                document.Load(reader);
            if (document.DocumentElement == null || document.DocumentElement.Name != "results") return false;
            XmlElement items = document.SelectSingleNode("/results/items") as XmlElement;
            XmlElement item = items == null ? null : items.SelectSingleNode("item[@path]") as XmlElement;
            if (item == null) return true;
            long lister = ParseHandle(items.GetAttribute("lister"));
            string path = item.GetAttribute("path");
            if (lister != 0 && !String.IsNullOrWhiteSpace(path)) selection = new Selection { Path = path, Lister = lister };
            return true;
        }
        catch (Exception) { return false; }
    }

    // The Opus source tab may belong to another Lister. Resolve the active
    // tab in the Lister that actually received Space before retrying listsel.
    internal static long FindActiveTab(string xml, long expectedLister)
    {
        try
        {
            XmlDocument document = new XmlDocument();
            document.XmlResolver = null;
            using (StringReader input = new StringReader(xml))
            using (XmlReader reader = XmlReader.Create(input, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null }))
                document.Load(reader);
            if (document.DocumentElement == null || document.DocumentElement.Name != "results") return 0;
            long onlyVisible = 0;
            int visibleCount = 0;
            foreach (XmlNode node in document.SelectNodes("/results/path"))
            {
                XmlElement item = node as XmlElement;
                if (item == null || ParseHandle(item.GetAttribute("lister")) != expectedLister ||
                    (item.GetAttribute("active_tab") != "1" && item.GetAttribute("active_tab") != "2")) continue;
                long tab = ParseHandle(item.GetAttribute("tab"));
                if (tab == 0) continue;
                if (item.GetAttribute("tab_state") == "1") return tab;
                onlyVisible = tab;
                visibleCount++;
            }
            // In a single-display Lister the tab may have no source state.
            return visibleCount == 1 ? onlyVisible : 0;
        }
        catch (Exception) { return 0; }
    }

    // A Lister may contain two visible file displays. Resolve the focused
    // display before consulting Opus' source flag, which can lag behind a
    // rapid mouse click followed immediately by Space.
    internal static long FindFocusedTab(string xml, long expectedLister, long focus, Func<long, long, bool> isChild)
    {
        if (focus == 0 || isChild == null) return 0;
        try
        {
            XmlDocument document = new XmlDocument(); document.XmlResolver = null;
            using (StringReader input = new StringReader(xml))
            using (XmlReader reader = XmlReader.Create(input, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null })) document.Load(reader);
            if (document.DocumentElement == null || document.DocumentElement.Name != "results") return 0;
            long match = 0;
            foreach (XmlNode node in document.SelectNodes("/results/path"))
            {
                XmlElement item = node as XmlElement;
                if (item == null || ParseHandle(item.GetAttribute("lister")) != expectedLister ||
                    (item.GetAttribute("active_tab") != "1" && item.GetAttribute("active_tab") != "2")) continue;
                long tab = ParseHandle(item.GetAttribute("tab"));
                if (tab == 0 || (tab != focus && !isChild(tab, focus))) continue;
                if (match != 0 && match != tab) return 0;
                match = tab;
            }
            return match;
        }
        catch (Exception) { return 0; }
    }

    private static bool ReadInfo(string runtime, string temp, long tab, out Selection selection)
    {
        selection = null;
        try
        {
            string tabArgument = tab == 0 ? "0" : "0x" + tab.ToString("X");
            ProcessStartInfo start = new ProcessStartInfo(runtime, "/info \"" + temp + ",listsel," + tabArgument + "\"");
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            using (Process process = Process.Start(start))
            {
                if (process == null) return false;
                Stopwatch elapsed = Stopwatch.StartNew();
                try
                {
                    while (elapsed.ElapsedMilliseconds < 2500)
                    {
                        // DOpusRT may finish writing before its helper process exits.
                        // Conversely, a partial XML file must not be treated as a result.
                        try { if (File.Exists(temp) && TryParse(File.ReadAllText(temp), out selection)) return true; }
                        catch (IOException) { }
                        catch (UnauthorizedAccessException) { }
                        if (process.HasExited && process.ExitCode != 0) return false;
                        System.Threading.Thread.Sleep(20);
                    }
                    return false;
                }
                finally { try { if (!process.HasExited) process.Kill(); } catch (Exception) { } }
            }
        }
        catch (Exception) { return false; }
    }

    private static long ParseHandle(string value)
    {
        long number;
        if (value.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
            return Int64.TryParse(value.Substring(2), System.Globalization.NumberStyles.HexNumber, null, out number) ? number : 0;
        return Int64.TryParse(value, out number) ? number : 0;
    }

    private static bool Run(string runtime, string arguments)
    {
        try
        {
            ProcessStartInfo start = new ProcessStartInfo(runtime, arguments);
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            using (Process process = Process.Start(start))
            {
                if (process == null) return false;
                if (!process.WaitForExit(2500))
                {
                    try { process.Kill(); } catch (Exception) { }
                    return false;
                }
                return process.ExitCode == 0;
            }
        }
        catch (Exception) { return false; }
    }

    internal static Selection Query(string runtime, IntPtr expectedLister)
    {
        return Query(runtime, expectedLister, IntPtr.Zero);
    }

    internal static Selection Query(string runtime, IntPtr expectedLister, IntPtr focused)
    {
        string temp = null;
        try
        {
            // Prefer Opus' in-memory selection response; keep the documented
            // DOpusRT path as a fallback if window IPC is unavailable.
            long tab;
            Selection direct = QueryMessages(expectedLister, focused, delegate(string command) { return DopusIpc.Query(expectedLister, command); },
                delegate(long parent, long child) { return IsChild(new IntPtr(parent), new IntPtr(child)); }, out tab);
            if (direct != null) return direct;
            if (String.IsNullOrEmpty(runtime)) return null;
            temp = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "slowlook-dopus-" + Guid.NewGuid().ToString("N") + ".xml");
            Selection selection;
            if (!ReadInfo(runtime, temp, tab, out selection)) return null;
            return selection != null && selection.Lister == expectedLister.ToInt64() && (File.Exists(selection.Path) || Directory.Exists(selection.Path)) ? selection : null;
        }
        catch (Exception) { return null; }
        finally { if (temp != null) try { File.Delete(temp); } catch (Exception) { } }
    }

    internal static Selection QueryMessages(IntPtr expectedLister, Func<string, string> query, out long tab)
    {
        return QueryMessages(expectedLister, IntPtr.Zero, query, null, out tab);
    }

    internal static Selection QueryMessages(IntPtr expectedLister, IntPtr focused, Func<string, string> query, Func<long, long, bool> isChild, out long tab)
    {
        tab = 0;
        string paths = query("paths");
        if (paths != null) {
            tab = FindFocusedTab(paths, expectedLister.ToInt64(), focused.ToInt64(), isChild);
            if (tab == 0) tab = FindActiveTab(paths, expectedLister.ToInt64());
        }
        string response = query(tab == 0 ? "listsel" : "listsel,0x" + tab.ToString("X"));
        Selection selection = response == null ? null : Parse(response);
        return IsExpected(selection, expectedLister) ? selection : null;
    }

    private static bool IsExpected(Selection selection, IntPtr expectedLister)
    {
        return selection != null && selection.Lister == expectedLister.ToInt64() &&
            (File.Exists(selection.Path) || Directory.Exists(selection.Path));
    }

    internal static Selection Navigate(string runtime, IntPtr expectedLister, string key)
    {
        // /acmd targets the most recently active Lister. Verify that it is the
        // original source window before changing its selection.
        if (Query(runtime, expectedLister) == null) return null;
        string direction = key == "ArrowUp" ? "PREV=row" : key == "ArrowDown" ? "NEXT=row" : key == "ArrowLeft" ? "PREV" : "NEXT";
        if (!Run(runtime, "/acmd Select " + direction + " MAKEVISIBLE=immediate IGNORECHECKBOXMODE")) return null;
        return Query(runtime, expectedLister);
    }

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")]
    private static extern bool IsChild(IntPtr parent, IntPtr child);
}
