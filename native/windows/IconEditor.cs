// Embed our generated ICO into the copied Electron executable using Win32 resources.
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;

internal static class IconEditor
{
    private const int RtIcon = 3;
    private const int RtGroupIcon = 14;
    private const int FirstImageId = 29000;
    private delegate bool ResourceNameCallback(IntPtr module, IntPtr type, IntPtr name, IntPtr parameter);
    private delegate bool ResourceLanguageCallback(IntPtr module, IntPtr type, IntPtr name, ushort language, IntPtr parameter);

    private sealed class Group
    {
        internal int Id;
        internal string Name;
        internal int FirstImageId;
        internal readonly List<ushort> Languages = new List<ushort>();
    }

    private static int Main(string[] args)
    {
        if (args.Length == 2 && args[0] == "--inspect") return Inspect(args[1]);
        if (args.Length != 2) { Console.Error.WriteLine("Usage: IconEditor.exe executable icon.ico"); return 2; }
        try { Embed(Path.GetFullPath(args[0]), File.ReadAllBytes(args[1])); return 0; }
        catch (Exception error) { Console.Error.WriteLine("Icon update failed: " + error.Message); return 1; }
    }

    private static List<Group> GetGroups(string path)
    {
        IntPtr module = LoadLibraryEx(path, IntPtr.Zero, 0x00000002);
        if (module == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            List<Group> groups = new List<Group>();
            ResourceNameCallback onName = delegate(IntPtr m, IntPtr type, IntPtr name, IntPtr parameter)
            {
                long value = name.ToInt64();
                Group group = value >= 0 && value <= 0xffff ? new Group { Id = (int)value } : new Group { Name = Marshal.PtrToStringUni(name) };
                ResourceLanguageCallback onLanguage = delegate(IntPtr mm, IntPtr tt, IntPtr nn, ushort language, IntPtr pp) { group.Languages.Add(language); return true; };
                EnumResourceLanguages(m, type, name, onLanguage, IntPtr.Zero);
                if (group.Languages.Count == 0) group.Languages.Add(0);
                IntPtr resource = FindResourceEx(m, type, name, group.Languages[0]);
                if (resource != IntPtr.Zero && SizeofResource(m, resource) >= 20)
                {
                    IntPtr data = LockResource(LoadResource(m, resource));
                    if (data != IntPtr.Zero) group.FirstImageId = (ushort)Marshal.ReadInt16(data, 18);
                }
                groups.Add(group);
                return true;
            };
            EnumResourceNames(module, new IntPtr(RtGroupIcon), onName, IntPtr.Zero);
            return groups;
        }
        finally { FreeLibrary(module); }
    }

    private static void Embed(string executable, byte[] ico)
    {
        if (ico.Length < 6 || BitConverter.ToUInt16(ico, 0) != 0 || BitConverter.ToUInt16(ico, 2) != 1) throw new InvalidDataException("Not an ICO file");
        int count = BitConverter.ToUInt16(ico, 4);
        if (count < 1 || count > 32 || ico.Length < 6 + count * 16) throw new InvalidDataException("Invalid icon count");
        List<Group> groups = GetGroups(executable);
        if (groups.Count == 0) groups.Add(new Group { Id = 1, Languages = { 0 } });
        IntPtr update = BeginUpdateResource(executable, false);
        if (update == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        bool committed = false;
        try
        {
            using (MemoryStream stream = new MemoryStream())
            using (BinaryWriter writer = new BinaryWriter(stream))
            {
                writer.Write((ushort)0); writer.Write((ushort)1); writer.Write((ushort)count);
                for (int index = 0; index < count; index++)
                {
                    int entry = 6 + 16 * index;
                    uint size = BitConverter.ToUInt32(ico, entry + 8);
                    uint offset = BitConverter.ToUInt32(ico, entry + 12);
                    if (size == 0 || (long)offset + size > ico.Length) throw new InvalidDataException("Invalid icon image");
                    writer.Write(ico, entry, 12);
                    writer.Write((ushort)(FirstImageId + index));
                    byte[] image = new byte[size];
                    Array.Copy(ico, (int)offset, image, 0, (int)size);
                    foreach (Group group in groups) foreach (ushort language in group.Languages)
                        if (!UpdateResource(update, new IntPtr(RtIcon), new IntPtr(FirstImageId + index), language, image, (uint)image.Length))
                            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
                }
                byte[] directory = stream.ToArray();
                foreach (Group group in groups)
                {
                    IntPtr name = group.Name == null ? new IntPtr(group.Id) : Marshal.StringToHGlobalUni(group.Name);
                    try { foreach (ushort language in group.Languages)
                        if (!UpdateResource(update, new IntPtr(RtGroupIcon), name, language, directory, (uint)directory.Length))
                            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
                    finally { if (group.Name != null) Marshal.FreeHGlobal(name); }
                }
            }
            if (!EndUpdateResource(update, false)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            committed = true;
            Console.WriteLine("Embedded QuickLook Fast icon: " + count + " sizes");
        }
        finally { if (!committed) EndUpdateResource(update, true); }
    }

    private static int Inspect(string executable)
    {
        try
        {
            List<Group> groups = GetGroups(Path.GetFullPath(executable));
            foreach (Group group in groups) if (group.FirstImageId == FirstImageId) { Console.WriteLine("QuickLook Fast executable icon verified."); return 0; }
            Console.Error.WriteLine("QuickLook Fast executable icon was not found."); return 1;
        }
        catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool FreeLibrary(IntPtr module);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool EnumResourceNames(IntPtr module, IntPtr type, ResourceNameCallback callback, IntPtr parameter);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool EnumResourceLanguages(IntPtr module, IntPtr type, IntPtr name, ResourceLanguageCallback callback, IntPtr parameter);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr FindResourceEx(IntPtr module, IntPtr type, IntPtr name, ushort language);
    [DllImport("kernel32.dll")] private static extern uint SizeofResource(IntPtr module, IntPtr resource);
    [DllImport("kernel32.dll")] private static extern IntPtr LoadResource(IntPtr module, IntPtr resource);
    [DllImport("kernel32.dll")] private static extern IntPtr LockResource(IntPtr resource);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr BeginUpdateResource(string file, bool deleteExistingResources);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool UpdateResource(IntPtr update, IntPtr type, IntPtr name, ushort language, byte[] data, uint size);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool EndUpdateResource(IntPtr update, bool discard);
}
