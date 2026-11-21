import QtQuick
import QtQuick.Window
import QtQuick.Layouts
import org.kde.plasma.plasmoid
import org.kde.plasma.core as PlasmaCore

PlasmoidItem {
    id: root
    Plasmoid.backgroundHints: PlasmaCore.Types.NoBackground
    Layout.minimumWidth: 1
    Layout.minimumHeight: 1
    Layout.preferredWidth: 1
    Layout.preferredHeight: 1
    preferredRepresentation: fullRepresentation

    fullRepresentation: Item {
        id: bridge
        implicitWidth: 1
        implicitHeight: 1
        property var folder: null
        property var command: null
        property var desktopHelper: null
        property bool ready: false
        property int selectionCount: 0
        property int searchAttempts: 0
        property bool warned: false

        function findFolder(item) {
            // A different app, desktop window, or Folder View widget cannot match:
            // inspect only our own window and require the desktop's root Folder View.
            let pending = [item];
            let visited = 0;
            while (pending.length && visited++ < 50000) {
                const node = pending.pop();
                if (!node) continue;
                try {
                    if (node.isRootView === true && node.view && node.model &&
                        typeof node.model.isSelected === "function" &&
                        typeof node.model.rowCount === "function" && node.model.selectionChanged &&
                        typeof node.view.currentIndex === "number") return node;
                    const children = node.children;
                    if (children) for (let i = 0; i < children.length; ++i) pending.push(children[i]);
                } catch (e) {
                    // Ignore unrelated scene items; no match leaves Space unchanged.
                }
            }
            return null;
        }

        function search() {
            try {
                if (folder && folder.view && folder.isRootView === true) return;
                const win = bridge.Window.window;
                if (win && win.contentItem) folder = findFolder(win.contentItem);
                if (folder) console.info("QuickLook Fast: desktop Folder View connected");
                else if (++searchAttempts >= 5 && !warned) {
                    warned = true;
                    console.warn("QuickLook Fast: unsupported Plasma desktop; desktop Space preview is disabled");
                }
            } catch (e) {
                folder = null;
                if (!warned) {
                    warned = true;
                    console.warn("QuickLook Fast: desktop Folder View unavailable; Space unchanged: " + e);
                }
            }
        }

        function countSelection() {
            if (!folder || !folder.model) return 0;
            const model = folder.model;
            // Plasma 6.8+ exposes this property; older Plasma 6 releases expose
            // selectionChanged and isSelected() but not selectionCount.
            if (typeof model.selectionCount === "number") return model.selectionCount;
            if (!model.hasSelection()) return 0;
            const rows = model.rowCount();
            let count = 0;
            for (let row = 0; row < rows; ++row) {
                if (model.isSelected(row) && ++count > 1) return count;
            }
            return count;
        }

        function refreshSelection() {
            try { selectionCount = countSelection(); }
            catch (e) {
                selectionCount = 0;
                console.warn("QuickLook Fast: unable to read desktop selection; Space unchanged: " + e);
            }
        }

        onFolderChanged: refreshSelection()
        Connections {
            target: bridge.folder ? bridge.folder.model : null
            ignoreUnknownSignals: true
            function onSelectionChanged() { bridge.refreshSelection(); }
            function onModelReset() { bridge.refreshSelection(); }
        }

        function readSelectedUri() {
            if (!folder || !folder.view || !folder.model || !folder.view.currentItem ||
                !folder.view.currentItem.selected || folder.view.currentIndex < 0 ||
                !folder.view.model) return "";
            const index = folder.view.model.index(folder.view.currentIndex, 0);
            const value = folder.view.model.data(index, Qt.UserRole + 6);
            return value ? String(value) : "";
        }
        function isLocalUri(uri) {
            return /^desktop:\/(?!\/)/i.test(uri) ||
                /^file:\/(?!\/)/i.test(uri) || /^file:\/\/(?:localhost)?\//i.test(uri);
        }
        readonly property string selectedUri: readSelectedUri()
        readonly property bool localUri: isLocalUri(selectedUri)

        function shellQuote(value) {
            return "'" + value.replace(/'/g, "'\\''") + "'";
        }

        Component.onCompleted: {
            // Load optional/private Plasma APIs dynamically, so a missing module only
            // disables this widget rather than breaking the surrounding desktop.
            try {
                command = Qt.createQmlObject('import QtQuick; import org.kde.plasma.plasma5support as Support; Support.DataSource { engine: "executable"; connectedSources: []; onNewData: (source, data) => { if (data["exit code"] !== 0) console.warn("QuickLook Fast desktop preview helper failed: " + data["stderr"]); disconnectSource(source) } }', bridge, 'QuickLookFastCommand');
                desktopHelper = Qt.createQmlObject('import QtQml; import org.kde.private.desktopcontainment.folder as Folder; QtObject { function desktopRoot() { return Folder.DesktopSchemeHelper.getFileUrl("desktop:/") } }', bridge, 'QuickLookFastDesktopHelper');
                const desktopRoot = desktopHelper.desktopRoot();
                // DataSource.valid has no change notification: evaluate it once after construction.
                ready = !!command.valid && typeof desktopRoot === "string" && desktopRoot.startsWith("/");
                if (!ready) console.warn("QuickLook Fast: required Plasma desktop helpers are unavailable; Space unchanged");
            } catch (e) {
                ready = false;
                console.warn("QuickLook Fast: required Plasma desktop helpers are unavailable; Space unchanged: " + e);
            }
        }

        Shortcut {
            context: Qt.WindowShortcut
            sequence: "Space"
            autoRepeat: false
            enabled: bridge.ready && bridge.folder && bridge.folder.isRootView === true &&
                     bridge.folder.view.activeFocus && bridge.selectionCount === 1 &&
                     (!bridge.folder.editor || !bridge.folder.editor.visible) && bridge.localUri
            onActivated: {
                // Recheck synchronously in case the model changed since the last signal.
                if (bridge.countSelection() !== 1) return;
                const currentUri = bridge.readSelectedUri();
                if (!bridge.isLocalUri(currentUri)) return;
                const source = encodeURIComponent(currentUri).replace(/'/g, "%27");
                const desktop = encodeURIComponent(bridge.desktopHelper.desktopRoot()).replace(/'/g, "%27");
                // The QML component can remain cached after reinstalling. The fixed-path
                // launcher is read from disk each time so it uses the current app location.
                // KProcess may invoke a shell; quote all arguments, including untrusted URLs.
                const cmd = bridge.shellQuote("/bin/sh") + " " + bridge.shellQuote(@WRAPPER@) +
                            " " + bridge.shellQuote(source) + " " + bridge.shellQuote(desktop);
                bridge.command.connectSource(cmd);
            }
        }

        Timer {
            interval: 2000
            running: true
            repeat: true
            triggeredOnStart: true
            onTriggered: bridge.search()
        }
    }
}
