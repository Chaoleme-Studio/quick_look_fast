// Requests the active selection through Directory Opus' window-message IPC.
// A new message-only reply window is used for each request so that a late
// response cannot be mistaken for the selection from a later key press.
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class DopusIpc
{
    private const int CopyData = 0x004A;
    private const int CloseMessage = 0x0010;
    private const int MaxResponseBytes = 2 * 1024 * 1024;

    [StructLayout(LayoutKind.Sequential)]
    private struct CopyDataPayload
    {
        public IntPtr Kind;
        public int Length;
        public IntPtr Data;
    }

    private sealed class ReplyWindow : NativeWindow
    {
        internal readonly AutoResetEvent Received;
        internal string Xml;

        internal ReplyWindow(AutoResetEvent received) { Received = received; }

        protected override void WndProc(ref Message message)
        {
            if (message.Msg == CopyData)
            {
                try
                {
                    CopyDataPayload payload = (CopyDataPayload)Marshal.PtrToStructure(message.LParam, typeof(CopyDataPayload));
                    if (payload.Data != IntPtr.Zero && payload.Length > 0 && payload.Length <= MaxResponseBytes)
                    {
                        byte[] bytes = new byte[payload.Length];
                        Marshal.Copy(payload.Data, bytes, 0, bytes.Length);
                        Xml = new UTF8Encoding(false, true).GetString(bytes).TrimEnd('\0');
                        Received.Set();
                    }
                }
                catch (Exception) { }
                message.Result = new IntPtr(1);
                return;
            }
            if (message.Msg == CloseMessage)
            {
                DestroyHandle();
                Application.ExitThread();
                message.Result = IntPtr.Zero;
                return;
            }
            base.WndProc(ref message);
        }
    }

    internal static string Query(IntPtr expectedLister)
    {
        return Query(expectedLister, "listsel");
    }

    internal static string Query(IntPtr expectedLister, string command)
    {
        uint expectedOwner;
        GetWindowThreadProcessId(expectedLister, out expectedOwner);
        if (expectedOwner == 0) return null;
        IntPtr destination = IntPtr.Zero;
        while ((destination = FindWindowEx(IntPtr.Zero, destination, "DOpus.ParentWindow", null)) != IntPtr.Zero)
        {
            uint owner;
            GetWindowThreadProcessId(destination, out owner);
            if (owner == expectedOwner) return QueryFromWindow(expectedLister, destination, command);
        }
        return null;
    }

    internal static string QueryFromWindow(IntPtr expectedLister, IntPtr destination)
    {
        return QueryFromWindow(expectedLister, destination, "listsel");
    }

    internal static string QueryFromWindow(IntPtr expectedLister, IntPtr destination, string command)
    {
        if (destination == IntPtr.Zero || expectedLister == IntPtr.Zero || String.IsNullOrEmpty(command)) return null;
        uint expectedOwner, destinationOwner;
        GetWindowThreadProcessId(expectedLister, out expectedOwner);
        GetWindowThreadProcessId(destination, out destinationOwner);
        if (expectedOwner == 0 || expectedOwner != destinationOwner) return null;

        ReplyWindow reply = null;
        bool canceled = false;
        object gate = new object();
        using (ManualResetEvent ready = new ManualResetEvent(false))
        using (AutoResetEvent received = new AutoResetEvent(false))
        {
            Thread thread = new Thread(delegate()
            {
                try
                {
                    ReplyWindow window = new ReplyWindow(received);
                    window.CreateHandle(new CreateParams { Parent = new IntPtr(-3) });
                    lock (gate)
                    {
                        if (canceled) { window.DestroyHandle(); return; }
                        reply = window;
                        ready.Set();
                    }
                    Application.Run();
                }
                catch (Exception) { try { ready.Set(); } catch (ObjectDisposedException) { } }
            });
            thread.IsBackground = true;
            thread.SetApartmentState(ApartmentState.STA);
            thread.Start();
            if (!ready.WaitOne(1000))
            {
                lock (gate)
                {
                    canceled = true;
                    if (reply != null) PostMessage(reply.Handle, CloseMessage, IntPtr.Zero, IntPtr.Zero);
                }
                return null;
            }
            lock (gate) { if (reply == null) { canceled = true; return null; } }

            IntPtr bytes = IntPtr.Zero;
            try
            {
                bytes = Marshal.StringToHGlobalUni(command);
                CopyDataPayload payload = new CopyDataPayload { Kind = new IntPtr(0x15), Length = (command.Length + 1) * 2, Data = bytes };
                UIntPtr result;
                IntPtr sent = SendMessageTimeout(destination, CopyData, reply.Handle, ref payload, 0x0002 | 0x0020, 1000, out result);
                if (sent == IntPtr.Zero || result == UIntPtr.Zero) return null;
                return reply.Received.WaitOne(1000) ? reply.Xml : null;
            }
            finally
            {
                if (bytes != IntPtr.Zero) Marshal.FreeHGlobal(bytes);
                PostMessage(reply.Handle, CloseMessage, IntPtr.Zero, IntPtr.Zero);
                thread.Join(250);
            }
        }
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string className, string title);
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr SendMessageTimeout(IntPtr window, int message, IntPtr wParam, ref CopyDataPayload payload, uint flags, uint timeout, out UIntPtr result);
    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
}
