using System;
using System.IO;
using System.Diagnostics;

internal static class DopusSelectionTests
{
    private static void Check(bool value, string message)
    {
        if (!value) throw new Exception(message);
    }

    private static int Main(string[] args)
    {
        DopusSelection.Selection value = DopusSelection.Parse("<results><items lister=\"0x70e2a\"><item path=\"C:\\素材\\A &amp; B.mp3\"/></items></results>");
        Check(value != null && value.Lister == 0x70e2a && value.Path == "C:\\素材\\A & B.mp3", "valid selection and escaped path");
        Check(DopusSelection.Parse("<results><items lister=\"123\"><item path=\"C:\\a.txt\"/></items></results>").Lister == 123, "decimal handle");
        Check(DopusSelection.Parse("<results><items lister=\"0x0\"><item path=\"C:\\a.txt\"/></items></results>") == null, "missing lister");
        Check(DopusSelection.Parse("<results><items lister=\"0x1\"/></results>") == null, "empty selection");
        Check(DopusSelection.Parse("<!DOCTYPE x [<!ENTITY e SYSTEM 'file:///C:/secret'>]><results><items lister='0x1'><item path='&e;'/></items></results>") == null, "external entities must be disabled");
        const string paths = "<results><path lister='0x10' active_tab='1' tab='0x11' tab_state='1'/>" +
            "<path lister='0x20' active_tab='1' tab='0x21' tab_state='2'/>" +
            "<path lister='0x20' active_tab='2' tab='0x22' tab_state='1'/>" +
            "<path lister='0x20' tab='0x23'/>" +
            "<path lister='0x30' active_tab='1' tab='0x31'/></results>";
        Check(DopusSelection.FindActiveTab(paths, 0x10) == 0x11, "first lister active tab");
        Check(DopusSelection.FindActiveTab(paths, 0x20) == 0x22, "second lister and active side of dual panel");
        Check(DopusSelection.FindActiveTab(paths, 0x30) == 0x31, "single lister without source state");
        Check(DopusSelection.FindActiveTab(paths, 0x40) == 0, "do not guess another lister's tab");
        if (args.Length > 0)
        {
            string prefix = "dopus-test-" + Guid.NewGuid().ToString("N");
            string first = Path.GetFullPath(Path.Combine(".local", "cache", prefix + "-first.txt"));
            string next = Path.GetFullPath(Path.Combine(".local", "cache", prefix + "-next.txt"));
            string state = Path.GetFullPath(Path.Combine(".local", "cache", prefix + "-state.txt"));
            try
            {
                File.WriteAllText(first, "first");
                File.WriteAllText(next, "next");
                File.WriteAllText(state, first);
                long resolvedTab;
                var commands = new System.Collections.Generic.List<string>();
                DopusSelection.Selection crossWindow = DopusSelection.QueryMessages(new IntPtr(0x20), delegate(string command) {
                    commands.Add(command);
                    if (command == "listsel") return "<results><items lister='0x10'><item path='" + first + "'/></items></results>";
                    if (command == "paths") return paths;
                    if (command == "listsel,0x22") return "<results><items lister='0x20'><item path='" + next + "'/></items></results>";
                    return null;
                }, out resolvedTab);
                Check(crossWindow != null && crossWindow.Path == next && resolvedTab == 0x22, "retry the active tab of the second lister, not the first lister's file");
                Check(String.Join("|", commands.ToArray()) == "paths|listsel,0x22", "query the correct tab explicitly");
                commands.Clear();
                DopusSelection.Selection clickedPane = DopusSelection.QueryMessages(new IntPtr(0x20), new IntPtr(0x2101), delegate(string command) {
                    commands.Add(command);
                    if (command == "paths") return paths;
                    if (command == "listsel,0x21") return "<results><items lister='0x20'><item path='" + first + "'/></items></results>";
                    if (command == "listsel,0x22") return "<results><items lister='0x20'><item path='" + next + "'/></items></results>";
                    return null;
                }, delegate(long parent, long child) { return parent == 0x21 && child == 0x2101; }, out resolvedTab);
                Check(clickedPane != null && clickedPane.Path == first && resolvedTab == 0x21, "focus wins over a stale source flag in the same lister");
                Check(String.Join("|", commands.ToArray()) == "paths|listsel,0x21", "do not query the other pane first");
                Environment.SetEnvironmentVariable("SLOWLOOK_TEST_STATE", state);
                Environment.SetEnvironmentVariable("SLOWLOOK_TEST_NEXT", next);
                string runtime = Path.GetFullPath(args[0]);
                Check(DopusSelection.Query(runtime, new IntPtr(0x1234)).Path == first, "query selected file via DOpusRT");
                Environment.SetEnvironmentVariable("SLOWLOOK_TEST_SLOW_EXIT", "1");
                Stopwatch stopwatch = Stopwatch.StartNew();
                Check(DopusSelection.Query(runtime, new IntPtr(0x1234)).Path == first && stopwatch.ElapsedMilliseconds < 1500, "consume a completed XML response without waiting for helper exit");
                Environment.SetEnvironmentVariable("SLOWLOOK_TEST_SLOW_EXIT", null);
                Check(DopusSelection.Navigate(runtime, new IntPtr(0x9999), "ArrowDown") == null && File.ReadAllText(state) == first, "do not modify a different lister");
                Check(DopusSelection.Navigate(runtime, new IntPtr(0x1234), "ArrowDown").Path == next, "select next row and query selection");
            }
            finally { Environment.SetEnvironmentVariable("SLOWLOOK_TEST_SLOW_EXIT", null); File.Delete(first); File.Delete(next); File.Delete(state); }
        }
        Console.WriteLine("DOpus selection XML checks passed.");
        return 0;
    }
}
