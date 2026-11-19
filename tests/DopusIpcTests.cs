using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class DopusIpcTests
{
    [StructLayout(LayoutKind.Sequential)]
    private struct Payload { public IntPtr Kind; public int Length; public IntPtr Data; }

    private sealed class FakeHost : NativeWindow
    {
        internal bool ReceivedExpectedRequest;
        internal string LastCommand;
        protected override void WndProc(ref Message m)
        {
            if (m.Msg == 0x004A)
            {
                Payload request = (Payload)Marshal.PtrToStructure(m.LParam, typeof(Payload));
                LastCommand = Marshal.PtrToStringUni(request.Data);
                ReceivedExpectedRequest = request.Kind.ToInt64() == 0x15 && LastCommand == "listsel";
                byte[] data = Encoding.UTF8.GetBytes("<results><items lister='0x1234'><item path='C:\\素材 &amp; A.txt'/></items></results>\0");
                IntPtr memory = Marshal.AllocHGlobal(data.Length);
                try
                {
                    Marshal.Copy(data, 0, memory, data.Length);
                    Payload response = new Payload { Kind = IntPtr.Zero, Length = data.Length, Data = memory };
                    SendMessage(m.WParam, 0x004A, Handle, ref response);
                }
                finally { Marshal.FreeHGlobal(memory); }
                m.Result = new IntPtr(1);
                return;
            }
            if (m.Msg == 0x0010) { DestroyHandle(); Application.ExitThread(); return; }
            base.WndProc(ref m);
        }
    }

    [STAThread]
    private static int Main()
    {
        FakeHost host = null;
        using (ManualResetEvent ready = new ManualResetEvent(false))
        {
            Thread thread = new Thread(delegate()
            {
                host = new FakeHost();
                host.CreateHandle(new CreateParams());
                ready.Set();
                Application.Run();
            });
            thread.IsBackground = true;
            thread.SetApartmentState(ApartmentState.STA);
            thread.Start();
            if (!ready.WaitOne(3000)) throw new Exception("fake Opus window did not start");
            try
            {
                string xml = DopusIpc.QueryFromWindow(host.Handle, host.Handle);
                if (!host.ReceivedExpectedRequest || xml == null || !xml.Contains("素材 &amp; A.txt")) throw new Exception("Opus IPC request or UTF-8 reply failed");
                DopusIpc.QueryFromWindow(host.Handle, host.Handle, "paths");
                if (host.LastCommand != "paths") throw new Exception("paths command was not delivered");
                DopusIpc.QueryFromWindow(host.Handle, host.Handle, "listsel,0x22");
                if (host.LastCommand != "listsel,0x22") throw new Exception("tab-specific selection command was not delivered");
                if (DopusIpc.QueryFromWindow(IntPtr.Zero, host.Handle) != null) throw new Exception("missing source must be rejected");
                Console.WriteLine("DOpus window-message IPC checks passed.");
            }
            finally { PostMessage(host.Handle, 0x0010, IntPtr.Zero, IntPtr.Zero); thread.Join(1000); }
        }
        return 0;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, ref Payload payload);
    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
}
