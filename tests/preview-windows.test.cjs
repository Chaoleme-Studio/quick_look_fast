const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const Module = require('node:module');

async function waitFor(condition, message) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

for (const platform of ['darwin', 'win32']) {
  test(`${platform}: fixed previews, active selection and topmost are independent`, { timeout: 15000 }, async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    const originalLoad = Module._load;
    const mainPath = require.resolve('../build/dist-electron/main.js');
    const directory = mkdtempSync(path.join(tmpdir(), 'quicklook-window-states-'));
    const files = ['A.txt', 'B.txt', 'C.txt'].map((name) => {
      const file = path.join(directory, name);
      writeFileSync(file, name);
      return file;
    });
    const app = new EventEmitter();
    Object.assign(app, {
      isPackaged: false,
      commandLine: { appendSwitch() {} },
      requestSingleInstanceLock: () => true,
      whenReady: () => Promise.resolve(),
      getPath: () => directory,
      getLoginItemSettings: () => ({ wasOpenedAtLogin: false }),
      setActivationPolicy() {},
      quit: () => app.emit('before-quit'),
    });
    const ipcMain = new EventEmitter();
    const handlers = new Map();
    ipcMain.handle = (name, handler) => handlers.set(name, handler);
    const windows = [];
    class BrowserWindow extends EventEmitter {
      constructor(options) {
        super();
        this.options = options;
        this.visible = false;
        this.focused = false;
        this.destroyed = false;
        this.alwaysOnTop = options.alwaysOnTop;
        this.raised = 0;
        this.inactiveShows = 0;
        this.messages = [];
        this.webContents = new EventEmitter();
        this.webContents.setWindowOpenHandler = () => {};
        this.webContents.send = (channel, payload) => this.messages.push({ channel, payload });
        windows.push(this);
      }
      loadURL() { queueMicrotask(() => this.webContents.emit('did-finish-load')); return Promise.resolve(); }
      isDestroyed() { return this.destroyed; }
      isMinimized() { return false; }
      isVisible() { return this.visible; }
      isFocused() { return this.focused; }
      getBounds() { return { x: 1020, y: 530, width: 900, height: 550 }; }
      getNativeWindowHandle() { const buffer = Buffer.alloc(8); buffer.writeBigUInt64LE(BigInt(windows.indexOf(this) + 1)); return buffer; }
      show() { this.visible = true; this.focused = true; this.emit('show'); }
      showInactive() { this.visible = true; this.focused = false; this.inactiveShows++; this.emit('show'); }
      moveTop() { this.raised++; }
      focus() { this.focused = true; }
      hide() { this.visible = false; this.focused = false; this.emit('hide'); }
      destroy() { this.destroyed = true; this.visible = false; this.emit('closed'); }
      setAlwaysOnTop(value) { this.alwaysOnTop = value; }
    }
    class Tray extends EventEmitter { setToolTip() {} setContextMenu() {} destroy() {} }
    const electron = {
      app, BrowserWindow, ipcMain, Tray,
      protocol: { registerSchemesAsPrivileged() {}, handle() {} },
      session: { defaultSession: { webRequest: { onBeforeRequest() {} } } },
      screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
      nativeImage: { createFromPath: () => ({ isEmpty: () => false, setTemplateImage() {} }) },
      Menu: { buildFromTemplate: () => ({}) },
      globalShortcut: { unregister() {}, unregisterAll() {}, register: () => true },
      systemPreferences: { isTrustedAccessibilityClient: () => true },
      dialog: {}, shell: {},
    };
    const bridge = new EventEmitter();
    bridge.stdout = new PassThrough();
    bridge.stdin = new PassThrough();
    bridge.stderr = new PassThrough();
    bridge.kill = () => { bridge.stdout.end(); bridge.stdin.end(); bridge.stderr.end(); };
    const commands = [];
    let commandBuffer = '';
    bridge.stdin.on('data', (chunk) => {
      commandBuffer += chunk.toString();
      const lines = commandBuffer.split('\n');
      commandBuffer = lines.pop();
      for (const line of lines) if (line) commands.push(JSON.parse(line));
    });
    const forgotten = [];
    let finderCallbacks;
    const finder = { track() {}, forget: (id) => forgotten.push(id), navigate() {}, stop() {} };
    Object.defineProperty(process, 'platform', { ...originalPlatform, value: platform });
    Module._load = function (request, parent, isMain) {
      if (request === 'electron') return electron;
      if (request === 'node:child_process') return { ...originalLoad.call(this, request, parent, isMain), spawn: () => bridge };
      if (request === './platform/macos-finder') return { startFinderSpaceBridge: (_binary, callbacks) => { finderCallbacks = callbacks; return finder; }, selectedFinderFile: async () => undefined };
      return originalLoad.call(this, request, parent, isMain);
    };
    const last = (window, channel) => window.messages.filter((message) => message.channel === channel).at(-1)?.payload;
    const sendPreview = (file, sourceId) => {
      if (platform === 'darwin') finderCallbacks.onFile(file, sourceId);
      else bridge.stdout.write(`${JSON.stringify({ type: 'preview', path: file, sourceId })}\n`);
    };
    const sendSelection = (file, sourceId) => {
      if (platform === 'darwin') finderCallbacks.onSelection(file, sourceId);
      else bridge.stdout.write(`${JSON.stringify({ type: 'selection', path: file, sourceId })}\n`);
    };
    const sourceForgetCount = () => platform === 'darwin' ? forgotten.length : commands.filter((command) => command.type === 'forget').length;
    try {
      delete require.cache[mainPath];
      require(mainPath);
      await waitFor(() => windows[0]?.visible && handlers.has('open-file') && (platform === 'win32' || finderCallbacks), 'application failed to initialize');
      if (platform === 'darwin') finderCallbacks.onStatus('active');

      const a = windows[0];
      sendPreview(files[0], 'source-a');
      await waitFor(() => last(a, 'preview-file')?.path === files[0], 'first preview did not open');
      if (platform === 'darwin') {
        assert.equal(a.inactiveShows, 1, 'the first Finder preview uses the inactive foreground operation');
        assert.equal(a.raised, 0, 'ordinary window ordering must not undo the inactive foreground operation');
      }
      const aUrl = last(a, 'preview-file').url;
      ipcMain.emit('set-always-on-top', { sender: a.webContents }, true);
      ipcMain.emit('set-pinned', { sender: a.webContents }, true);
      assert.equal(a.alwaysOnTop, true, 'pinning must preserve the separately chosen topmost state');
      ipcMain.emit('set-always-on-top', { sender: a.webContents }, false);
      assert.equal(last(a, 'pin-state'), true, 'disabling topmost must not unpin');
      assert.equal(windows.length, 2, 'pinning creates one reusable active window');

      const b = windows[1];
      assert.equal(b.options.x, 984, 'new window moves inward when the old one is at the right edge');
      assert.equal(b.options.y, 494, 'new window moves inward when the old one is at the bottom edge');
      sendPreview(files[1], 'source-b');
      await waitFor(() => last(b, 'preview-file')?.path === files[1], 'second preview did not open');
      assert.equal(b.alwaysOnTop, false);
      assert.equal(last(b, 'pin-state'), false);
      if (platform === 'darwin') {
        assert.equal(b.inactiveShows, 1, 'a new Mac preview is shown without taking focus');
        assert.equal(b.raised, 0, 'ordinary window ordering must not push it behind Finder');
      }
      else assert.ok(commands.some((command) => command.type === 'raise' && command.enabled === false), 'a new Windows preview is raised without remaining topmost');
      assert.equal(b.focused, false);

      const forgetsBeforeUnpin = sourceForgetCount();
      ipcMain.emit('set-pinned', { sender: a.webContents }, false);
      assert.equal(last(a, 'pin-state'), false);
      assert.equal(last(b, 'pin-state'), false, 'unpinning A must not pin B');
      assert.equal(sourceForgetCount(), forgetsBeforeUnpin, 'unpinning A must retain B\'s file-manager connection');
      assert.equal(await (await fetch(aUrl)).text(), 'A.txt', 'A keeps its own file');
      sendSelection(files[2], 'source-b');
      await waitFor(() => last(b, 'preview-file')?.path === files[2], 'active B stopped following its source');
      assert.equal(last(a, 'preview-file').path, files[0], 'detached A does not follow B\'s selection');

      ipcMain.emit('set-pinned', { sender: a.webContents }, true);
      assert.equal(windows.length, 2, 'pinning a detached window does not replace the active window');
      ipcMain.emit('set-pinned', { sender: a.webContents }, false);
      ipcMain.emit('set-pinned', { sender: b.webContents }, true);
      assert.equal(windows.length, 3);
      const c = windows[2];
      sendPreview(files[1], 'source-c');
      await waitFor(() => last(c, 'preview-file')?.path === files[1], 'third preview did not open');
      ipcMain.emit('set-pinned', { sender: b.webContents }, false);
      assert.equal(last(c, 'pin-state'), false, 'unpinning B must not pin C');
      ipcMain.emit('hide-preview', { sender: b.webContents });
      assert.equal(b.destroyed, true, 'closing a detached window releases it');
      assert.equal(c.visible, true);

      ipcMain.emit('set-pinned', { sender: a.webContents }, true);
      ipcMain.emit('hide-preview', { sender: c.webContents });
      assert.equal(c.visible, false);
      ipcMain.emit('set-pinned', { sender: a.webContents }, false);
      assert.equal(c.destroyed, true, 'an unused prewarmed window is released when A becomes active');
      sendPreview(files[1], 'source-resumed');
      await waitFor(() => last(a, 'preview-file')?.path === files[1], 'A did not resume as the active preview');
      assert.equal(last(a, 'pin-state'), false);
    } finally {
      app.emit('before-quit');
      delete require.cache[mainPath];
      Module._load = originalLoad;
      Object.defineProperty(process, 'platform', originalPlatform);
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
