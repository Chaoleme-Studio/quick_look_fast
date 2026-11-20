const { contextBridge, ipcRenderer } = require('electron');

// This isolated preload supplies deterministic demo data for documentation only.
if (process.isMainFrame) contextBridge.exposeInMainWorld('slowLook', {
  platform: process.platform,
  selectFile: async () => {}, selectFolder: async () => {}, readDirectory: (id, offset) => ipcRenderer.invoke('capture-read-directory', id, offset), openDroppedFile: async () => {}, hide: () => {}, navigate: () => {},
  openDirectoryFile: (id, purpose) => ipcRenderer.invoke('capture-open-directory-file', id, purpose), releaseDirectoryPreview: () => {}, openProjectLink: () => {},
  appVersion: () => ipcRenderer.invoke('capture-app-version'), openDiagnostics: async () => ({ ok: true }),
  checkForUpdates: async () => { const version = await ipcRenderer.invoke('capture-app-version'); return { state: 'up-to-date', currentVersion: version, latestVersion: version }; },
  resolveMarkdownImage: async () => undefined,
  contentTask: async () => ({ ok: false, code: 'failed', message: '演示文件不需要解密。' }), cancelContent: () => {}, focusPreview: () => {},
  setAlwaysOnTop: () => {}, setPinned: () => {}, onPinState: () => {}, setFinderShortcut: () => {}, metric: () => {},
  getStartup: async () => ({ supported: true, enabled: false }), setStartup: async (enabled) => ({ supported: true, enabled }),
  onStart: (listener) => ipcRenderer.on('capture-start', (_event, value) => listener(value)),
  onPreview: (listener) => ipcRenderer.on('capture-preview', (_event, value) => listener(value)),
  onDirectory: (listener) => ipcRenderer.on('capture-directory', (_event, value) => listener(value)),
  onClear: (listener) => ipcRenderer.on('capture-clear', () => listener()),
  onProgress: () => {}, onIntegrationStatus: () => {}, onError: () => {},
});
