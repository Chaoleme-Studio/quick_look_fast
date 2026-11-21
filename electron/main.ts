import { app, BrowserWindow, crashReporter, dialog, globalShortcut, ipcMain, Menu, nativeImage, protocol, session, shell, systemPreferences, Tray } from 'electron';
import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { fileResponse } from './files/protocol';
import { startFileServer, type ActiveFile } from './files/file-server';
import { DirectoryService } from './files/directory-service';
import { readStartup, writeStartup } from './platform/login-startup';
import { selectedFinderFile, startFinderSpaceBridge } from './platform/macos-finder';
import { defaultMacSettings, isFinderMode, readMacSettings, writeMacSettings, type FinderMode, type MacSettings } from './platform/macos-settings';
import { checkForUpdates } from './support/update-checker';
import { recordDiagnostic } from './support/diagnostics';
import { enableLocalCrashReports } from './support/crash-reporting';
import { resolveMarkdownImage } from './files/markdown-images';
import type { Server } from 'node:http';
import type { LinuxPreviewer } from './platform/linux/previewer';

protocol.registerSchemesAsPrivileged([{
  scheme: 'slowlook',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
}]);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const appRoot = path.resolve(__dirname, '..', '..');
const rendererRoot = path.join(appRoot, 'build', 'dist');
interface PreviewContext {
  window: BrowserWindow;
  directories: DirectoryService;
  currentFile?: ActiveFile;
  folderFiles: Map<string, ActiveFile>;
  markdownImages: Map<string, ActiveFile>;
  folderPreview?: ActiveFile;
  folderSelection: number;
  folderRootId?: string;
  currentPath?: string;
  version: number;
  started: number;
  ready: boolean;
  pending: Array<{ channel: string; payload?: unknown }>;
  pinned: boolean;
  disposed: boolean;
  contentWorker?: Worker;
  rendererFailures: number[];
  loaded: Promise<void>;
}

const contexts = new Map<Electron.WebContents, PreviewContext>();
let active: PreviewContext | undefined;
let tray: Tray | undefined;
let bridge: ChildProcessWithoutNullStreams | undefined;
let fileServer: Server | undefined;
let fileServerOrigin = '';
let integrationStatus = '';
let isQuitting = false;
let initialized = false;
let activeSourceId: string | undefined;
let queuedSecondInstance: { args: string[]; workingDirectory: string } | undefined;
let queuedOpenFile: string | undefined;
let linuxPreviewer: LinuxPreviewer | undefined;
const finderShortcut = 'Command+Shift+Space';
let finderSpace: ReturnType<typeof startFinderSpaceBridge> | undefined;
let finderRevision = 0;
let finderSourceId: string | undefined;
let finderShortcutSerial = 0;
let finderNavigationReady = false;
let macSettings = { ...defaultMacSettings };
let hasMacSettings = false;

function diagnostic(event: string, details: { reason?: string; exitCode?: number; processType?: string } = {}): void {
  try { recordDiagnostic(app.getPath('userData'), event, details); } catch { /* Logging is optional. */ }
}

function bridgeFailed(child: ChildProcessWithoutNullStreams, reason: string): void {
  if (bridge !== child) return;
  bridge = undefined;
  diagnostic('bridge-failed', { reason });
  if (!isQuitting) sendStatus('资源管理器连接已中断，请重启 QuickLook Fast。');
}

function writeBridge(message: Record<string, unknown>): void {
  const child = bridge;
  if (!child || child.stdin.destroyed || !child.stdin.writable) return;
  try {
    child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
      if (error) bridgeFailed(child, (error as NodeJS.ErrnoException).code || 'write-failed');
    });
  } catch (error) { bridgeFailed(child, (error as NodeJS.ErrnoException).code || 'write-failed'); }
}

function trace(ctx: PreviewContext, event: string, extra: Record<string, unknown> = {}): void {
  if (process.env.SLOWLOOK_BENCHMARK === '1') {
    console.log(JSON.stringify({ event, elapsedMs: ctx.started ? Date.now() - ctx.started : 0, ...extra }));
  }
}

function send(ctx: PreviewContext, channel: string, payload?: unknown): void {
  if (ctx.disposed || ctx.window.isDestroyed()) return;
  if (!ctx.ready) { ctx.pending.push({ channel, payload }); return; }
  ctx.window.webContents.send(channel, payload);
}

function sendStatus(message: string): void {
  integrationStatus = message;
  for (const ctx of contexts.values()) send(ctx, 'integration-status', message);
}

function syncNativeTopmost(ctx: PreviewContext): void {
  if (process.platform !== 'win32' || !bridge?.stdin.writable || ctx.disposed || ctx.window.isDestroyed()) return;
  const handle = ctx.window.getNativeWindowHandle();
  const value = handle.length >= 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
  writeBridge({ type: 'pin', handle: value, enabled: ctx.pinned });
}

function raiseWithoutActivation(ctx: PreviewContext): void {
  if (process.platform !== 'win32' || !bridge?.stdin.writable || ctx.disposed || ctx.window.isDestroyed()) return;
  const handle = ctx.window.getNativeWindowHandle();
  const value = handle.length >= 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
  writeBridge({ type: 'raise', handle: value, enabled: ctx.pinned });
}

function showWindow(ctx: PreviewContext, focus = true): void {
  if (ctx.disposed) return;
  if (ctx.window.isMinimized()) ctx.window.restore();
  if (focus) {
    if (!ctx.window.isVisible()) ctx.window.show();
    ctx.window.focus();
  } else {
    // Also raise a visible preview that was covered by another window, while
    // keeping keyboard focus in the file manager for the next Space press.
    ctx.window.showInactive();
    raiseWithoutActivation(ctx);
  }
  trace(ctx, 'window-show-requested');
}

function forgetSource(restoreFocus = false): void {
  const sourceId = activeSourceId;
  activeSourceId = undefined;
  if (finderSourceId) {
    finderSpace?.forget(finderSourceId);
    finderSourceId = undefined;
  }
  writeBridge({ type: 'forget', sourceId, restoreFocus });
}

function invalidate(ctx: PreviewContext): void {
  void ctx.contentWorker?.terminate();
  ctx.contentWorker = undefined;
  ctx.version += 1;
  ctx.currentFile = undefined;
  ctx.folderSelection += 1;
  ctx.folderPreview = undefined;
  ctx.folderRootId = undefined;
  ctx.folderFiles.clear();
  ctx.markdownImages.clear();
  ctx.currentPath = undefined;
  ctx.directories.clear();
}

function destroyWindow(ctx: PreviewContext): void {
  if (ctx.disposed) return;
  invalidate(ctx);
  ctx.disposed = true;
  contexts.delete(ctx.window.webContents);
  if (active === ctx) {
    active = undefined;
    if (finderSourceId) forgetSource();
  }
  if (!ctx.window.isDestroyed()) ctx.window.destroy();
}

function hideWindow(ctx: PreviewContext): void {
  if (ctx.disposed) return;
  if (ctx.pinned) { destroyWindow(ctx); return; }
  const restoreSourceFocus = ctx.window.isFocused();
  invalidate(ctx);
  send(ctx, 'clear-preview');
  ctx.window.hide();
  if (ctx === active) forgetSource(restoreSourceFocus);
}

function createPreviewWindow(previous?: PreviewContext): PreviewContext {
  const previousBounds = previous && !previous.disposed && !previous.window.isDestroyed() ? previous.window.getBounds() : undefined;
  const win = new BrowserWindow({
    width: 1080, height: 760, minWidth: 640, minHeight: 480,
    ...(previousBounds ? { x: previousBounds.x + 36, y: previousBounds.y + 36 } : {}),
    show: false, alwaysOnTop: false, skipTaskbar: process.platform === 'win32',
    icon: path.join(rendererRoot, 'branding', 'app.png'), frame: false, backgroundColor: '#11141b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, backgroundThrottling: true,
    },
  });
  const ctx: PreviewContext = {
    window: win, directories: new DirectoryService(), folderFiles: new Map(), markdownImages: new Map(), folderSelection: 0, version: 0, started: 0,
    ready: false, pending: [], pinned: false, disposed: false, rendererFailures: [],
    loaded: Promise.resolve(),
  };
  const contents = win.webContents;
  contexts.set(contents, ctx);
  win.on('close', (event) => {
    if (!isQuitting) { event.preventDefault(); hideWindow(ctx); }
  });
  win.on('closed', () => {
    if (!ctx.disposed) {
      invalidate(ctx);
      ctx.disposed = true;
      contexts.delete(contents);
      if (active === ctx) {
        active = undefined;
        if (finderSourceId) forgetSource();
      }
    }
  });
  win.on('show', () => { if (ctx === active) linuxPreviewer?.visibilityChanged(true); syncNativeTopmost(ctx); });
  win.on('hide', () => { if (ctx === active) linuxPreviewer?.visibilityChanged(false); });
  win.on('blur', () => {
    if (ctx.pinned && win.isVisible()) { win.setAlwaysOnTop(true, 'floating'); syncNativeTopmost(ctx); }
  });
  win.on('unresponsive', () => diagnostic('window-unresponsive'));
  win.on('responsive', () => diagnostic('window-responsive'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (process.platform === 'darwin') win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.meta && !input.control && !input.alt && !input.shift && input.key.toLowerCase() === 'q') {
      event.preventDefault();
      app.quit();
    }
  });
  win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('slowlook://app/')) event.preventDefault(); });
  win.webContents.on('did-finish-load', () => {
    ctx.ready = true;
    for (const item of ctx.pending.splice(0)) win.webContents.send(item.channel, item.payload);
    if (integrationStatus) win.webContents.send('integration-status', integrationStatus);
    win.webContents.send('pin-state', ctx.pinned);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    if (ctx.disposed || isQuitting) return;
    diagnostic('renderer-gone', { reason: details.reason, exitCode: details.exitCode });
    ctx.ready = false;
    const now = Date.now();
    ctx.rendererFailures = ctx.rendererFailures.filter((time) => now - time < 60_000);
    ctx.rendererFailures.push(now);
    if (ctx.rendererFailures.length > 3) {
      diagnostic('renderer-recovery-stopped');
      destroyWindow(ctx);
      sendStatus('预览窗口多次崩溃，已停止自动恢复；可重新打开应用或查看运行日志。');
      return;
    }
    invalidate(ctx);
    ctx.pending = [{ channel: 'preview-error', payload: '预览进程已退出，窗口已恢复；请尝试重新打开文件。' }];
    void win.loadURL('slowlook://app/index.html').catch((error) => console.error('预览窗口恢复失败', error));
  });
  ctx.loaded = win.loadURL('slowlook://app/index.html').catch((error) => {
    if (!ctx.disposed) console.error('预览窗口加载失败', error);
  });
  return ctx;
}

function ensureActive(previous?: PreviewContext): PreviewContext {
  if (!active || active.disposed || active.window.isDestroyed()) active = createPreviewWindow(previous);
  return active;
}

function setPinned(ctx: PreviewContext, value: boolean): void {
  if (ctx.disposed || ctx.pinned === value) return;
  if (value) {
    if (!ctx.currentPath) { send(ctx, 'pin-state', false); return; }
    ctx.pinned = true;
    ctx.window.setAlwaysOnTop(true, 'floating');
    syncNativeTopmost(ctx);
    send(ctx, 'pin-state', true);
    if (active === ctx) {
      active = undefined;
      forgetSource();
      ensureActive(ctx); // Prewarm one reusable window, not another application instance.
    }
    return;
  }
  const previous = active;
  if (previous && previous !== ctx && !previous.disposed) {
    if (previous.currentPath && previous.window.isVisible()) {
      previous.pinned = true;
      previous.window.setAlwaysOnTop(true, 'floating');
      syncNativeTopmost(previous);
      send(previous, 'pin-state', true);
    } else destroyWindow(previous);
  }
  forgetSource();
  ctx.pinned = false;
  ctx.window.setAlwaysOnTop(false, 'floating');
  syncNativeTopmost(ctx);
  active = ctx;
  send(ctx, 'pin-state', false);
}

function fromEvent(event: { sender?: Electron.WebContents; senderFrame?: Electron.WebFrameMain | null } | undefined): PreviewContext | undefined {
  if (event?.sender && 'senderFrame' in event && event.senderFrame !== event.sender.mainFrame) return undefined;
  return event?.sender ? contexts.get(event.sender) : active;
}

function releaseFolderSelection(ctx: PreviewContext): void {
  ctx.folderSelection += 1;
  ctx.markdownImages.clear();
  const selected = ctx.folderPreview;
  ctx.folderPreview = undefined;
  if (selected) {
    for (const [id, file] of ctx.folderFiles) if (file === selected) ctx.folderFiles.delete(id);
    void ctx.contentWorker?.terminate();
    ctx.contentWorker = undefined;
  }
}

async function openFile(ctx: PreviewContext, filePath: string, triggeredAt = Date.now(), focus = true): Promise<void> {
  if (ctx.disposed || typeof filePath !== 'string' || !filePath) return;
  void ctx.contentWorker?.terminate();
  ctx.contentWorker = undefined;
  const absolutePath = path.resolve(filePath);
  const version = ++ctx.version;
  ctx.currentPath = absolutePath;
  ctx.currentFile = undefined;
  ctx.folderSelection += 1;
  ctx.folderPreview = undefined;
  ctx.folderRootId = undefined;
  ctx.folderFiles.clear();
  ctx.markdownImages.clear();
  ctx.directories.clear();
  ctx.started = triggeredAt;
  showWindow(ctx, focus);
  send(ctx, 'preview-start', {
    name: path.basename(filePath),
    ...(process.platform === 'darwin' ? { finderNavigation: Boolean(finderSourceId && finderNavigationReady) } : {}),
  });
  try {
    const info = await stat(absolutePath);
    if (ctx.disposed || version !== ctx.version) return;
    if (info.isDirectory()) {
      const id = ctx.directories.open(absolutePath);
      ctx.folderRootId = id;
      send(ctx, 'preview-directory', { id, name: path.basename(absolutePath) || absolutePath, path: absolutePath, modifiedAt: info.mtime.toISOString() });
      trace(ctx, 'directory-sent');
      return;
    }
    if (!info.isFile()) throw new Error('请选择一个文件或文件夹');
    const name = path.basename(absolutePath);
    let shortcut: { target?: string; description?: string } | undefined;
    if (process.platform === 'win32' && path.extname(name).toLowerCase() === '.lnk') {
      try { const link = shell.readShortcutLink(absolutePath); shortcut = { target: link.target, description: link.description }; }
      catch { /* A damaged or inaccessible shortcut can still show basic information. */ }
      if (shortcut?.target && path.isAbsolute(shortcut.target)) {
        try {
          const targetInfo = await stat(shortcut.target);
          if (ctx.disposed || version !== ctx.version) return;
          if (targetInfo.isDirectory()) {
            const id = ctx.directories.open(shortcut.target);
            ctx.folderRootId = id;
            send(ctx, 'preview-directory', { id, name: path.basename(shortcut.target) || shortcut.target,
              path: shortcut.target, shortcutPath: absolutePath, modifiedAt: targetInfo.mtime.toISOString() });
            trace(ctx, 'directory-shortcut-sent');
            return;
          }
        } catch { /* An inaccessible target remains a shortcut information preview. */ }
        if (ctx.disposed || version !== ctx.version) return;
      }
    }
    const token = randomBytes(18).toString('hex');
    ctx.currentFile = { token, path: absolutePath };
    send(ctx, 'preview-file', {
      url: `${fileServerOrigin}/preview/${token}/${encodeURIComponent(name)}`, name, size: info.size,
      path: absolutePath, modifiedAt: info.mtime.toISOString(), createdAt: info.birthtime.toISOString(), shortcut,
    });
    trace(ctx, 'file-sent', { name, size: info.size });
  } catch (error) {
    if (ctx.disposed || version !== ctx.version) return;
    ctx.currentFile = undefined;
    ctx.currentPath = undefined;
    ctx.directories.clear();
    send(ctx, 'preview-error', `无法打开文件：${error instanceof Error ? error.message : String(error)}`);
  }
}

function openExternalFile(filePath: string, triggeredAt = Date.now()): void {
  const ctx = ensureActive();
  const absolutePath = path.resolve(filePath);
  const sameFile = ctx.currentPath && (process.platform === 'win32'
    ? ctx.currentPath.toLowerCase() === absolutePath.toLowerCase() : ctx.currentPath === absolutePath);
  if (sameFile && ctx.window.isVisible()) hideWindow(ctx);
  else void openFile(ctx, absolutePath, triggeredAt, false);
}

function findPath(args: string[], workingDirectory: string): string | undefined {
  let literalArguments = false;
  for (const value of args) {
    if (value === '--') { literalArguments = true; continue; }
    if ((!literalArguments && value.startsWith('-')) || value === '.' || value === app.getAppPath()) continue;
    try {
      if (/^file:/i.test(value)) return fileURLToPath(value);
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) continue;
      return path.resolve(workingDirectory, value);
    } catch { /* Skip invalid URLs and try the next argument. */ }
  }
  return undefined;
}

function trayIcon(): Electron.NativeImage {
  const iconPath = path.join(rendererRoot, 'branding', process.platform === 'darwin' ? 'tray-macos.png' : 'tray.png');
  const branded = nativeImage.createFromPath(iconPath);
  if (!branded.isEmpty()) {
    return branded;
  }
  const side = 32;
  const bitmap = Buffer.alloc(side * side * 4);
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const offset = (y * side + x) * 4;
      const rounded = (x < 4 || x > 27) && (y < 4 || y > 27);
      const distance = Math.hypot(x - 14, y - 13);
      const white = (distance > 6 && distance < 8) || (x >= 19 && x <= 25 && Math.abs(y - x + 1) <= 1);
      bitmap[offset] = white ? 255 : 174; bitmap[offset + 1] = white ? 255 : 120;
      bitmap[offset + 2] = white ? 255 : 81; bitmap[offset + 3] = rounded ? 0 : 255;
    }
  }
  return nativeImage.createFromBitmap(bitmap, { width: side, height: side, scaleFactor: 2 });
}

function setTrayVisible(visible: boolean): void {
  if (!visible) { tray?.destroy(); tray = undefined; return; }
  if (tray) return;
  tray = new Tray(trayIcon());
  tray.setToolTip('QuickLook Fast');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 QuickLook Fast', click: () => showWindow(ensureActive()) },
    { label: '选择文件…', click: () => { const ctx = ensureActive(); void dialog.showOpenDialog(ctx.window, { properties: ['openFile'] }).then((result) => { if (!result.canceled && result.filePaths[0]) { forgetSource(); void openFile(ctx, result.filePaths[0]); } }); } },
    { label: '选择文件夹…', click: () => { const ctx = ensureActive(); void dialog.showOpenDialog(ctx.window, { properties: ['openDirectory'] }).then((result) => { if (!result.canceled && result.filePaths[0]) { forgetSource(); void openFile(ctx, result.filePaths[0]); } }); } },
    { type: 'separator' }, { label: '退出', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('double-click', () => showWindow(ensureActive()));
}

function setFinderMode(mode: FinderMode, promptAccessibility = false): void {
  const revision = ++finderRevision;
  if (finderSourceId) forgetSource();
  finderSpace?.stop();
  finderSpace = undefined;
  finderNavigationReady = false;
  globalShortcut.unregister(finderShortcut);
  if (mode === 'system') { sendStatus('Finder 空格使用 macOS 快速查看。'); return; }
  let shouldPrompt = mode === 'space' && promptAccessibility;
  let shortcutRegistered = false;
  let shortcutError = false;
  const updateShortcutStatus = (): void => {
    if (!shortcutRegistered) sendStatus('无法注册 ⌘⇧Space，请检查系统或其他应用的快捷键。');
    else if (shortcutError) sendStatus('无法读取 Finder 选区。请在系统设置 → 隐私与安全性 → 自动化中允许控制 Finder。');
    else sendStatus(finderNavigationReady ? 'Finder 组合键已启用（⌘⇧Space）。'
      : 'Finder 组合键已启用（⌘⇧Space）。方向键切换需要辅助功能权限。');
  };
  if (mode === 'shortcut') {
    let selecting = false;
    shortcutRegistered = globalShortcut.register(finderShortcut, async () => {
      if (selecting) return;
      selecting = true;
      try {
        const selected = await selectedFinderFile();
        if (revision !== finderRevision) return;
        shortcutError = false;
        updateShortcutStatus();
        if (selected) openFinderPreview(selected, `shortcut-${++finderShortcutSerial}`);
      } catch (error) {
        console.error('Finder 集成失败', error);
        if (revision === finderRevision) { shortcutError = true; updateShortcutStatus(); }
      } finally { selecting = false; }
    });
    updateShortcutStatus();
    if (!shortcutRegistered) return;
  } else sendStatus('正在启动 Finder 空格预览…');
  const binary = app.isPackaged ? path.join(path.dirname(process.execPath), 'QuickLookFast.FinderBridge')
    : path.join(appRoot, 'build', 'native', 'macos', 'QuickLookFast.FinderBridge');
  finderSpace = startFinderSpaceBridge(binary, {
    onFile(filePath, sourceId) {
      if (revision === finderRevision) openFinderPreview(filePath, sourceId);
    },
    onSelection(filePath, sourceId) {
      const ctx = active;
      if (revision === finderRevision && macSettings.finderNavigation && finderSourceId === sourceId && ctx?.currentPath &&
          !ctx.pinned && ctx.window.isVisible() && !ctx.window.isMinimized() && ctx.currentPath !== filePath) {
        void openFile(ctx, filePath, Date.now(), ctx.window.isFocused());
      }
    },
    onStatus(status) {
      if (revision !== finderRevision) return;
      finderNavigationReady = status === 'active';
      if (mode === 'shortcut') updateShortcutStatus();
      else if (status === 'active') sendStatus('Finder 空格预览已启用。');
      else if (status === 'accessibility-required') {
        sendStatus('请在系统设置 → 隐私与安全性 → 辅助功能中允许 QuickLook Fast，授权后会自动启用空格预览。');
        if (shouldPrompt) {
          shouldPrompt = false;
          systemPreferences.isTrustedAccessibilityClient(true);
        }
      }
      else sendStatus('Finder 空格预览暂不可用，系统快捷键仍有效。可点重新检测。');
    },
  }, false, mode === 'space');
}

function openFinderPreview(filePath: string, sourceId: string): void {
  forgetSource();
  finderSourceId = sourceId;
  openExternalFile(filePath);
  syncFinderTracking(true);
}

function syncFinderTracking(rememberSource = false): void {
  if (!finderSourceId) return;
  const follow = macSettings.finderNavigation && Boolean(active?.window.isVisible());
  if ((follow || rememberSource) && active?.currentPath) {
    finderSpace?.track(finderSourceId, active.currentPath);
  }
  if (!follow) finderSpace?.forget(finderSourceId);
}

function saveMacSettings(next: MacSettings): void {
  writeMacSettings(app.getPath('userData'), next);
  macSettings = next;
  hasMacSettings = true;
  for (const ctx of contexts.values()) send(ctx, 'mac-settings-changed', macSettings);
}

function startWindowsBridge(): void {
  if (process.platform !== 'win32') return;
  const binary = app.isPackaged ? path.join(process.resourcesPath, 'native', 'QuickLookFast.Bridge.exe')
    : path.join(appRoot, 'build', 'native', 'windows', 'QuickLookFast.Bridge.exe');
  try {
    const child = spawn(binary, [String(process.pid)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    bridge = child;
    child.stdin.on('error', (error: NodeJS.ErrnoException) => bridgeFailed(child, error.code || 'pipe-error'));
    child.on('error', (error: NodeJS.ErrnoException) => { console.error(`Explorer 集成启动失败: ${error.message}`); bridgeFailed(child, error.code || 'start-failed'); });
    child.on('exit', (code) => {
      if (bridge === child) bridge = undefined;
      if (!isQuitting) { diagnostic('bridge-exit', { exitCode: code ?? undefined }); console.error(`Explorer 集成已退出，代码 ${code}`); sendStatus('资源管理器空格预览不可用，可以使用拖放或打开文件。'); }
    });
    child.stderr.on('data', (chunk: Buffer) => console.error(`Explorer 集成: ${chunk.toString('utf8').trim()}`));
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      try {
        const message = JSON.parse(line) as { type: string; path?: string; timestamp?: number; sourceId?: string; message?: string; recovery?: boolean };
        if (message.type === 'ready') { sendStatus(message.recovery === false ? '键盘监听已启动，自动恢复不可用' : ''); for (const ctx of contexts.values()) syncNativeTopmost(ctx); }
        if (message.type === 'status' && typeof message.message === 'string') sendStatus(message.message);
        if (message.type === 'preview' && message.path) { activeSourceId = message.sourceId; openExternalFile(message.path, message.timestamp); }
        const ctx = active;
        if (message.type === 'selection' && message.path && message.sourceId && message.sourceId === activeSourceId && ctx &&
            ctx.window.isVisible() && ctx.currentPath && path.resolve(message.path).toLowerCase() !== ctx.currentPath.toLowerCase()) {
          void openFile(ctx, message.path, message.timestamp, false);
        }
      } catch { console.error('Explorer 集成返回了无法识别的数据'); }
    });
  } catch (error) { console.error('Explorer 集成启动失败', error); }
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  try {
    if (enableLocalCrashReports(app, crashReporter, process.argv)) diagnostic('crash-reports-enabled');
  } catch { diagnostic('crash-reports-unavailable'); }
  diagnostic('app-start');
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (!initialized) queuedOpenFile = filePath;
    else { forgetSource(); openExternalFile(filePath); }
  });
  app.on('second-instance', (_event, commandLine, workingDirectory) => {
    if (!initialized) { queuedSecondInstance = { args: commandLine, workingDirectory }; return; }
    const selected = findPath(commandLine.slice(1), workingDirectory);
    if (selected) { forgetSource(); openExternalFile(selected); }
    else if (!commandLine.includes('--service')) showWindow(ensureActive());
  });
  if (process.platform === 'darwin') app.on('activate', (_event, hasVisibleWindows) => {
    if (initialized && !isQuitting && !hasVisibleWindows) showWindow(ensureActive());
  });
  app.on('child-process-gone', (_event, details) => diagnostic('child-process-gone', {
    reason: details.reason, exitCode: details.exitCode, processType: details.type,
  }));

  app.whenReady().then(async () => {
    if (process.platform === 'darwin') {
      const saved = readMacSettings(app.getPath('userData'));
      hasMacSettings = Boolean(saved);
      macSettings = saved || { ...defaultMacSettings };
      app.setActivationPolicy(macSettings.showDock ? 'regular' : 'accessory');
    }
    const localFiles = await startFileServer((token) => {
      for (const ctx of contexts.values()) {
        if (ctx.currentFile?.token === token) return ctx.currentFile;
        for (const file of ctx.folderFiles.values()) if (file.token === token) return file;
        for (const file of ctx.markdownImages.values()) if (file.token === token) return file;
      }
      return undefined;
    }, (progress) => {
      for (const ctx of contexts.values()) if (ctx.currentFile?.token === progress.token) send(ctx, 'preview-progress', progress);
    });
    fileServer = localFiles.server;
    fileServerOrigin = localFiles.origin;
    protocol.handle('slowlook', async (request) => {
      const url = new URL(request.url);
      if (url.hostname !== 'app') return new Response('Not found', { status: 404 });
      let relative: string;
      try { relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'; }
      catch { return new Response('Bad request', { status: 400 }); }
      const target = path.resolve(rendererRoot, relative);
      if (target !== rendererRoot && !target.startsWith(`${rendererRoot}${path.sep}`)) return new Response('Not found', { status: 404 });
      return fileResponse(request, target);
    });
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
      const allowed = Array.from(contexts.values()).some((ctx) =>
        [ctx.currentFile, ...ctx.folderFiles.values(), ...ctx.markdownImages.values()].some((file) => file && details.url.startsWith(`${fileServerOrigin}/preview/${file.token}/`)));
      callback({ cancel: !allowed });
    });

    ipcMain.handle('select-file', async (event) => {
      const ctx = fromEvent(event); if (!ctx) return;
      const result = await dialog.showOpenDialog(ctx.window, { properties: ['openFile'] });
      if (!result.canceled && result.filePaths[0]) { forgetSource(); await openFile(ctx.pinned ? ensureActive(ctx) : ctx, result.filePaths[0]); }
    });
    ipcMain.handle('select-folder', async (event) => {
      const ctx = fromEvent(event); if (!ctx) return;
      const result = await dialog.showOpenDialog(ctx.window, { properties: ['openDirectory'] });
      if (!result.canceled && result.filePaths[0]) { forgetSource(); await openFile(ctx.pinned ? ensureActive(ctx) : ctx, result.filePaths[0]); }
    });
    ipcMain.handle('open-with-default', async (event) => {
      const ctx = fromEvent(event);
      // Only the main process chooses the path; each window owns its preview.
      const filePath = ctx?.currentFile?.path || (ctx?.folderRootId ? ctx.currentPath : undefined);
      if (!ctx || ctx.disposed || !filePath) return { ok: false, message: '没有可打开的文件或文件夹。' };
      try {
        const error = await shell.openPath(filePath);
        return error ? { ok: false, message: `系统无法打开：${error}` } : { ok: true };
      } catch {
        return { ok: false, message: '系统无法打开，请检查文件和默认应用。' };
      }
    });
    ipcMain.handle('read-directory', (event, id: unknown, offset: unknown) => {
      const ctx = fromEvent(event); if (!ctx) throw new Error('预览窗口已关闭');
      return ctx.directories.read(id, offset);
    });
    ipcMain.handle('open-directory-file', async (event, id: unknown, purpose: unknown) => {
      const ctx = fromEvent(event);
      if (!ctx || !ctx.folderRootId || ctx.currentFile || typeof id !== 'string' || (purpose !== 'thumbnail' && purpose !== 'preview')) throw new Error('无效的文件夹预览请求');
      const version = ctx.version;
      if (purpose === 'preview') releaseFolderSelection(ctx);
      const selection = ctx.folderSelection;
      const info = await ctx.directories.file(id);
      if (ctx.disposed || ctx.version !== version || (purpose === 'preview' && ctx.folderSelection !== selection)) throw new Error('文件夹预览已切换');
      if (purpose === 'thumbnail' && (info.size > 12 * 1024 * 1024 || !/\.(?:png|jpe?g|gif|webp|bmp|avif)$/i.test(info.name))) throw new Error('该文件没有可用的图片缩略图');
      // Thumbnail and selected-file URLs have independent lifetimes.
      const key = `${purpose}:${id}`;
      let file = ctx.folderFiles.get(key);
      if (!file) {
        while (ctx.folderFiles.size >= 128) {
          const candidate = [...ctx.folderFiles].find(([, value]) => value !== ctx.folderPreview);
          if (!candidate) throw new Error('文件夹预览已达到上限');
          ctx.folderFiles.delete(candidate[0]);
        }
        const token = randomBytes(18).toString('hex');
        file = { token, path: info.path, validate: async () => {
          const current = await ctx.directories.file(id);
          if (ctx.folderFiles.get(key)?.token !== token || current.path !== info.path) throw new Error('文件夹预览已失效');
        } };
        ctx.folderFiles.set(key, file);
      } else { ctx.folderFiles.delete(key); ctx.folderFiles.set(key, file); }
      if (purpose === 'preview') ctx.folderPreview = file;
      return { url: `${fileServerOrigin}/preview/${file.token}/${encodeURIComponent(info.name)}`, name: info.name, size: info.size, modifiedAt: info.modifiedAt, createdAt: info.createdAt };
    });
    ipcMain.on('release-directory-preview', (event, folderId: unknown) => {
      const ctx = fromEvent(event); if (!ctx || ctx.currentFile || typeof folderId !== 'string' || ctx.folderRootId !== folderId) return;
      releaseFolderSelection(ctx);
    });
    ipcMain.handle('resolve-markdown-image', async (event, url: unknown, reference: unknown) => {
      const ctx = fromEvent(event);
      const source = ctx?.currentFile || ctx?.folderPreview;
      if (!ctx || !source || typeof url !== 'string' || typeof reference !== 'string' ||
          !/\.(?:md|markdown)$/i.test(source.path) || !url.startsWith(`${fileServerOrigin}/preview/${source.token}/`)) return undefined;
      try { await source.validate?.(); } catch { return undefined; }
      const imagePath = await resolveMarkdownImage(source.path, reference);
      if (!imagePath || (ctx.currentFile || ctx.folderPreview)?.token !== source.token || ctx.disposed) return undefined;
      if (ctx.markdownImages.size >= 128) return undefined;
      const token = randomBytes(18).toString('hex');
      const image: ActiveFile = { token, path: imagePath, validate: async () => {
        await source.validate?.();
        if ((ctx.currentFile || ctx.folderPreview)?.token !== source.token || ctx.markdownImages.get(token) !== image ||
            await resolveMarkdownImage(source.path, reference) !== imagePath) throw new Error('Markdown 图片已失效');
      } };
      ctx.markdownImages.set(token, image);
      return `${fileServerOrigin}/preview/${token}/${encodeURIComponent(path.basename(imagePath))}`;
    });
    ipcMain.handle('content-task', async (event, request: unknown) => {
      const ctx = fromEvent(event);
      if (!ctx || !(ctx.currentFile || ctx.folderPreview) || !request || typeof request !== 'object') return { ok: false, code: 'failed', message: '预览已关闭。' };
      const options = request as { url?: unknown; kind?: unknown; password?: unknown; headerPassword?: unknown; index?: unknown; data?: unknown };
      if (typeof options.url !== 'string' || typeof options.kind !== 'string' ||
          !['rar-list', 'rar-entry', 'office', 'office-data'].includes(options.kind) ||
          (options.password !== undefined && (typeof options.password !== 'string' || options.password.length > 255)) ||
          (options.headerPassword !== undefined && (typeof options.headerPassword !== 'string' || options.headerPassword.length > 255))) {
        return { ok: false, code: 'failed', message: '预览请求无效。' };
      }
      const activeFile = ctx.currentFile || ctx.folderPreview!;
      const prefix = `${fileServerOrigin}/preview/${activeFile.token}/`;
      const extension = path.extname(activeFile.path).toLowerCase();
      if (!options.url.startsWith(prefix) || (options.kind.startsWith('rar-') && extension !== '.rar') ||
          (options.kind === 'office' && !['.docx', '.xlsx', '.pptx'].includes(extension)) ||
          (options.kind === 'office-data' && (!['.zip', '.rar'].includes(extension) || !(options.data instanceof ArrayBuffer) || options.data.byteLength > 64 * 1024 * 1024)) ||
          (options.kind === 'rar-entry' && (!Number.isSafeInteger(options.index) || Number(options.index) < 0))) {
        return { ok: false, code: 'failed', message: '文件或预览请求已失效。' };
      }
      try { await activeFile.validate?.(); } catch { return { ok: false, code: 'failed', message: '文件夹预览已失效。' }; }
      if ((ctx.currentFile || ctx.folderPreview)?.token !== activeFile.token) return { ok: false, code: 'cancelled', message: '预览已切换。' };
      void ctx.contentWorker?.terminate();
      const worker = new Worker(path.join(__dirname, 'files', 'content-worker.js'), { workerData: {
        kind: options.kind, file: activeFile.path, password: options.password, headerPassword: options.headerPassword, index: options.index, data: options.data,
      } });
      ctx.contentWorker = worker;
      return await new Promise((resolve) => {
        let settled = false;
        const finish = (result: unknown): void => {
          if (settled) return;
          settled = true;
          if (ctx.contentWorker === worker) ctx.contentWorker = undefined;
          void worker.terminate();
          resolve((ctx.currentFile || ctx.folderPreview)?.token === activeFile.token ? result : { ok: false, code: 'cancelled', message: '预览已切换。' });
        };
        worker.once('message', finish);
        worker.once('error', () => finish({ ok: false, code: 'failed', message: '解析进程无法启动或读取文件。' }));
        worker.once('exit', () => finish({ ok: false, code: 'cancelled', message: '预览已取消。' }));
      });
    });
    ipcMain.on('cancel-content', (event, url: unknown) => {
      const ctx = fromEvent(event);
      const file = ctx?.currentFile || ctx?.folderPreview;
      if (ctx && file && typeof url === 'string' && url.startsWith(`${fileServerOrigin}/preview/${file.token}/`)) {
        void ctx.contentWorker?.terminate(); ctx.contentWorker = undefined;
      }
    });
    ipcMain.handle('startup-get', (event) => fromEvent(event) ? readStartup(app, process.platform, process.execPath, Boolean(process.defaultApp)) : { supported: false, enabled: false });
    ipcMain.handle('app-version', (event) => fromEvent(event) ? app.getVersion() : '');
    ipcMain.handle('open-diagnostics', async (event) => {
      if (!fromEvent(event)) return { ok: false, message: '预览窗口已关闭。' };
      try {
        const directory = path.join(app.getPath('userData'), 'logs');
        await mkdir(directory, { recursive: true });
        const error = await shell.openPath(directory);
        return error ? { ok: false, message: '无法打开日志目录。' } : { ok: true };
      } catch { return { ok: false, message: '无法打开日志目录。' }; }
    });
    ipcMain.handle('check-for-updates', (event) => {
      if (!fromEvent(event)) return { state: 'error', currentVersion: '', message: '预览窗口已关闭。' };
      // Keep the renderer's offline-only session filter intact while using
      // Chromium's system-proxy-aware networking for this explicit request.
      const updates = session.fromPartition('quicklook-fast-update');
      return checkForUpdates(app.getVersion(), (input, init) => updates.fetch(input instanceof URL ? input.toString() : input, init));
    });
    ipcMain.handle('startup-set', (event, enabled: unknown) => fromEvent(event) && typeof enabled === 'boolean'
      ? writeStartup(app, process.platform, process.execPath, Boolean(process.defaultApp), enabled)
      : readStartup(app, process.platform, process.execPath, Boolean(process.defaultApp)));
    ipcMain.handle('open-file', (event, filePath: string) => {
      const ctx = fromEvent(event); if (!ctx) return;
      forgetSource(); return openFile(ctx.pinned ? ensureActive(ctx) : ctx, filePath);
    });
    ipcMain.on('hide-preview', (event) => { const ctx = fromEvent(event); if (ctx) hideWindow(ctx); });
    ipcMain.on('focus-preview', (event) => { const ctx = fromEvent(event); if (ctx && ctx.window.isVisible()) ctx.window.focus(); });
    ipcMain.on('preview-metric', (event, phase: string) => { const ctx = fromEvent(event); if (ctx) trace(ctx, phase); });
    ipcMain.on('set-pinned', (event, enabled: unknown) => { const ctx = fromEvent(event); if (ctx && typeof enabled === 'boolean') setPinned(ctx, enabled); });
    ipcMain.on('open-project-link', (event, destination: unknown) => {
      if (!fromEvent(event)) return;
      const url = destination === 'organization' ? 'https://www.chaoleme.cn/' : destination === 'flyfish' ? 'https://github.com/flyfish-dev/file-viewer' : destination === 'releases' ? 'https://github.com/Chaoleme-Studio/quick_look_fast/releases/latest' : undefined;
      if (url) void shell.openExternal(url).catch(() => undefined);
    });
    ipcMain.handle('mac-settings-get', (event, legacyFinderShortcut: unknown) => {
      if (!fromEvent(event) || process.platform !== 'darwin') return;
      if (!hasMacSettings && legacyFinderShortcut === true) {
        try {
          saveMacSettings({ ...macSettings, finderMode: 'shortcut' });
          setFinderMode('shortcut');
        } catch (error) { console.error('无法迁移 Finder 设置', error); }
      }
      return macSettings;
    });
    ipcMain.handle('mac-settings-set', (event, key: unknown, value: unknown) => {
      if (!fromEvent(event) || process.platform !== 'darwin') return;
      let next: MacSettings;
      if (key === 'finderMode' && isFinderMode(value)) next = { ...macSettings, finderMode: value };
      else if (key === 'showDock' && typeof value === 'boolean') next = { ...macSettings, showDock: value };
      else if (key === 'showMenuBar' && typeof value === 'boolean') next = { ...macSettings, showMenuBar: value };
      else if (key === 'finderNavigation' && typeof value === 'boolean') next = { ...macSettings, finderNavigation: value };
      else return;
      try { saveMacSettings(next); }
      catch (error) {
        console.error('无法保存 macOS 设置', error);
        return { settings: macSettings, message: '无法保存设置，请检查应用数据目录的权限。' };
      }
      if (key === 'finderMode') setFinderMode(next.finderMode, true);
      if (key === 'showDock') app.setActivationPolicy(next.showDock ? 'regular' : 'accessory');
      if (key === 'showMenuBar') setTrayVisible(next.showMenuBar);
      if (key === 'finderNavigation') syncFinderTracking();
      return { settings: macSettings };
    });
    ipcMain.on('finder-retry', (event) => {
      if (fromEvent(event) && process.platform === 'darwin' && macSettings.finderMode !== 'system') setFinderMode(macSettings.finderMode, true);
    });
    ipcMain.on('finder-open-accessibility', (event) => {
      if (fromEvent(event) && process.platform === 'darwin' && macSettings.finderMode !== 'system') {
        void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility').catch(() => {
          sendStatus('请手动打开系统设置 → 隐私与安全性 → 辅助功能。');
        });
      }
    });
    ipcMain.on('navigate-selection', (event, key: string) => {
      const ctx = fromEvent(event);
      if (!ctx || ctx !== active || ctx.pinned || !ctx.window.isVisible()) return;
      if (finderSourceId) {
        if (macSettings.finderNavigation && finderNavigationReady && ctx.window.isFocused() && (key === 'ArrowUp' || key === 'ArrowDown')) {
          finderSpace?.navigate(finderSourceId, key);
        }
        return;
      }
      if (!activeSourceId || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return;
      if (activeSourceId === 'nautilus') { linuxPreviewer?.navigate(key); return; }
      writeBridge({ type: 'navigate', key, sourceId: activeSourceId });
    });

    const first = ensureActive();
    setTrayVisible(process.platform !== 'darwin' || macSettings.showMenuBar);
    let startedAtLogin = false;
    try { startedAtLogin = process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin; } catch { /* Keep manual startup usable. */ }
    const backgroundLaunch = process.argv.includes('--service') || startedAtLogin;
    if (process.platform === 'darwin') setFinderMode(macSettings.finderMode, !backgroundLaunch);
    await first.loaded;
    startWindowsBridge();
    initialized = true;
    if (process.platform === 'linux') {
      void import('./platform/linux/previewer').then(({ startLinuxPreviewer }) => startLinuxPreviewer({
        open(filePath, closeIfShown) {
          const ctx = ensureActive();
          if (closeIfShown && ctx.currentPath && ctx.window.isVisible()) { hideWindow(ctx); return; }
          forgetSource(); activeSourceId = 'nautilus'; void openFile(ctx, filePath);
        },
        close: () => { if (active) hideWindow(active); },
        visible: () => Boolean(active?.window.isVisible()),
        status: sendStatus,
      })).then((integration) => { linuxPreviewer = integration; }).catch((error) => sendStatus(`GNOME Files 集成不可用：${error instanceof Error ? error.message : String(error)}`));
    }
    const initialFile = queuedOpenFile || (queuedSecondInstance
      ? findPath(queuedSecondInstance.args.slice(1), queuedSecondInstance.workingDirectory)
      : findPath(process.argv.slice(app.isPackaged ? 1 : 2), process.cwd()));
    if (initialFile) await openFile(first, initialFile);
    else if (!backgroundLaunch) showWindow(first);
  }).catch((error) => { console.error('QuickLook Fast 启动失败', error); app.quit(); });

  app.on('before-quit', () => {
    diagnostic('app-quit');
    isQuitting = true; finderRevision += 1; finderSpace?.stop();
    bridge?.kill(); linuxPreviewer?.close(); globalShortcut.unregisterAll(); fileServer?.close(); setTrayVisible(false);
  });
  app.on('window-all-closed', () => { if (isQuitting) app.quit(); });
}
