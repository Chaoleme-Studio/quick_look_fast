using System;

internal static class PreviewRequestTests
{
    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }

    private static int Main()
    {
        IntPtr window = new IntPtr(10), focus = new IntPtr(20), otherWindow = new IntPtr(11), otherFocus = new IntPtr(21);
        var tracker = new PreviewRequestTracker();
        var first = tracker.Issue(window, focus, "explorer");
        var second = tracker.Issue(window, focus, "explorer");
        Check(tracker.Check(first, window, focus, "explorer") == PreviewRequestTracker.Decision.Accept &&
            tracker.Check(second, window, focus, "explorer") == PreviewRequestTracker.Decision.Accept,
            "two Space presses on the same selection must both reach the open/close toggle");

        var old = tracker.Issue(window, focus, "explorer");
        tracker.SelectionInput(); // Click another item while the old lookup is still running.
        var current = tracker.Issue(window, focus, "explorer");
        Check(tracker.Check(old, window, focus, "explorer") == PreviewRequestTracker.Decision.Discard,
            "a newer Space after a selection change must supersede the old result");
        Check(tracker.Check(current, window, focus, "explorer") == PreviewRequestTracker.Decision.Accept,
            "the newer request must use the current selection");

        var delayed = tracker.Issue(window, focus, "dopus");
        tracker.SelectionInput();
        Check(tracker.Check(delayed, window, focus, "dopus") == PreviewRequestTracker.Decision.Retry,
            "a click during a slow query without a newer Space should trigger a fresh read");
        tracker.Refresh(delayed);
        Check(tracker.Check(delayed, window, focus, "dopus") == PreviewRequestTracker.Decision.Accept,
            "a stable retry can open the current item");
        Check(tracker.Check(delayed, window, otherFocus, "dopus") == PreviewRequestTracker.Decision.Discard,
            "a result from the wrong pane must be ignored");
        Check(tracker.Check(delayed, otherWindow, focus, "dopus") == PreviewRequestTracker.Decision.Discard,
            "a result from a window that is no longer active must be ignored");

        var previousWindow = tracker.Issue(window, focus, "explorer");
        tracker.Issue(otherWindow, otherFocus, "explorer");
        Check(tracker.Check(previousWindow, window, focus, "explorer") == PreviewRequestTracker.Decision.Discard,
            "a newer request from a different window remains authoritative even if focus returns");
        Console.WriteLine("Preview request ordering checks passed.");
        return 0;
    }
}
