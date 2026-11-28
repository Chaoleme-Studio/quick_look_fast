import Foundation

@main
struct FinderSelectionPathTests {
    static func main() throws {
        let manager = FileManager.default
        let directory = manager.temporaryDirectory.appendingPathComponent("quicklook-finder-\(UUID().uuidString)")
        try manager.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? manager.removeItem(at: directory) }

        let name = "表格图表导出记录.csv"
        let selected = directory.appendingPathComponent(name)
        try Data("example".utf8).write(to: selected)
        precondition(FinderSelectionPath.resolve(parent: directory.path, displayedName: name) == selected.path,
                     "a uniquely named replacement can be recovered from its parent")
        precondition(FinderSelectionPath.resolve(parent: directory.path, displayedName: "missing.csv") == nil,
                     "a missing file must not be guessed")
        precondition(FinderSelectionPath.resolve(parent: directory.path, displayedName: "../other") == nil,
                     "a displayed name must not escape the parent")
        precondition(FinderSelectionPath.resolve(parent: directory.path, displayedName: ".") == nil)
        precondition(FinderSelectionPath.resolve(parent: "relative", displayedName: name) == nil)

        let hiddenExtension = directory.appendingPathComponent(name + ".txt")
        try Data("other".utf8).write(to: hiddenExtension)
        precondition(FinderSelectionPath.resolve(parent: directory.path, displayedName: name) == nil,
                     "a sibling with a potentially hidden extension is ambiguous")
        try manager.removeItem(at: hiddenExtension)
        precondition(FinderSelectionPath.resolve(parent: directory.path, displayedName: name) == selected.path)
        print("Finder selection path checks passed.")
    }
}
