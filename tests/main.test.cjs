const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { mkdtempSync, mkdirSync, writeFileSync, unlinkSync, rmdirSync } = require('node:fs');
const fsPromises = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const Module = require('node:module');

test('opens and toggles a file, and a newer request wins over a slow one', { skip: process.platform !== 'win32' }, async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'slowlook-main-'));
  const first = path.join(directory, 'first.txt');
  const second = path.join(directory, '含 空格.txt');
  const shortcut = path.join(directory, 'shortcut.lnk');
  const folderShortcut = path.join(directory, 'folder shortcut.lnk');
  const photo = path.join(directory, 'thumbnail.png');
  const readme = path.join(directory, 'README.md');
  const shortcutFolder = path.join(directory, 'real folder');
  writeFileSync(first, 'first');
  writeFileSync(second, 'second');
  writeFileSync(shortcut, 'shortcut fixture');
  writeFileSync(folderShortcut, 'folder shortcut fixture');
  writeFileSync(photo, 'fake image bytes');
  writeFileSync(readme, '![image](thumbnail.png)');
  mkdirSync(shortcutFolder);
  writeFileSync(path.join(shortcutFolder, 'inside.txt'), 'folder contents');

  const app = new EventEmitter();
  app.isPackaged = false;
  app.requestSingleInstanceLock = () => true;
  app.commandLine = { appendSwitch() {} };
  app.whenReady = () => Promise.resolve();
  app.getAppPath = () => process.cwd();
  app.quit = () => app.emit('before-quit');
  let loginEnabled = false;
  app.getLoginItemSettings = () => ({ openAtLogin: loginEnabled });
  app.setLoginItemSettings = (settings) => { loginEnabled = settings.openAtLogin; };
  const ipcMain = new EventEmitter();
  const handlers = new Map();
  ipcMain.handle = (name, handler) => handlers.set(name, handler);
  const routes = new Map();
  const protocol = {
    registerSchemesAsPrivileged() {},
    handle: (scheme, handler) => routes.set(scheme, handler),
  };
  let networkFilter, updateRequests = 0;
  const session = {
    defaultSession: { webRequest: { onBeforeRequest: (_filter, handler) => { networkFilter = handler; } } },
    fromPartition: (name) => {
      assert.equal(name, 'quicklook-fast-update');
      return { fetch: async (url) => { updateRequests++; assert.match(url, /^https:\/\/api\.github\.com\//); return new Response(JSON.stringify({ tag_name: 'v0.2.0' })); } };
    },
  };
  app.getVersion = () => '0.1.2';
  let window;
  const windows = [];
  const externalLinks = [];
  const openedPaths = [];
  let openPathError = '';
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      assert.equal(options.alwaysOnTop, false, 'preview should start unpinned');
      assert.equal(options.skipTaskbar, true, 'Windows preview should not occupy the taskbar');
      assert.equal(options.webPreferences.backgroundThrottling, true, 'hidden previews should not keep unthrottled background work');
      assert.match(options.icon, /branding[\\/]app\.png$/);
      window = this;
      windows.push(this);
      this.visible = false;
      this.focused = false;
      this.destroyed = false;
      this.inactiveShows = 0;
      this.focusCount = 0;
      this.messages = [];
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.send = (channel, payload) => this.messages.push({ channel, payload });
    }
    async loadURL() { this.webContents.emit('did-finish-load'); }
    isMinimized() { return false; }
    isVisible() { return this.visible; }
    isFocused() { return this.visible && this.focused; }
    isDestroyed() { return this.destroyed; }
    getBounds() { return { x: 50, y: 50, width: 1080, height: 760 }; }
    getNativeWindowHandle() { const handle = Buffer.alloc(8); handle.writeBigUInt64LE(123n); return handle; }
    show() { this.visible = true; this.focused = true; }
    showInactive() { this.visible = true; this.focused = false; this.inactiveShows += 1; }
    hide() { this.visible = false; this.focused = false; }
    destroy() { this.visible = false; this.focused = false; this.destroyed = true; this.emit('closed'); }
    focus() { this.focused = true; this.focusCount += 1; }
    setAlwaysOnTop(value) { this.alwaysOnTop = value; }
  }
  class Tray extends EventEmitter {
    setToolTip() {}
    setContextMenu() {}
    destroy() {}
  }
  const electron = {
    app, BrowserWindow, ipcMain, protocol, session, Tray,
    globalShortcut: { unregisterAll() {}, unregister() {}, isRegistered: () => false, register: () => true },
    Menu: { buildFromTemplate: () => ({}) },
    nativeImage: { createFromBitmap: () => ({}), createFromPath: () => ({ isEmpty: () => false, setTemplateImage() {} }) },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    shell: { openExternal: async (url) => { externalLinks.push(url); }, openPath: async (filePath) => { openedPaths.push(filePath); return openPathError; }, readShortcutLink: (filePath) => filePath === folderShortcut
      ? { target: shortcutFolder, description: 'folder shortcut' }
      : { target: 'C:\\Target Folder\\document.txt', description: 'shortcut description' } },
  };
  const fakeBridge = new EventEmitter();
  fakeBridge.stdout = new PassThrough();
  fakeBridge.stdin = new PassThrough();
  fakeBridge.stderr = new PassThrough();
  fakeBridge.kill = () => { fakeBridge.stdout.end(); fakeBridge.stdin.end(); fakeBridge.stderr.end(); };
  let bridgeCommands = '';
  fakeBridge.stdin.on('data', (chunk) => { bridgeCommands += chunk.toString(); });
  const originalLoad = Module._load;
  const originalStat = fsPromises.stat;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electron;
    if (request === 'node:child_process') return { spawn: () => fakeBridge };
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    require('../build/dist-electron/main.js');
    let preventedColdOpen = false;
    app.emit('open-file', { preventDefault: () => { preventedColdOpen = true; } }, first);
    app.emit('second-instance', {}, [process.execPath, first], directory);
    for (let i = 0; i < 100 && !window?.messages.some((message) => message.channel === 'preview-file'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(window && handlers.has('open-file'));
    fakeBridge.stdout.write(`${JSON.stringify({ type: 'status', message: 'DOpus：未读取到选中项' })}\n`);
    for (let i = 0; i < 100 && !window.messages.some((message) => message.channel === 'integration-status'); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(window.messages.filter((message) => message.channel === 'integration-status').at(-1).payload, 'DOpus：未读取到选中项');
    assert.equal((await handlers.get('startup-get')()).enabled, false, 'startup must be opt-in');
    assert.equal((await handlers.get('startup-set')(null, true)).enabled, true, 'startup settings should use the actual OS state');
    assert.equal((await handlers.get('startup-set')(null, false)).enabled, false);
    assert.equal(preventedColdOpen, true, 'early Finder events should be retained until initialization');
    assert.equal(await handlers.get('app-version')({ sender: window.webContents }), '0.1.2');
    assert.equal(updateRequests, 0, 'reading the version must not send a request');
    assert.equal((await handlers.get('check-for-updates')({ sender: {} })).state, 'error');
    assert.equal(updateRequests, 0, 'untrusted senders cannot initiate a check');
    assert.equal((await handlers.get('check-for-updates')({ sender: window.webContents })).state, 'available');
    assert.equal(updateRequests, 1, 'the request is made only after the explicit check');
    window.webContents.mainFrame = {};
    const childFrame = { sender: window.webContents, senderFrame: {} };
    assert.equal((await handlers.get('startup-set')(childFrame, true)).enabled, false, 'an embedded page cannot change startup');
    assert.equal((await handlers.get('check-for-updates')(childFrame)).state, 'error', 'an embedded page cannot initiate update checks');
    assert.equal((await handlers.get('open-diagnostics')(childFrame)).ok, false, 'an embedded page cannot open local diagnostics');
    ipcMain.emit('open-project-link', { sender: window.webContents }, 'organization');
    ipcMain.emit('open-project-link', { sender: window.webContents }, 'flyfish');
    ipcMain.emit('open-project-link', { sender: window.webContents }, 'releases');
    ipcMain.emit('open-project-link', { sender: window.webContents }, 'https://example.com/');
    ipcMain.emit('open-project-link', { sender: {} }, 'organization');
    assert.deepEqual(externalLinks, ['https://www.chaoleme.cn/', 'https://github.com/flyfish-dev/file-viewer', 'https://github.com/Chaoleme-Studio/quick_look_fast/releases/latest'], 'only known links from a preview window may open');
    const commandsWithPinDisabled = bridgeCommands;
    window.emit('blur');
    assert.equal(bridgeCommands, commandsWithPinDisabled, 'an ordinary preview should not stay on top when focus changes');
    const open = handlers.get('open-file');
    let preview = window.messages.filter((message) => message.channel === 'preview-file').at(-1).payload;
    assert.equal(preview.name, 'first.txt');
    assert.equal(await (await fetch(preview.url)).text(), 'first');
    const openWithDefault = handlers.get('open-with-default');
    assert.equal((await openWithDefault({ sender: {} })).ok, false, 'unknown windows cannot open a path');
    assert.equal((await openWithDefault(childFrame)).ok, false, 'embedded pages cannot open a path');
    assert.equal((await openWithDefault({ sender: window.webContents }, second)).ok, true);
    assert.deepEqual(openedPaths, [first], 'the main process uses its current preview, never a supplied path');
    openPathError = 'No default application';
    assert.match((await openWithDefault({ sender: window.webContents })).message, /No default application/);
    openPathError = '';

    const checkNetwork = (url) => new Promise((resolve) => networkFilter({ url }, resolve));
    assert.equal((await checkNetwork(preview.url)).cancel, false);
    assert.equal((await checkNetwork('https://example.com/file')).cancel, true);
    assert.equal((await routes.get('slowlook')(new Request('slowlook://app/index.html'))).status, 200);

    await open(null, readme);
    const markdown = window.messages.filter((message) => message.channel === 'preview-file').at(-1).payload;
    const resolveImage = handlers.get('resolve-markdown-image');
    assert.equal(await resolveImage({ sender: {} }, markdown.url, 'thumbnail.png'), undefined);
    assert.equal(await resolveImage({ sender: window.webContents }, markdown.url, '../thumbnail.png'), undefined);
    const markdownImage = await resolveImage({ sender: window.webContents }, markdown.url, 'thumbnail.png');
    assert.equal(await (await fetch(markdownImage)).text(), 'fake image bytes');
    assert.equal((await checkNetwork(markdownImage)).cancel, false);
    await open(null, first);
    assert.equal((await fetch(markdownImage)).status, 404, 'switching documents revokes image access');
    preview = window.messages.filter((message) => message.channel === 'preview-file').at(-1).payload;

    app.emit('second-instance', {}, [process.execPath, first], directory);
    assert.equal(window.visible, false);
    assert.equal(window.messages.at(-1).channel, 'clear-preview');
    assert.equal((await fetch(preview.url)).status, 404);
    const countAfterHide = openedPaths.length;
    assert.equal((await openWithDefault({ sender: window.webContents })).ok, false, 'a hidden preview cannot reopen its previous file');
    assert.equal(openedPaths.length, countAfterHide);

    fsPromises.stat = async (filePath, ...args) => {
      if (filePath === first) await new Promise((resolve) => setTimeout(resolve, 50));
      return originalStat(filePath, ...args);
    };
    ipcMain.emit('hide-preview');
    const countBeforeRapid = window.messages.filter((message) => message.channel === 'preview-file').length;
    for (let index = 0; index < 4; index += 1) app.emit('second-instance', {}, [process.execPath, first], directory);
    assert.equal(window.visible, false, 'four rapid presses should end closed even while stat is pending');
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(window.messages.filter((message) => message.channel === 'preview-file').length, countBeforeRapid, 'canceled loads must not reopen a closed window');
    const previewCount = window.messages.filter((message) => message.channel === 'preview-file').length;
    const slow = open(null, first);
    const fast = open(null, second);
    await Promise.all([slow, fast]);
    assert.equal(window.messages.filter((message) => message.channel === 'preview-file').length, previewCount + 1);
    preview = window.messages.filter((message) => message.channel === 'preview-file').at(-1).payload;
    assert.equal(preview.name, '含 空格.txt');
    assert.equal(await (await fetch(preview.url)).text(), 'second');

    // Simulate the JSON event emitted by the Windows Space-key bridge.
    const bridgePreviewCount = window.messages.filter((message) => message.channel === 'preview-file').length;
    fakeBridge.stdout.write(`${JSON.stringify({ type: 'preview', path: first, timestamp: Date.now(), sourceId: 'source-one' })}\n`);
    for (let i = 0; i < 100 && window.messages.filter((message) => message.channel === 'preview-file').length === bridgePreviewCount; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    preview = window.messages.filter((message) => message.channel === 'preview-file').at(-1).payload;
    assert.equal(preview.name, 'first.txt', 'bridge event should open the selected file');
    assert.match(bridgeCommands, /"type":"raise".*"enabled":false/, 'ordinary previews raise without permanent topmost or activation');
    assert.equal(await (await fetch(preview.url)).text(), 'first');

    ipcMain.emit('navigate-selection', {}, 'ArrowDown');
    assert.ok(bridgeCommands.includes('"key":"ArrowDown"'), 'navigation should be sent to the current source');
    const beforeFollowFocusCount = window.focusCount;
    fakeBridge.stdout.write(`${JSON.stringify({ type: 'selection', path: second, sourceId: 'source-one' })}\n`);
    for (let i = 0; i < 100 && window.messages.filter((message) => message.channel === 'preview-file').at(-1).payload.name !== path.basename(second); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    preview = window.messages.filter((message) => message.channel === 'preview-file').at(-1).payload;
    assert.equal(preview.name, path.basename(second), 'selection change should update the preview');
    assert.equal(window.focusCount, beforeFollowFocusCount, 'following a selection must not steal focus from the file manager');

    const countBeforeStale = window.messages.filter((message) => message.channel === 'preview-file').length;
    fakeBridge.stdout.write(`${JSON.stringify({ type: 'selection', path: first, sourceId: 'old-source' })}\n`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(window.messages.filter((message) => message.channel === 'preview-file').length, countBeforeStale, 'stale source events must be ignored');

    // Fix this document in place, then preview a different file in one shared
    // application and bridge. Each window keeps its own valid file token.
    const pinnedWindow = window;
    const pinnedFile = pinnedWindow.messages.filter((message) => message.channel === 'preview-file').at(-1).payload;
    ipcMain.emit('set-pinned', { sender: pinnedWindow.webContents }, true);
    assert.equal(windows.length, 2, 'pinning prewarms one other window');
    assert.equal(pinnedWindow.visible, true, 'fixed preview remains visible');
    assert.equal(pinnedWindow.alwaysOnTop, true, 'pinning keeps this preview above normal windows');
    assert.match(bridgeCommands, /"type":"pin".*"enabled":true/);
    pinnedWindow.emit('blur');
    assert.equal(pinnedWindow.alwaysOnTop, true, 'a pinned preview remains on top after focus changes');
    assert.equal(pinnedWindow.messages.at(-1).payload, true);
    fakeBridge.stdout.write(`${JSON.stringify({ type: 'preview', path: first, sourceId: 'pinned-source-b' })}\n`);
    for (let i = 0; i < 100 && !window.messages.some((message) => message.channel === 'preview-file'); i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(window.messages.filter((message) => message.channel === 'preview-file').at(-1).payload.path, first);
    assert.equal(window.focused, false, 'Space opens without taking file-manager focus');
    assert.equal(window.inactiveShows, 1);
    assert.equal(await (await fetch(pinnedFile.url)).text(), 'second', 'fixed preview retains its own file token');
    const currentUrl = window.messages.filter((message) => message.channel === 'preview-file').at(-1).payload.url;
    assert.equal(await (await fetch(currentUrl)).text(), 'first');
    assert.equal((await openWithDefault({ sender: pinnedWindow.webContents })).ok, true);
    assert.equal(openedPaths.at(-1), second, 'a pinned window opens its own file');
    assert.equal((await openWithDefault({ sender: window.webContents })).ok, true);
    assert.equal(openedPaths.at(-1), first, 'the active window opens its own file');

    // Repeated Space from the same file manager must alternate open/closed.
    for (let n = 0; n < 4; n += 1) {
      fakeBridge.stdout.write(`${JSON.stringify({ type: 'preview', path: first, sourceId: 'cycle-' + n })}\n`);
      const expectedVisible = n % 2 === 1;
      for (let i = 0; i < 100 && window.visible !== expectedVisible; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(window.visible, expectedVisible, 'consecutive Space presses should keep toggling');
      assert.equal(pinnedWindow.visible, true, 'toggling the active window cannot close a fixed preview');
    }
    ipcMain.emit('hide-preview', { sender: pinnedWindow.webContents });
    assert.equal(pinnedWindow.destroyed, true, 'closing a fixed preview releases the window');
    assert.equal((await fetch(pinnedFile.url)).status, 404, 'closing a fixed preview revokes its file token');
    fakeBridge.stdout.write(`${JSON.stringify({ type: 'selection', path: second, sourceId: 'cycle-3' })}\n`);
    for (let i = 0; i < 100 && window.messages.filter((message) => message.channel === 'preview-file').at(-1).payload.path !== second; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    window.focused = true;

    fakeBridge.stdout.write(`${JSON.stringify({ type: 'preview', path: second, timestamp: Date.now(), sourceId: 'source-two' })}\n`);
    for (let i = 0; i < 100 && window.visible; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(window.visible, false, 'repeating the bridge event should hide the preview');
    assert.equal(window.messages.at(-1).channel, 'clear-preview');
    assert.match(bridgeCommands, /"restoreFocus":true/, 'closing a focused preview asks the bridge to restore the source');

    const reopenCount = window.messages.filter((message) => message.channel === 'preview-file').length;
    fakeBridge.stdout.write(`${JSON.stringify({ type: 'preview', path: second, timestamp: Date.now(), sourceId: 'source-three' })}\n`);
    for (let i = 0; i < 100 && window.messages.filter((message) => message.channel === 'preview-file').length === reopenCount; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(window.visible, true, 'after direction-key navigation and closing, Space should open the current selection again');
    ipcMain.emit('hide-preview');

    app.emit('second-instance', {}, [process.execPath, pathToFileURL(second).href], directory);
    for (let i = 0; i < 100 && (!window.visible || window.messages.filter((message) => message.channel === 'preview-file').at(-1).payload.name !== path.basename(second)); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(window.messages.filter((message) => message.channel === 'preview-file').at(-1).payload.name, path.basename(second), 'file URLs should be decoded for desktop launchers');

    let prevented = false;
    app.emit('open-file', { preventDefault: () => { prevented = true; } }, first);
    for (let i = 0; i < 100 && window.messages.filter((message) => message.channel === 'preview-file').at(-1).payload.name !== 'first.txt'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(prevented, true);
    assert.equal(window.messages.filter((message) => message.channel === 'preview-file').at(-1).payload.name, 'first.txt', 'Finder open-file events should be forwarded');

    await open(null, shortcut);
    preview = window.messages.filter((message) => message.channel === 'preview-file').at(-1).payload;
    assert.equal(preview.shortcut.target, 'C:\\Target Folder\\document.txt');
    assert.equal(preview.path, shortcut);
    assert.ok(preview.modifiedAt);
    await open(null, folderShortcut);
    const linkedFolder = window.messages.filter((message) => message.channel === 'preview-directory').at(-1).payload;
    assert.equal(linkedFolder.path, shortcutFolder, 'a folder shortcut should preview its target folder');
    assert.equal(linkedFolder.shortcutPath, folderShortcut);
    assert.ok((await handlers.get('read-directory')(null, linkedFolder.id, 0)).entries.some((entry) => entry.name === 'inside.txt'));
    const beforeDelayedFolder = window.messages.filter((message) => message.channel === 'preview-directory').length;
    fsPromises.stat = async (filePath, ...args) => {
      if (filePath === shortcutFolder) await new Promise((resolve) => setTimeout(resolve, 50));
      return originalStat(filePath, ...args);
    };
    const delayedShortcut = open(null, folderShortcut);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const laterFile = open(null, second);
    await Promise.all([delayedShortcut, laterFile]);
    assert.equal(window.messages.filter((message) => message.channel === 'preview-directory').length, beforeDelayedFolder, 'a slow shortcut must not replace a newer preview');
    assert.equal(window.messages.filter((message) => message.channel === 'preview-file').at(-1).payload.path, second);
    fsPromises.stat = originalStat;
    await open(null, directory);
    const folder = window.messages.filter((message) => message.channel === 'preview-directory').at(-1).payload;
    assert.equal(folder.path, directory);
    const listing = await handlers.get('read-directory')(null, folder.id, 0);
    assert.ok(listing.entries.some((entry) => entry.name === 'first.txt'));
    const entry = listing.entries.find((item) => item.name === 'first.txt');
    const openFolderFile = handlers.get('open-directory-file');
    await assert.rejects(() => openFolderFile(null, first, 'preview'), /失效/);
    await assert.rejects(() => openFolderFile(null, entry.id, 'thumbnail'), /缩略图/);
    const childFile = await openFolderFile(null, entry.id, 'preview');
    assert.equal(await (await fetch(childFile.url)).text(), 'first');
    assert.equal((await openWithDefault({ sender: window.webContents })).ok, true);
    assert.equal(openedPaths.at(-1), directory, 'the title-bar action opens the previewed folder');
    assert.equal((await checkNetwork(childFile.url)).cancel, false);
    ipcMain.emit('release-directory-preview', { sender: window.webContents }, 'stale-folder-id');
    assert.equal((await fetch(childFile.url)).status, 200, 'a stale folder cleanup cannot revoke a newer folder preview');
    ipcMain.emit('release-directory-preview', { sender: window.webContents }, folder.id);
    assert.equal((await fetch(childFile.url)).status, 404, 'closing a child preview revokes its token');
    const markdownEntry = listing.entries.find((item) => item.name === 'README.md');
    const markdownChild = await openFolderFile(null, markdownEntry.id, 'preview');
    const childImage = await resolveImage({ sender: window.webContents }, markdownChild.url, 'thumbnail.png');
    assert.equal(await (await fetch(childImage)).text(), 'fake image bytes');
    ipcMain.emit('release-directory-preview', { sender: window.webContents }, folder.id);
    assert.equal((await fetch(childImage)).status, 404, 'closing a folder child revokes its Markdown images');
    const imageEntry = listing.entries.find((item) => item.name === 'thumbnail.png');
    const thumbnail = await openFolderFile(null, imageEntry.id, 'thumbnail');
    const imagePreview = await openFolderFile(null, imageEntry.id, 'preview');
    assert.notEqual(thumbnail.url, imagePreview.url, 'thumbnail and file preview have separate lifetimes');
    ipcMain.emit('release-directory-preview', { sender: window.webContents }, folder.id);
    assert.equal((await fetch(imagePreview.url)).status, 404);
    assert.equal((await fetch(thumbnail.url)).status, 200, 'closing a preview does not break its thumbnail');
    const retainedFile = await openFolderFile(null, entry.id, 'preview');
    const folderWindow = window;
    ipcMain.emit('set-pinned', { sender: folderWindow.webContents }, true);
    await open({ sender: window.webContents }, first);
    const retained = await handlers.get('read-directory')({ sender: folderWindow.webContents }, folder.id, 0);
    assert.ok(retained.entries.some((entry) => entry.name === 'first.txt'), 'a fixed folder has its own directory service');
    assert.equal(await (await fetch(retainedFile.url)).text(), 'first', 'a fixed folder keeps its own child capability');
    const newerWindow = window;
    ipcMain.emit('set-pinned', { sender: folderWindow.webContents }, false);
    assert.equal(folderWindow.alwaysOnTop, false, 'unpinning restores normal z-order');
    assert.equal(newerWindow.alwaysOnTop, true, 'preserving another visible preview also pins its z-order');
    assert.equal(newerWindow.messages.filter((message) => message.channel === 'pin-state').at(-1).payload, true, 'unpinning preserves an already visible active preview');
    ipcMain.emit('hide-preview', { sender: newerWindow.webContents });
    assert.equal(newerWindow.destroyed, true);
    ipcMain.emit('hide-preview', { sender: folderWindow.webContents });
    assert.equal((await fetch(retainedFile.url)).status, 404, 'closing the folder revokes child access');
    assert.equal((await fetch(thumbnail.url)).status, 404, 'closing the folder revokes thumbnail access');
    await assert.rejects(() => handlers.get('read-directory')(null, folder.id, 0), /已失效/);
    await open({ sender: folderWindow.webContents }, first);
    folderWindow.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: -1 });
    assert.match(folderWindow.messages.filter((message) => message.channel === 'preview-error').at(-1).payload, /已恢复/);
    fakeBridge.stdin.emit('error', Object.assign(new Error('broken pipe'), { code: 'EPIPE' }));
    assert.match(folderWindow.messages.filter((message) => message.channel === 'integration-status').at(-1).payload, /连接已中断/);
    for (let i = 0; i < 3; i++) folderWindow.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: -1 });
    assert.equal(folderWindow.destroyed, true, 'repeated renderer failures do not cause an endless restart loop');
    fakeBridge.kill();
  } finally {
    fsPromises.stat = originalStat;
    Module._load = originalLoad;
    app.emit('before-quit');
    unlinkSync(first);
    unlinkSync(second);
    unlinkSync(shortcut);
    unlinkSync(folderShortcut);
    unlinkSync(photo);
    unlinkSync(readme);
    unlinkSync(path.join(shortcutFolder, 'inside.txt'));
    rmdirSync(shortcutFolder);
    rmdirSync(directory);
  }
});
