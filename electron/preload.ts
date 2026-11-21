import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { MacSettings } from './platform/macos-settings';

// Electron also loads preloads in child frames. Only the application shell
// receives the desktop bridge; local HTML is rendered in isolated iframes.
if (process.isMainFrame) contextBridge.exposeInMainWorld('slowLook', {
  platform: process.platform,
  selectFile: () => ipcRenderer.invoke('select-file'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  openWithDefault: () => ipcRenderer.invoke('open-with-default'),
  readDirectory: (id: string, offset: number) => ipcRenderer.invoke('read-directory', id, offset),
  openDirectoryFile: (id: string, purpose: 'thumbnail' | 'preview') => ipcRenderer.invoke('open-directory-file', id, purpose),
  resolveMarkdownImage: (url: string, reference: string) => ipcRenderer.invoke('resolve-markdown-image', url, reference),
  releaseDirectoryPreview: (folderId: string) => ipcRenderer.send('release-directory-preview', folderId),
  contentTask: (request: unknown) => ipcRenderer.invoke('content-task', request),
  cancelContent: (url: string) => ipcRenderer.send('cancel-content', url),
  focusPreview: () => ipcRenderer.send('focus-preview'),
  openDroppedFile: (file: File) => {
    const filePath = webUtils.getPathForFile(file);
    return ipcRenderer.invoke('open-file', filePath);
  },
  hide: () => ipcRenderer.send('hide-preview'),
  navigate: (key: string) => ipcRenderer.send('navigate-selection', key),
  setPinned: (enabled: boolean) => ipcRenderer.send('set-pinned', enabled),
  setAlwaysOnTop: (enabled: boolean) => ipcRenderer.send('set-always-on-top', enabled),
  openProjectLink: (destination: 'organization' | 'flyfish' | 'releases') => ipcRenderer.send('open-project-link', destination),
  appVersion: () => ipcRenderer.invoke('app-version'),
  openDiagnostics: () => ipcRenderer.invoke('open-diagnostics'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  onPinState: (listener: (pinned: boolean) => void) => ipcRenderer.on('pin-state', (_event, pinned) => listener(pinned)),
  onTopmostState: (listener: (enabled: boolean) => void) => ipcRenderer.on('topmost-state', (_event, enabled) => listener(enabled)),
  getStartup: () => ipcRenderer.invoke('startup-get'),
  setStartup: (enabled: boolean) => ipcRenderer.invoke('startup-set', enabled),
  getMacSettings: (legacyFinderShortcut: boolean) => ipcRenderer.invoke('mac-settings-get', legacyFinderShortcut),
  setMacSetting: <K extends keyof MacSettings>(key: K, value: MacSettings[K]) => ipcRenderer.invoke('mac-settings-set', key, value),
  onMacSettings: (listener: (settings: MacSettings) => void) => ipcRenderer.on('mac-settings-changed', (_event, settings) => listener(settings)),
  retryFinder: () => ipcRenderer.send('finder-retry'),
  openFinderAccessibility: () => ipcRenderer.send('finder-open-accessibility'),
  metric: (phase: string) => ipcRenderer.send('preview-metric', phase),
  onStart: (listener: (file: { name: string; finderNavigation?: boolean }) => void) => {
    ipcRenderer.on('preview-start', (_event, file) => listener(file));
  },
  onPreview: (listener: (file: { url: string; name: string; size: number }) => void) => {
    ipcRenderer.on('preview-file', (_event, file) => listener(file));
  },
  onDirectory: (listener: (folder: { id: string; name: string; path: string; modifiedAt?: string }) => void) => {
    ipcRenderer.on('preview-directory', (_event, folder) => listener(folder));
  },
  onClear: (listener: () => void) => ipcRenderer.on('clear-preview', () => listener()),
  onProgress: (listener: (progress: { phase: 'reading' | 'parsing' | 'range'; loaded?: number; total?: number }) => void) => {
    ipcRenderer.on('preview-progress', (_event, progress) => listener(progress));
  },
  onIntegrationStatus: (listener: (message: string) => void) => {
    ipcRenderer.on('integration-status', (_event, message: string) => listener(message));
  },
  onError: (listener: (message: string) => void) => {
    ipcRenderer.on('preview-error', (_event, message: string) => listener(message));
  },
});
