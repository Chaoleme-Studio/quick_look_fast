const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const Module = require('node:module');

test('Linux native frame keeps preview close and reopen behavior', { timeout: 5000 }, async () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const sessionType = process.env.XDG_SESSION_TYPE;
  const originalLoad = Module._load;
  const userData = mkdtempSync(path.join(tmpdir(), 'quicklook-linux-window-'));
  const app = new EventEmitter();
  Object.assign(app, {
    isPackaged: false,
    commandLine: { appendSwitch() {} },
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    getPath: () => userData,
    getAppPath: () => process.cwd(),
    quit: () => app.emit('before-quit'),
  });
  const ipcMain = new EventEmitter();
  ipcMain.handle = () => {};
  let window;
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      window = this;
      this.options = options;
      this.visible = false;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.send = () => {};
    }
    loadURL() { queueMicrotask(() => this.webContents.emit('did-finish-load')); return Promise.resolve(); }
    isDestroyed() { return false; }
    isMinimized() { return false; }
    isVisible() { return this.visible; }
    isFocused() { return this.visible; }
    show() { this.visible = true; }
    focus() {}
    hide() { this.visible = false; }
  }
  class Tray extends EventEmitter { setToolTip() {} setContextMenu() {} destroy() {} }
  const electron = {
    app, BrowserWindow, ipcMain, Tray,
    screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1024, height: 720 } }) },
    protocol: { registerSchemesAsPrivileged() {}, handle() {} },
    session: { defaultSession: { webRequest: { onBeforeRequest() {} } } },
    nativeImage: { createFromPath: () => ({ isEmpty: () => false }) },
    Menu: { buildFromTemplate: () => ({}) },
    globalShortcut: { unregisterAll() {} },
    dialog: {}, shell: {},
  };
  Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
  process.env.XDG_SESSION_TYPE = 'wayland';
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electron;
    if (request === './platform/linux/previewer') return { startLinuxPreviewer: async () => undefined };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    require('../build/dist-electron/main.js');
    for (let attempt = 0; attempt < 200 && !window?.visible; attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(window?.visible, 'the initial window opens');
    assert.equal(window.options.frame, true, 'Linux uses the system window frame');
    assert.equal(window.options.resizable, true, 'the window remains resizable');
    assert.equal(window.options.width, 839);
    assert.equal(window.options.height, 590);

    let prevented = false;
    window.emit('close', { preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true, 'system close keeps the application running');
    assert.equal(window.visible, false, 'system close hides the preview');
    app.emit('second-instance', {}, [process.execPath], process.cwd());
    assert.equal(window.visible, true, 'a later activation reopens the same window');
    ipcMain.emit('hide-preview', { sender: window.webContents });
    assert.equal(window.visible, false, 'renderer Space/Esc hide requests still hide it');
  } finally {
    app.emit('before-quit');
    Module._load = originalLoad;
    Object.defineProperty(process, 'platform', platform);
    if (sessionType === undefined) delete process.env.XDG_SESSION_TYPE;
    else process.env.XDG_SESSION_TYPE = sessionType;
    rmSync(userData, { recursive: true, force: true });
  }
});
