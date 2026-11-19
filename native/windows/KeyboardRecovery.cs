using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

// Raw input is used only as a liveness signal. No key codes or text are read.
// Windows can silently remove a low-level hook after a timeout, so a physical
// input event with no recent hook callback can trigger a hook reinstallation.
internal sealed class KeyboardRecovery : NativeWindow, IDisposable
{
    private const int WmInput = 0x00ff;
    private const uint InputSink = 0x00000100;
    private const uint Remove = 0x00000001;
    private readonly Func<bool> repair;
    private int lastHook;
    private int lastAttempt;
    private bool registered;
    private readonly Timer check;

    [StructLayout(LayoutKind.Sequential)]
    private struct RawDevice { public ushort UsagePage; public ushort Usage; public uint Flags; public IntPtr Target; }

    internal KeyboardRecovery(Func<bool> repairHook)
    {
        repair = repairHook;
        lastHook = lastAttempt = Environment.TickCount;
        check = new Timer { Interval = 150 };
        check.Tick += delegate {
            check.Stop();
            int now = Environment.TickCount;
            if (ShouldRepair(now, lastHook, lastAttempt))
            {
                lastAttempt = now;
                if (repair()) lastHook = now;
            }
        };
    }

    internal bool Start()
    {
        CreateHandle(new CreateParams { Parent = new IntPtr(-3) });
        RawDevice[] devices = { new RawDevice { UsagePage = 1, Usage = 6, Flags = InputSink, Target = Handle } };
        registered = RegisterRawInputDevices(devices, 1, (uint)Marshal.SizeOf(typeof(RawDevice)));
        if (!registered) DestroyHandle();
        return registered;
    }

    internal void SawHookEvent() { lastHook = Environment.TickCount; }

    internal static bool ShouldRepair(int now, int lastHookEvent, int lastRepairAttempt)
    {
        return unchecked(now - lastHookEvent) >= 1500 && unchecked(now - lastRepairAttempt) >= 1500;
    }

    protected override void WndProc(ref Message message)
    {
        if (message.Msg == WmInput)
        {
            int now = Environment.TickCount;
            // Give a healthy hook time to report this same input before
            // deciding it was removed. Do not record the actual input data.
            if (ShouldRepair(now, lastHook, lastAttempt) && !check.Enabled) check.Start();
        }
        base.WndProc(ref message);
    }

    public void Dispose()
    {
        check.Dispose();
        if (registered)
        {
            RawDevice[] devices = { new RawDevice { UsagePage = 1, Usage = 6, Flags = Remove, Target = IntPtr.Zero } };
            RegisterRawInputDevices(devices, 1, (uint)Marshal.SizeOf(typeof(RawDevice)));
            registered = false;
        }
        if (Handle != IntPtr.Zero) DestroyHandle();
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterRawInputDevices(RawDevice[] devices, uint count, uint size);
}
