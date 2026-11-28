import AppKit
import ApplicationServices
import Darwin

private let finderBundleID = "com.apple.finder"
private let spaceKeyCode: Int64 = 49
private let modifiers: CGEventFlags = [.maskCommand, .maskControl, .maskAlternate, .maskShift]
private let spaceModifiers = modifiers.union([.maskSecondaryFn, .maskHelp])

private enum NavigationKey: String, Decodable {
    case up = "ArrowUp"
    case down = "ArrowDown"

    var code: CGKeyCode { self == .up ? 126 : 125 }
}

private struct FinderSelection {
    let filePath: String
    let container: AXUIElement
    let isDesktop: Bool
}

private struct SelectionQuery {
    private enum FileReference {
        case path(String)
        case unresolvedName(String)
    }

    // Accessibility calls cross processes. Give up quickly if Finder is busy.
    let deadline = DispatchTime.now() + .milliseconds(55)

    private var hasTime: Bool { DispatchTime.now() < deadline }

    private func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
        guard hasTime else { return nil }
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
        return value
    }

    private func elementAttribute(_ element: AXUIElement, _ name: String) -> AXUIElement? {
        guard let value = attribute(element, name), CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return (value as! AXUIElement)
    }

    func selection(in application: AXUIElement) -> FinderSelection? {
        guard let focused = elementAttribute(application, kAXFocusedUIElementAttribute) else { return nil }
        let role = attribute(focused, kAXRoleAttribute) as? String
        // The Desktop is a scroll area owned directly by Finder. In a regular
        // window the scroll area belongs to the window instead.
        let isDesktop = (role == kAXGroupRole || role == kAXListRole) &&
            isDesktopContainer(focused, in: application)
        let selectionAttribute: String
        switch role {
        case kAXOutlineRole, kAXTableRole: selectionAttribute = kAXSelectedRowsAttribute
        case kAXListRole: selectionAttribute = kAXSelectedChildrenAttribute
        case kAXGroupRole where isDesktop: selectionAttribute = kAXSelectedChildrenAttribute
        default: return nil
        }

        // A multi-selection still belongs to the system's multi-item Quick Look.
        guard let selection = attribute(focused, selectionAttribute) as? [AXUIElement],
              selection.count == 1,
              let reference = fileReference(in: selection[0], depth: 2) else { return nil }
        let filePath: String
        switch reference {
        case .path(let path):
            filePath = path
        case .unresolvedName(let name):
            // In an expanded Finder outline the parent row can still have a
            // valid URL even when the selected item's old file ID has expired.
            // Do not guess a directory for top-level rows or other views.
            guard role == kAXOutlineRole,
                  let parent = disclosedParent(of: selection[0], in: focused),
                  case .path(let directory) = fileReference(in: parent, depth: 2),
                  let recovered = FinderSelectionPath.resolve(parent: directory, displayedName: name),
                  hasTime else { return nil }
            filePath = recovered
        }
        guard hasTime else { return nil }
        var fileInfo = stat()
        guard stat(filePath, &fileInfo) == 0 else { return nil }
        let type = fileInfo.st_mode & S_IFMT
        guard type == S_IFREG || type == S_IFDIR else { return nil }
        return FinderSelection(filePath: filePath, container: focused, isDesktop: isDesktop)
    }

    private func isDesktopContainer(_ container: AXUIElement, in application: AXUIElement) -> Bool {
        guard let scrollArea = elementAttribute(container, kAXParentAttribute),
              attribute(scrollArea, kAXRoleAttribute) as? String == kAXScrollAreaRole,
              let owner = elementAttribute(scrollArea, kAXParentAttribute) else { return false }
        return CFEqual(owner, application)
    }

    private func disclosedParent(of row: AXUIElement, in outline: AXUIElement) -> AXUIElement? {
        if let parent = elementAttribute(row, kAXDisclosedByRowAttribute), !CFEqual(parent, row) {
            return parent
        }
        // Some Finder versions omit AXDisclosedByRow. For a visible expanded
        // outline, the nearest preceding row one level above is its parent.
        guard let depth = (attribute(row, kAXDisclosureLevelAttribute) as? NSNumber)?.intValue, depth > 0,
              let rows = attribute(outline, kAXVisibleRowsAttribute) as? [AXUIElement],
              let index = rows.firstIndex(where: { CFEqual($0, row) }), index > 0 else { return nil }
        for previous in rows[max(0, index - 64)..<index].reversed() {
            guard let previousDepth = (attribute(previous, kAXDisclosureLevelAttribute) as? NSNumber)?.intValue else { return nil }
            if previousDepth < depth { return previousDepth == depth - 1 ? previous : nil }
        }
        return nil
    }

    private func fileReference(in element: AXUIElement, depth: Int) -> FileReference? {
        // Finder supplies a file-reference URL on the selected icon or name cell.
        if let url = attribute(element, kAXURLAttribute) as? URL {
            if url.isFileURL, let filePath = (url as NSURL).filePathURL?.path, filePath.hasPrefix("/") {
                return .path(filePath)
            }
            if attribute(element, kAXRoleAttribute) as? String == kAXTextFieldRole,
               let name = attribute(element, kAXValueAttribute) as? String {
                return .unresolvedName(name)
            }
        }
        guard depth > 0, let children = attribute(element, kAXChildrenAttribute) as? [AXUIElement] else { return nil }
        for child in children.prefix(16) {
            if let reference = fileReference(in: child, depth: depth - 1) { return reference }
        }
        return nil
    }
}

private final class SelectionWorker {
    private final class Result {
        let ready = DispatchSemaphore(value: 0)
        var selection: FinderSelection?
    }

    private let queue = DispatchQueue(label: "QuickLookFast.FinderSelection", qos: .userInteractive)
    private let available = DispatchSemaphore(value: 1)

    func read(_ application: AXUIElement) -> FinderSelection? {
        // A slow AX or file-system call can outlive the tap callback. Keep at most
        // one query in flight and allow later key presses through while it finishes.
        guard available.wait(timeout: .now()) == .success else { return nil }
        let query = SelectionQuery()
        let result = Result()
        queue.async { [available] in
            result.selection = query.selection(in: application)
            result.ready.signal()
            available.signal()
        }
        guard result.ready.wait(timeout: query.deadline) == .success else { return nil }
        return result.selection
    }
}

private struct FinderCommand: Decodable {
    enum Action: String, Decodable { case track, navigate, forget }
    let action: Action
    let sourceId: String
    let filePath: String?
    let key: NavigationKey?
    let followKeyboard: Bool?
}

private final class FinderSpaceBridge {
    private struct Origin {
        let id: String
        let container: AXUIElement
        let isDesktop: Bool
        var filePath: String
        var following = false
        var followKeyboard = true
    }

    private let workspace = NSWorkspace.shared
    private let selection = SelectionWorker()
    private let interceptSpace: Bool
    private let parentPID = getppid()
    private var finderPID: pid_t?
    private var finder: AXUIElement?
    private var tap: CFMachPort?
    private var source: CFRunLoopSource?
    private var reportedStatus: String?
    private var swallowedSpace = false
    private var origin: Origin?
    private var pendingSelection: DispatchWorkItem?

    init(interceptSpace: Bool) { self.interceptSpace = interceptSpace }

    func refreshTap() {
        guard AXIsProcessTrusted() else {
            stopTap()
            report("accessibility-required")
            return
        }
        guard let runningFinder = NSRunningApplication.runningApplications(withBundleIdentifier: finderBundleID).first else {
            stopTap()
            report("unavailable")
            return
        }
        let pid = runningFinder.processIdentifier
        if finderPID == pid, let tap, CGEvent.tapIsEnabled(tap: tap) {
            report("active")
            return
        }

        stopTap()
        // Finder's per-process tap also sees clicks in the originating window.
        // Observe mouse-up without consuming it so a click can update the
        // preview after Finder has committed its new selection.
        let mask = CGEventMask(1) << CGEventType.keyDown.rawValue |
            CGEventMask(1) << CGEventType.keyUp.rawValue |
            CGEventMask(1) << CGEventType.leftMouseUp.rawValue
        guard let newTap = CGEvent.tapCreateForPid(pid: pid, place: .headInsertEventTap, options: .defaultTap,
                 eventsOfInterest: mask, callback: { _, type, event, context in
                     guard let context else { return Unmanaged.passUnretained(event) }
                     let bridge = Unmanaged<FinderSpaceBridge>.fromOpaque(context).takeUnretainedValue()
                     return bridge.handle(type, event)
                 }, userInfo: Unmanaged.passUnretained(self).toOpaque()),
              let newSource = CFMachPortCreateRunLoopSource(nil, newTap, 0) else {
            report("unavailable")
            return
        }
        finderPID = pid
        finder = AXUIElementCreateApplication(pid)
        tap = newTap
        source = newSource
        CFRunLoopAddSource(CFRunLoopGetMain(), newSource, .commonModes)
        report("active")
    }

    private func stopTap() {
        if let tap { CFMachPortInvalidate(tap) }
        if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        tap = nil
        source = nil
        finder = nil
        finderPID = nil
        swallowedSpace = false
        setOrigin(nil)
    }

    private func handle(_ type: CGEventType, _ event: CGEvent) -> Unmanaged<CGEvent>? {
        let pass = Unmanaged.passUnretained(event)
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            swallowedSpace = false
            report("unavailable")
            return pass
        }
        if type == .leftMouseUp {
            if let origin, origin.following, let frontPID = workspace.frontmostApplication?.processIdentifier,
               frontPID == finderPID || origin.isDesktop {
                scheduleSelectionCheck(origin.id, desktopInputPID: origin.isDesktop ? frontPID : nil)
            }
            return pass
        }
        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
        if type == .keyDown, event.flags.intersection(modifiers).isEmpty,
           keyCode == NavigationKey.up.code || keyCode == NavigationKey.down.code,
           let origin, origin.following, origin.followKeyboard, let frontPID = workspace.frontmostApplication?.processIdentifier,
           frontPID == finderPID || origin.isDesktop {
            scheduleSelectionCheck(origin.id, desktopInputPID: origin.isDesktop ? frontPID : nil)
        }
        guard interceptSpace, keyCode == spaceKeyCode else { return pass }
        if type == .keyUp {
            let handled = swallowedSpace
            swallowedSpace = false
            return handled ? nil : pass
        }
        guard type == .keyDown else { return pass }
        if event.getIntegerValueField(.keyboardEventAutorepeat) != 0 { return swallowedSpace ? nil : pass }
        swallowedSpace = false
        guard event.flags.intersection(spaceModifiers).isEmpty,
              reportedStatus == "active", let finderPID, let finder,
              let frontPID = workspace.frontmostApplication?.processIdentifier else { return pass }

        // Desktop key events still reach Finder's per-process tap when the app
        // behind Show Desktop remains active in the menu bar.
        guard let selected = selection.read(finder),
              selected.isDesktop || frontPID == finderPID,
              workspace.frontmostApplication?.processIdentifier == frontPID else { return pass }
        let id = UUID().uuidString
        guard send(["file": selected.filePath, "sourceId": id]) else { return pass }
        setOrigin(Origin(id: id, container: selected.container, isDesktop: selected.isDesktop, filePath: selected.filePath))
        swallowedSpace = true
        return nil
    }

    func handle(_ command: FinderCommand) {
        guard !command.sourceId.isEmpty, command.sourceId.utf8.count <= 100 else { return }
        switch command.action {
        case .forget:
            if var origin, origin.id == command.sourceId {
                origin.following = false
                setOrigin(origin)
            }
        case .track:
            guard let path = command.filePath else { return }
            if var origin, origin.id == command.sourceId {
                origin.following = true
                origin.followKeyboard = command.followKeyboard ?? true
                setOrigin(origin)
                return
            }
            guard !interceptSpace, let finder, let finderPID,
                  workspace.frontmostApplication?.processIdentifier == finderPID,
                  let selected = selection.read(finder), selected.filePath == path else { return }
            setOrigin(Origin(id: command.sourceId, container: selected.container, isDesktop: selected.isDesktop,
                             filePath: path, following: true, followKeyboard: command.followKeyboard ?? true))
        case .navigate:
            guard let origin, origin.id == command.sourceId, origin.following, origin.followKeyboard, let finder, let finderPID, let key = command.key,
                  isNavigationForeground(finderPID),
                  let selected = selection.read(finder), CFEqual(selected.container, origin.container),
                  isNavigationForeground(finderPID) else { return }
            for down in [true, false] {
                let event = CGEvent(keyboardEventSource: nil, virtualKey: key.code, keyDown: down)
                event?.flags = .maskNumericPad
                event?.postToPid(finderPID)
            }
            scheduleSelectionCheck(origin.id)
        }
    }

    private func isNavigationForeground(_ finderPID: pid_t, desktopInputPID: pid_t? = nil) -> Bool {
        guard let activePID = workspace.frontmostApplication?.processIdentifier else { return false }
        return activePID == finderPID || activePID == parentPID || activePID == desktopInputPID
    }

    private func setOrigin(_ origin: Origin?) {
        pendingSelection?.cancel()
        pendingSelection = nil
        self.origin = origin
    }

    private func scheduleSelectionCheck(_ id: String, desktopInputPID: pid_t? = nil, attempts: Int = 4) {
        guard pendingSelection == nil else { return }
        let work = DispatchWorkItem { [weak self] in
            guard let self, var origin = self.origin, origin.id == id, origin.following,
                  let finder = self.finder, let finderPID = self.finderPID else { return }
            self.pendingSelection = nil
            guard self.isNavigationForeground(finderPID, desktopInputPID: desktopInputPID) else { return }
            if let selected = self.selection.read(finder), CFEqual(selected.container, origin.container),
               selected.filePath != origin.filePath, self.isNavigationForeground(finderPID, desktopInputPID: desktopInputPID),
               self.send(["selection": selected.filePath, "sourceId": id]) {
                origin.filePath = selected.filePath
                self.origin = origin
            } else if attempts > 1 {
                self.scheduleSelectionCheck(id, desktopInputPID: desktopInputPID, attempts: attempts - 1)
            }
        }
        pendingSelection = work
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(25), execute: work)
    }

    private func report(_ status: String) {
        guard status != reportedStatus, send(["status": status]) else { return }
        reportedStatus = status
    }

    private func send(_ fields: [String: String]) -> Bool {
        guard let payload = try? JSONEncoder().encode(fields) else { return false }
        // Start a fresh line even if the socket could only accept part of the previous write.
        var message = Data([0x0a])
        message.append(payload)
        message.append(0x0a)
        // A single nonblocking pipe write lets the event pass if Electron is gone or busy.
        guard message.count <= PIPE_BUF else { return false }
        return message.withUnsafeBytes { write(STDOUT_FILENO, $0.baseAddress, $0.count) == $0.count }
    }
}

@main
private struct FinderBridgeMain {
    static func main() {
        signal(SIGPIPE, SIG_IGN)
        guard fcntl(STDOUT_FILENO, F_SETFL, O_NONBLOCK) == 0 else { exit(EXIT_FAILURE) }
        if CommandLine.arguments.contains("--prompt-accessibility") {
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
            _ = AXIsProcessTrustedWithOptions(options)
        }
        _ = AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 0.025)
        let bridge = FinderSpaceBridge(interceptSpace: !CommandLine.arguments.contains("--navigation-only"))
        DispatchQueue.global(qos: .userInitiated).async {
            let decoder = JSONDecoder()
            while let line = readLine() {
                guard line.utf8.count <= 4096,
                      let command = try? decoder.decode(FinderCommand.self, from: Data(line.utf8)) else { continue }
                DispatchQueue.main.async { bridge.handle(command) }
            }
            _exit(EXIT_SUCCESS)
        }
        bridge.refreshTap()
        Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in bridge.refreshTap() }
        RunLoop.main.run()
    }
}
