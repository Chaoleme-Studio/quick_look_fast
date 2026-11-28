import Foundation

// Finder can retain an expired file-reference URL after an item is replaced.
// Only recover a name from a known parent directory when it identifies one
// unambiguous entry. A hidden extension must never make us preview a sibling.
enum FinderSelectionPath {
    static func resolve(parent: String, displayedName: String) -> String? {
        guard parent.hasPrefix("/"), !displayedName.isEmpty,
              displayedName != ".", displayedName != "..",
              !displayedName.contains("/"), !displayedName.contains("\0"),
              let entries = try? FileManager.default.contentsOfDirectory(atPath: parent) else { return nil }

        let foldedName = displayedName.lowercased()
        let matches = entries.filter {
            let foldedEntry = $0.lowercased()
            return foldedEntry == foldedName || foldedEntry.hasPrefix(foldedName + ".")
        }
        guard matches.count == 1, matches[0] == displayedName else { return nil }
        return (parent as NSString).appendingPathComponent(matches[0])
    }
}
