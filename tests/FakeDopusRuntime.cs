using System;
using System.IO;
using System.Xml;
using System.Threading;

internal static class FakeDopusRuntime
{
    private static int Main(string[] args)
    {
        if (args.Length >= 2 && args[0] == "/info")
        {
            int comma = args[1].IndexOf(',');
            if (comma < 0 || args[1].Substring(comma) != ",listsel,0") return 1;
            string path = File.ReadAllText(Environment.GetEnvironmentVariable("SLOWLOOK_TEST_STATE"));
            using (XmlWriter xml = XmlWriter.Create(args[1].Substring(0, comma)))
            {
                xml.WriteStartElement("results");
                xml.WriteStartElement("items");
                xml.WriteAttributeString("lister", "0x1234");
                xml.WriteStartElement("item");
                xml.WriteAttributeString("path", path);
                xml.WriteEndElement(); xml.WriteEndElement(); xml.WriteEndElement();
            }
            if (Environment.GetEnvironmentVariable("SLOWLOOK_TEST_SLOW_EXIT") == "1") Thread.Sleep(2500);
            return 0;
        }
        if (args.Length >= 3 && args[0] == "/acmd" && args[1] == "Select" && args[2] == "NEXT=row")
        {
            File.WriteAllText(Environment.GetEnvironmentVariable("SLOWLOOK_TEST_STATE"), Environment.GetEnvironmentVariable("SLOWLOOK_TEST_NEXT"));
            return 0;
        }
        return 1;
    }
}
