using System;

internal static class SelectionCacheTests
{
    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }

    private static int Main()
    {
        var cache = new SelectionCache();
        IntPtr desktop = new IntPtr(10);
        cache.Sample(desktop, "desktop", "C:\\a.txt", 100);
        cache.Sample(IntPtr.Zero, null, null, 200); // Preview window now has focus.
        Check(cache.CanIntercept(desktop, "desktop", 250), "preview focus must not clear the cached selection");
        cache.Remember(desktop, "C:\\a.txt", 1000); // The preview closes.
        cache.Sample(IntPtr.Zero, null, null, 1050);
        cache.Sample(desktop, "desktop", null, 1060); // Explorer is still reactivating.
        Check(cache.CanIntercept(desktop, "desktop", 1100), "rapidly reopening after close should work");
        Check(SelectionCache.MatchesSource(desktop, new IntPtr(20), "desktop", desktop, new IntPtr(20), "desktop", "C:\\a.txt"), "the live source covers the cache refresh race");
        Check(!SelectionCache.MatchesSource(desktop, new IntPtr(21), "desktop", desktop, new IntPtr(20), "desktop", "C:\\a.txt"), "a different focus must not reuse the source");
        Check(!cache.CanIntercept(new IntPtr(11), "desktop", 1100), "do not reuse another window's selection");
        cache.Sample(desktop, "desktop", null, 1200);
        Check(!cache.CanIntercept(desktop, "desktop", 1201), "a cleared selection must not be intercepted");
        Check(cache.CanIntercept(new IntPtr(12), "dopus", 1201), "DOpus queries its selection on demand");
        Check(SelectionCache.IsDopusFileDisplayClass("dopus.filedisplay"), "DOpus details view must be recognized");
        Check(SelectionCache.IsDopusFileDisplayClass("dopus.iconfiledisplay"), "DOpus icon view must be recognized");
        Check(!SelectionCache.IsDopusFileDisplayClass("dopus.toolbar"), "DOpus toolbars must not be treated as file lists");
        Check(SelectionCache.IsTextInputClass("RichEdit20W") && SelectionCache.IsTextInputClass("Scintilla"), "text editing must retain the Space key");
        Check(SelectionCache.IsDopusAuxiliaryClass("dopus.toolbar") && SelectionCache.IsDopusAuxiliaryClass("SysTreeView32"), "DOpus auxiliary controls retain Space");
        Check(!SelectionCache.IsDopusAuxiliaryClass("dopus.customfilelist"), "an unknown DOpus file list need not be rejected solely by its class name");
        Check(SelectionCache.EffectiveDopusFocus(desktop, IntPtr.Zero, IntPtr.Zero) == desktop, "a foreground DOpus Lister can be used when no child focus is reported");
        Check(SelectionCache.EffectiveDopusFocus(desktop, IntPtr.Zero, new IntPtr(30)) == IntPtr.Zero, "do not mask an active editing caret");
        Check(SelectionCache.ShouldClearStuckSpace(true, 0, 200), "recover when a previous Space key-up was missed");
        Check(!SelectionCache.ShouldClearStuckSpace(true, unchecked((short)0x8000), 200), "do not repeat while Space remains held");
        Check(!SelectionCache.ShouldClearStuckSpace(true, 0, 20), "ignore very short transition races");
        Check(SelectionCache.IsSpaceRelease(0x0101) && SelectionCache.IsSpaceRelease(0x0105), "ordinary and system key-up both release Space");
        Check(!SelectionCache.IsSpaceRelease(0x0100), "Space keydown must not reset the key latch");
        Check(KeyboardRecovery.ShouldRepair(5000, 3000, 3000), "missing low-level callbacks while raw input continues should trigger recovery");
        Check(!KeyboardRecovery.ShouldRepair(5000, 4900, 3000), "recent hook activity needs no recovery");
        Console.WriteLine("Selection cache checks passed.");
        return 0;
    }
}
