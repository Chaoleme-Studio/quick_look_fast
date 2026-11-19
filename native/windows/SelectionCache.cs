using System;

// Callers serialize access with the bridge's Gate lock.
internal sealed class SelectionCache
{
    private IntPtr window;
    private string path;
    private int sampledAt;

    internal void Sample(IntPtr foregroundWindow, string kind, string selected, int now)
    {
        // When the preview owns focus, don't discard the file manager's last selection.
        if (foregroundWindow == IntPtr.Zero || kind == "dopus") return;
        // Shell can briefly report an empty selection during reactivation. Keep
        // the last known item for a short bounded grace period after closing.
        int age = unchecked(now - sampledAt);
        if (foregroundWindow == window && String.IsNullOrEmpty(selected) && !String.IsNullOrEmpty(path) && age >= 0 && age <= 150) return;
        window = foregroundWindow;
        path = selected;
        sampledAt = now;
    }

    internal void Remember(IntPtr sourceWindow, string selected, int now)
    {
        window = sourceWindow;
        path = selected;
        sampledAt = now;
    }

    internal bool CanIntercept(IntPtr foregroundWindow, string kind, int now)
    {
        if (kind == "dopus") return true;
        int age = unchecked(now - sampledAt);
        return foregroundWindow == window && !String.IsNullOrEmpty(path) && age >= 0 && age <= 500;
    }

    internal static bool MatchesSource(IntPtr foregroundWindow, IntPtr foregroundFocus, string foregroundKind,
        IntPtr sourceWindow, IntPtr sourceFocus, string sourceKind, string selected)
    {
        return foregroundWindow == sourceWindow && foregroundFocus == sourceFocus &&
            foregroundKind == sourceKind && !String.IsNullOrEmpty(selected);
    }

    internal static bool IsDopusFileDisplayClass(string name)
    {
        return name.Equals("dopus.filedisplay", StringComparison.OrdinalIgnoreCase) ||
            name.Equals("dopus.iconfiledisplay", StringComparison.OrdinalIgnoreCase) ||
            name.Equals("dopus.filedisplaycontainer", StringComparison.OrdinalIgnoreCase) ||
            name.Equals("SysListView32", StringComparison.OrdinalIgnoreCase);
    }

    internal static bool IsTextInputClass(string name)
    {
        return name.IndexOf("edit", StringComparison.OrdinalIgnoreCase) >= 0 ||
            name.IndexOf("scintilla", StringComparison.OrdinalIgnoreCase) >= 0 ||
            name.IndexOf("combobox", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    // Some DOpus views leave the Lister foreground while reporting no focused
    // child. The Lister itself remains a valid source unless a caret exists.
    internal static IntPtr EffectiveDopusFocus(IntPtr lister, IntPtr focused, IntPtr caret)
    {
        return focused == IntPtr.Zero && caret == IntPtr.Zero ? lister : focused;
    }

    internal static bool ShouldClearStuckSpace(bool latched, short previousKeyState, int elapsed)
    {
        // A low-level hook sees the previous asynchronous key state before the
        // current keydown updates it. A physically released key permits a new press.
        return latched && (previousKeyState & 0x8000) == 0 && elapsed >= 80;
    }

    internal static bool IsSpaceRelease(int message)
    {
        return message == 0x0101 || message == 0x0105; // WM_KEYUP or WM_SYSKEYUP
    }

    internal static bool IsDopusAuxiliaryClass(string name)
    {
        return IsTextInputClass(name) || name.IndexOf("button", StringComparison.OrdinalIgnoreCase) >= 0 ||
            name.IndexOf("toolbar", StringComparison.OrdinalIgnoreCase) >= 0 ||
            name.IndexOf("tree", StringComparison.OrdinalIgnoreCase) >= 0 ||
            name.IndexOf("address", StringComparison.OrdinalIgnoreCase) >= 0 ||
            name.IndexOf("search", StringComparison.OrdinalIgnoreCase) >= 0 ||
            name.IndexOf("menu", StringComparison.OrdinalIgnoreCase) >= 0 ||
            name.IndexOf("status", StringComparison.OrdinalIgnoreCase) >= 0 ||
            name.IndexOf("tab", StringComparison.OrdinalIgnoreCase) >= 0;
    }
}
