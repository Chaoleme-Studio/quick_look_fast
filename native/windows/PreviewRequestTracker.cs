using System;

// Callers serialize access with ExplorerBridge's Gate lock.
internal sealed class PreviewRequestTracker
{
    internal enum Decision { Accept, Retry, Discard }

    internal sealed class Ticket
    {
        internal long Serial;
        internal long SelectionRevision;
        internal IntPtr Window;
        internal IntPtr Focus;
        internal string Kind;
    }

    private long serial;
    private long selectionRevision;
    private Ticket latest;

    internal long LatestSerial { get { return serial; } }

    internal void SelectionInput() { selectionRevision++; }

    internal Ticket Issue(IntPtr window, IntPtr focus, string kind)
    {
        Ticket ticket = new Ticket { Serial = ++serial, SelectionRevision = selectionRevision,
            Window = window, Focus = focus, Kind = kind };
        latest = ticket;
        return ticket;
    }

    internal Decision Check(Ticket ticket, IntPtr window, IntPtr focus, string kind)
    {
        if (window != ticket.Window || focus != ticket.Focus || kind != ticket.Kind) return Decision.Discard;
        // A later Space in another window or pane supersedes this request.
        if (latest != null && latest.Serial > ticket.Serial &&
            (latest.Window != ticket.Window || latest.Focus != ticket.Focus || latest.Kind != ticket.Kind)) return Decision.Discard;
        if (selectionRevision == ticket.SelectionRevision) return Decision.Accept;
        // A newer Space will query the changed selection. Without one, retry
        // the original request so a click during a slow query can still open it.
        return serial > ticket.Serial ? Decision.Discard : Decision.Retry;
    }

    internal void Refresh(Ticket ticket) { ticket.SelectionRevision = selectionRevision; }
}
