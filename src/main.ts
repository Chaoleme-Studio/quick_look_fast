import './style.css';
import { selectExtraRenderers } from './preview/extra-renderers';
import { FORCE_INSPECTION_EXTENSIONS, formatHexSample, isProbablyText, readHead } from './preview/file-inspection';
import { MarkdownOutline } from './preview/text/markdown-outline';
import { mountFolderPreview, type FolderFile, type FolderPage, type FolderPreview, type FolderView } from './preview/folder/folder-preview';
import { installImageWheelZoom } from './preview/image/image-wheel-zoom';
import { mountBrowserImage, supportsBrowserImage } from './preview/image/browser-image';
import { formatDimensions, isImageFile, readImageDimensions, type ImageDimensions } from './preview/image/image-metadata';
import { showNestedImageDimensions, watchRenderedDimensions } from './preview/image/rendered-dimensions';
import { mountZipPreview, mountRarPreview, type ArchiveView, type ContentRequest, type ContentResponse } from './preview/archive/zip-preview';
import { requestPassword } from './ui/password-prompt';
import { fileInfoDetails, formatSize, showPhotoExif, type PreviewFile } from './ui/file-info';
import { mountAudioWaveform } from './preview/media/audio-waveform';
import { mountHtmlPreview, type HtmlPreview, type HtmlPreviewSource } from './preview/web/html-preview';
import { mountPageNavigation, type PageNavigation } from './preview/document/page-navigation';
import { mountWordOutline } from './preview/document/word-outline';
import type { MacSettings } from '../electron/platform/macos-settings';
import type { ViewerController, ViewerOptions, ViewerState } from '@file-viewer/web-full';
import type { RendererDefinition } from '@file-viewer/core';

declare global {
  interface Window {
    slowLook: {
      platform: string;
      selectFile(): Promise<void>;
      selectFolder(): Promise<void>;
      openWithDefault(): Promise<{ ok: boolean; message?: string }>;
      readDirectory(id: string, offset: number): Promise<FolderPage>;
      openDirectoryFile(id: string, purpose: 'thumbnail' | 'preview'): Promise<FolderFile>;
      resolveMarkdownImage(url: string, reference: string): Promise<string | undefined>;
      releaseDirectoryPreview(folderId: string): void;
      contentTask(request: ContentRequest): Promise<ContentResponse>;
      cancelContent(url: string): void;
      focusPreview(): void;
      openDroppedFile(file: File): Promise<void>;
      hide(): void;
      navigate(key: string): void;
      setPinned(enabled: boolean): void;
      openProjectLink(destination: 'organization' | 'flyfish' | 'releases'): void;
      appVersion(): Promise<string>;
      openDiagnostics(): Promise<{ ok: boolean; message?: string }>;
      checkForUpdates(): Promise<{ state: 'available' | 'up-to-date'; currentVersion: string; latestVersion: string } | { state: 'error'; currentVersion: string; message: string }>;
      onPinState(listener: (pinned: boolean) => void): void;
      getStartup(): Promise<{ supported: boolean; enabled: boolean; message?: string }>;
      setStartup(enabled: boolean): Promise<{ supported: boolean; enabled: boolean; message?: string }>;
      getMacSettings(legacyFinderShortcut: boolean): Promise<MacSettings | undefined>;
      setMacSetting<K extends keyof MacSettings>(key: K, value: MacSettings[K]): Promise<{ settings: MacSettings; message?: string } | undefined>;
      onMacSettings(listener: (settings: MacSettings) => void): void;
      retryFinder(): void;
      openFinderAccessibility(): void;
      metric(phase: string): void;
      onStart(listener: (file: { name: string; finderNavigation?: boolean }) => void): void;
      onPreview(listener: (file: PreviewFile) => void): void;
      onDirectory(listener: (folder: FolderPreview) => void): void;
      onClear(listener: () => void): void;
      onProgress(listener: (progress: { phase: 'reading' | 'parsing' | 'range'; loaded?: number; total?: number }) => void): void;
      onIntegrationStatus(listener: (message: string) => void): void;
      onError(listener: (message: string) => void): void;
    };
  }
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('找不到应用容器');
const isMac = window.slowLook.platform === 'darwin';
const isLinux = window.slowLook.platform === 'linux';

const settingsGroups = [
  { id: 'general', label: '常规', eyebrow: 'GENERAL', description: '让预览符合你的使用习惯', rows: [
    { id: 'navigation', title: '方向键切换文件', detail: isMac ? '从 Finder 发起预览后，按 ↑ 或 ↓ 切换选中项。需要辅助功能权限' : '在预览中切换文件管理器的选中项' },
    { id: 'space-closes-preview', title: '空格优先关闭预览', detail: '即使焦点停在按钮或设置开关上，按空格也会收起当前预览' },
    { id: 'autoplay', title: '自动播放音频和视频', detail: '打开后直接播放，关闭预览时停止' },
    { id: 'startup', title: '开机自动启动', detail: '登录后在后台启动 QuickLook Fast' },
  ] },
  { id: 'reading', label: '阅读与文本', eyebrow: 'READING', description: '为代码、文本与文档选择舒适的阅读方式', rows: [
    { id: 'document-pages', title: '显示文档页码和翻页', detail: '在 Word 和 PPT 预览中显示页码、切换和跳转' },
    { id: 'line-numbers', title: '显示行号', detail: '为代码和纯文本显示行号与行数' },
    { id: 'wrap-lines', title: '自动换行', detail: '长行按窗口宽度换行；大文件片段保持横向滚动' },
    { id: 'markdown-toc', title: 'Markdown 目录', detail: '在文档旁显示章节，点击即可跳转' },
    { id: 'html-scripts', title: 'HTML 网页运行脚本', detail: '默认启用，网页在隔离区域运行；关闭后仅显示静态页面' },
  ] },
  { id: 'folder', label: '文件夹', eyebrow: 'FOLDERS', description: '按需浏览文件夹和其中的文件', rows: [
    { id: 'folder-preview', title: '文件夹内文件预览', detail: '选择文件后在右侧显示内容，关闭后使用完整目录宽度' },
    { id: 'folder-thumbnails', title: '显示图片缩略图', detail: '按可见范围加载常见图片；其他格式显示类型图标' },
    { id: 'hide-mac-metadata', title: '隐藏 macOS 系统文件', detail: '在文件夹和压缩包预览中隐藏 .DS_Store 文件和 __MACOSX 文件夹' },
  ] },
  { id: 'integration', label: '系统集成', eyebrow: 'INTEGRATIONS', description: '连接系统的文件管理器', rows: isMac ? [
    { id: 'show-dock', title: '在 Dock 中显示', detail: '显示 QuickLook Fast 的应用图标' },
    { id: 'show-menu-bar', title: '在菜单栏中显示', detail: '显示屏幕顶部的预览入口' },
  ] : [] },
  { id: 'about', label: '关于', eyebrow: 'ABOUT', description: '轻松预览，让文件触手可及', rows: [] },
] as const;

const macFinderSettings = `
  <label class="setting-row" for="settings-finder-mode">
    <span><strong>Finder 预览快捷键</strong><small id="finder-mode-detail">适用于 Finder 文件列表和桌面</small></span>
    <select class="settings-select" id="settings-finder-mode" aria-describedby="finder-mode-detail" disabled>
      <option value="system">macOS 快速查看</option>
      <option value="shortcut">QuickLook Fast · ⌘⇧Space</option>
      <option value="space">QuickLook Fast · Space</option>
    </select>
  </label>
`;
const integrationNote = `
  <p class="settings-note" role="status"><span id="integration-current-status">等待文件管理器操作</span></p>
  ${isMac ? `<div class="settings-actions">
    <button type="button" class="about-link" id="finder-permissions" hidden>打开辅助功能设置</button>
    <button type="button" class="about-link" id="finder-retry" hidden>重新检测</button>
  </div>
  <p class="settings-note" id="mac-settings-message" role="status" hidden></p>
  <p class="settings-note" id="mac-hidden-reopen" hidden>隐藏两个图标后，可通过 Spotlight 搜索 QuickLook Fast 重新打开窗口。</p>` : ''}
`;

app.innerHTML = `
  <div class="window${isLinux ? ' window--native-frame' : ''}">
    <header class="titlebar">
      <div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>QuickLook Fast</span></div>
      <div class="file-meta" aria-live="polite"><span id="file-name"></span><span id="file-size"></span></div>
      <div class="window-actions">
        <button class="icon-action" id="file-info-open" type="button" aria-label="文件信息" title="文件信息" hidden><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="M10 9v4m0-7h.01"/></svg></button>
        <button class="icon-action pin-action" id="pin-window" type="button" aria-label="固定此预览" aria-pressed="false" title="固定此预览"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 3.5h6l-.6 4 2.6 2.8v1.2H5v-1.2l2.6-2.8L7 3.5Zm3 8v5"/></svg></button>
        <button class="open-action" id="open-default" type="button" title="使用系统默认应用打开当前文件或文件夹" disabled>使用默认应用打开</button>
        <button class="icon-action" id="choose" type="button" aria-label="选择文件预览" title="选择文件预览 (Ctrl/⌘+O)"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 5.5h5l1.5 2h8.5v7.5H2.5z"/><path d="M10 9.5v4m-2-2h4"/></svg></button>
        <button class="open-action" id="settings-open" type="button" title="设置">设置</button>
        <span class="divider"></span>
        <button class="close-action" id="close" type="button" aria-label="关闭预览" title="关闭预览 (Esc)">×</button>
      </div>
    </header>
    <main id="drop-zone">
      <section id="welcome" class="welcome">
        <div class="welcome-content">
          <div class="welcome-icon" aria-hidden="true"><span></span></div>
          <h1>看一眼，就够了。</h1>
          <p>选择文件或拖放到这里，立即预览。</p>
          <button id="choose-welcome" class="primary-button" type="button">选择文件 <span>↗</span></button>
          <button id="choose-folder" class="secondary-button" type="button">选择文件夹</button>
          <div class="hint">${isMac ? '' : '<kbd>Space</kbd><span>预览文件</span><i></i>'}<kbd>Esc</kbd><span>关闭</span></div>
        </div>
        <div class="welcome-footer"><span id="integration-status" role="status"></span>本地预览 <span>·</span> Powered by Flyfish File Viewer</div>
      </section>
      <section id="preview" class="preview" tabindex="-1" hidden>
        <div id="viewer"></div>
        <nav id="markdown-toc" class="markdown-toc" aria-label="文档目录" hidden><div class="toc-heading">文档目录</div><div id="markdown-toc-list"></div></nav>
        <aside id="file-info" class="file-info" aria-label="文件信息" hidden><div class="file-info-heading"><strong>文件信息</strong><button id="file-info-close" class="close-action" type="button" aria-label="关闭文件信息">×</button></div><div id="file-info-content"></div></aside>
        <div id="loading" class="overlay" role="status" aria-live="polite" hidden>
          <div class="loading-content"><span class="spinner"></span><strong id="loading-label">正在准备预览</strong>
            <span id="loading-detail">大文件可能需要一些时间</span><progress id="loading-progress" max="100" hidden></progress></div>
        </div>
        <div id="error" class="overlay error" hidden><span class="error-icon">!</span><strong>无法预览</strong><span id="error-message"></span></div>
      </section>
      <div id="drag-overlay" class="drag-overlay" hidden><span>松开鼠标预览文件</span></div>
      <div id="open-feedback" class="open-feedback" role="status" aria-live="polite" hidden><span id="open-feedback-message"></span><button id="open-feedback-close" type="button" aria-label="关闭提示">×</button></div>
    </main>
    <div id="settings" class="settings-backdrop" role="dialog" aria-modal="true" aria-labelledby="settings-title" hidden>
      <section class="settings-panel">
        <aside class="settings-sidebar"><div class="settings-brand"><span class="settings-brand-mark">Q</span><span>QuickLook Fast<small>PREFERENCES</small></span></div><h2 id="settings-title">设置</h2><nav class="settings-tabs" role="tablist" aria-label="设置分类">
          ${settingsGroups.map((group, index) => `<button type="button" role="tab" id="tab-${group.id}" aria-controls="group-${group.id}" aria-selected="${index === 0}" data-settings-tab="${group.id}" tabindex="${index === 0 ? '0' : '-1'}"><span class="settings-tab-dot"></span>${group.label}</button>`).join('')}
        </nav><div class="settings-sidebar-footer"><span class="status-dot"></span>更改自动保存</div></aside>
        <div class="settings-body"><button id="settings-close" class="close-action settings-close" type="button" aria-label="关闭设置">×</button>
          ${settingsGroups.map((group, index) => `<section id="group-${group.id}" class="settings-group" role="tabpanel" aria-labelledby="tab-${group.id}" data-settings-group="${group.id}" ${index ? 'hidden' : ''}><span class="settings-eyebrow">${group.eyebrow}</span><h3>${group.label}</h3><p class="settings-description">${group.description}</p><div class="settings-card" ${group.id === 'integration' && !isMac ? 'hidden' : ''}>${group.id === 'integration' && isMac ? macFinderSettings : ''}${group.rows.map((row) => `<label class="setting-row"><span><strong>${row.title}</strong><small>${row.detail}</small></span><span class="setting-toggle"><input id="settings-${row.id}" type="checkbox"><span class="toggle-track" aria-hidden="true"></span></span></label>`).join('')}${group.id === 'about' ? `<div class="setting-row about-row"><span><strong>版本与更新</strong><small id="app-version">正在读取当前版本…</small><small id="update-status" role="status" aria-live="polite">点击检查更新时才会访问 GitHub。</small></span><span class="about-actions"><button id="check-update" type="button" class="about-link">检查更新</button><button type="button" class="about-link" data-external-link="releases">手动下载 ↗</button></span></div><div class="setting-row about-row"><span><strong>组织网站</strong><small>了解更多</small></span><button type="button" class="about-link" data-external-link="organization">www.chaoleme.cn ↗</button></div><div class="setting-row about-row"><span><strong>致谢</strong><small>文件预览由 Flyfish File Viewer 提供支持</small></span><button type="button" class="about-link" data-external-link="flyfish">项目主页 ↗</button></div>` : ''}</div>${group.id === 'integration' ? integrationNote : ''}</section>`).join('')}
        </div>
      </section>
    </div>
  </div>
`;

function element<T extends HTMLElement>(selector: string): T {
  const result = document.querySelector<T>(selector);
  if (!result) throw new Error(`缺少界面元素 ${selector}`);
  return result;
}

const nameLabel = element('#file-name');
const sizeLabel = element('#file-size');
const welcome = element('#welcome');
const preview = element('#preview');
const viewerHost = element('#viewer');
const loading = element('#loading');
const loadingLabel = element('#loading-label');
const loadingDetail = element('#loading-detail');
const loadingProgress = element<HTMLProgressElement>('#loading-progress');
const errorBox = element('#error');
const errorMessage = element('#error-message');
const dragOverlay = element('#drag-overlay');
const settingsPanel = element('#settings');
const infoPanel = element('#file-info');
const infoButton = element<HTMLButtonElement>('#file-info-open');
const infoContent = element('#file-info-content');
const openDefaultButton = element<HTMLButtonElement>('#open-default');
const openFeedback = element('#open-feedback');
const openFeedbackMessage = element('#open-feedback-message');
const toc = element('#markdown-toc');
const tocList = element('#markdown-toc-list');
const navigationSetting = element<HTMLInputElement>('#settings-navigation');
const spaceClosesPreviewSetting = element<HTMLInputElement>('#settings-space-closes-preview');
const startupSetting = element<HTMLInputElement>('#settings-startup');
const autoplaySetting = element<HTMLInputElement>('#settings-autoplay');
const lineNumbersSetting = element<HTMLInputElement>('#settings-line-numbers');
const wrapLinesSetting = element<HTMLInputElement>('#settings-wrap-lines');
const markdownTocSetting = element<HTMLInputElement>('#settings-markdown-toc');
const htmlScriptsSetting = element<HTMLInputElement>('#settings-html-scripts');
const documentPagesSetting = element<HTMLInputElement>('#settings-document-pages');
const folderPreviewSetting = element<HTMLInputElement>('#settings-folder-preview');
const folderThumbnailsSetting = element<HTMLInputElement>('#settings-folder-thumbnails');
const hideMacMetadataSetting = element<HTMLInputElement>('#settings-hide-mac-metadata');
const pinButton = element<HTMLButtonElement>('#pin-window');
let controller: ViewerController | undefined;
const nestedControllers = new Set<ViewerController>();
const pageNavigations = new Set<PageNavigation>();
const htmlPreviews = new Set<HtmlPreview>();
const archiveViews = new Set<ArchiveView>();
let removeMainImageWheel: (() => void) | undefined;
let disposeMainPageNavigation: (() => void) | undefined;
let media: HTMLMediaElement | undefined;
let disposeMediaVisual: (() => void) | undefined;
let textRead: AbortController | undefined;
let refreshLargeText: (() => void) | undefined;
let refreshFolderText: (() => void) | undefined;
let disposeLargeText: (() => void) | undefined;
let probeRead: AbortController | undefined;
let infoRead: AbortController | undefined;
let imageRead: AbortController | undefined;
let stopWatchingImage: (() => void) | undefined;
let currentImageSize: ImageDimensions | undefined;
let currentPreview: PreviewFile | undefined;
let markdownOutline: MarkdownOutline | undefined;
let folderView: FolderView | undefined;
let disposeZip: (() => void) | undefined;
let generation = 0;
let isPreviewing = false;
let finderNavigationAvailable = false;
let lastReadyGeneration = -1;

function savedSetting(key: string, fallback = true): boolean {
  try {
    const value = window.localStorage.getItem(`slowlook.${key}`);
    return value === null ? fallback : value === 'true';
  } catch { return fallback; }
}
if (isMac) {
  const finderMode = element<HTMLSelectElement>('#settings-finder-mode');
  const showDock = element<HTMLInputElement>('#settings-show-dock');
  const showMenuBar = element<HTMLInputElement>('#settings-show-menu-bar');
  const status = element('#mac-settings-message');
  const retry = element<HTMLButtonElement>('#finder-retry');
  const permissions = element<HTMLButtonElement>('#finder-permissions');
  const controls = [finderMode, showDock, showMenuBar, navigationSetting];
  let current: MacSettings | undefined;
  const showMessage = (message: string): void => { status.textContent = message; status.hidden = !message; };
  const apply = (settings: MacSettings): void => {
    current = settings;
    finderMode.value = settings.finderMode;
    showDock.checked = settings.showDock;
    showMenuBar.checked = settings.showMenuBar;
    navigationSetting.checked = settings.finderNavigation;
    retry.hidden = settings.finderMode === 'system';
    permissions.hidden = settings.finderMode === 'system';
    element('#finder-mode-detail').textContent = settings.finderMode === 'space'
      ? '接管 Finder 和桌面的空格键，需要辅助功能权限'
      : settings.finderMode === 'shortcut' ? '使用 Finder 选区，需要自动化权限' : 'Finder 和桌面的空格键由 macOS 处理';
    element('#mac-hidden-reopen').hidden = settings.showDock || settings.showMenuBar;
  };
  const change = async <K extends keyof MacSettings>(key: K, value: MacSettings[K]): Promise<void> => {
    controls.forEach((control) => { control.disabled = true; });
    showMessage('');
    try {
      const result = await window.slowLook.setMacSetting(key, value);
      if (!result) throw new Error('设置不可用');
      if (result.message) { apply(result.settings); showMessage(result.message); }
    } catch {
      if (current) apply(current);
      showMessage('无法更改 macOS 设置。');
    } finally { controls.forEach((control) => { control.disabled = false; }); }
  };
  controls.forEach((control) => { control.disabled = true; });
  window.slowLook.onMacSettings(apply);
  void window.slowLook.getMacSettings(savedSetting('finderShortcut', false)).then((settings) => {
    if (!settings) throw new Error('设置不可用');
    apply(settings);
    controls.forEach((control) => { control.disabled = false; });
  }).catch(() => showMessage('无法读取 macOS 设置。'));
  finderMode.addEventListener('change', () => {
    const value = finderMode.value;
    if (value === 'system' || value === 'shortcut' || value === 'space') void change('finderMode', value);
  });
  showDock.addEventListener('change', () => { void change('showDock', showDock.checked); });
  showMenuBar.addEventListener('change', () => { void change('showMenuBar', showMenuBar.checked); });
  navigationSetting.addEventListener('change', () => { void change('finderNavigation', navigationSetting.checked); });
  retry.addEventListener('click', () => window.slowLook.retryFinder());
  permissions.addEventListener('click', () => window.slowLook.openFinderAccessibility());
}
const startupDetail = startupSetting.closest('label')?.querySelector('small');
const startupDescription = startupDetail?.textContent || '';
startupSetting.disabled = true;
let startupBusy = false;
function applyStartupState(state: { supported: boolean; enabled: boolean; message?: string }): void {
  startupSetting.checked = state.enabled;
  startupSetting.disabled = !state.supported;
  if (startupDetail) startupDetail.textContent = state.message || startupDescription;
}
async function refreshStartup(): Promise<void> {
  if (startupBusy) return;
  startupBusy = true;
  try { applyStartupState(await window.slowLook.getStartup()); }
  catch { applyStartupState({ supported: false, enabled: false, message: '无法读取开机自启设置。' }); }
  finally { startupBusy = false; }
}
void refreshStartup();
startupSetting.addEventListener('change', () => {
  startupBusy = true;
  startupSetting.disabled = true;
  const enabled = startupSetting.checked;
  void window.slowLook.setStartup(startupSetting.checked).then(applyStartupState)
    .catch(() => applyStartupState({ supported: true, enabled: !enabled, message: '无法更改开机自启设置。' }))
    .finally(() => { startupBusy = false; });
});
let pinned = false;
function syncPin(): void {
  pinButton.setAttribute('aria-pressed', String(pinned));
  pinButton.setAttribute('aria-label', pinned ? '取消固定并取消置顶' : '固定并置顶此预览');
  pinButton.title = pinned ? '取消固定并取消置顶' : '固定并置顶此预览，继续查看其他文件';
}
syncPin();
window.slowLook.onPinState((value) => { pinned = value; syncPin(); });
const rendererSettings = ([[navigationSetting, 'navigation'], [spaceClosesPreviewSetting, 'spaceClosesPreview'], [autoplaySetting, 'autoplay'], [lineNumbersSetting, 'lineNumbers'], [wrapLinesSetting, 'wrapLines'], [markdownTocSetting, 'markdownToc'], [htmlScriptsSetting, 'htmlScripts'], [documentPagesSetting, 'documentPages'], [folderPreviewSetting, 'folderPreview'], [folderThumbnailsSetting, 'folderThumbnails'], [hideMacMetadataSetting, 'hideMacMetadata']] as const)
  .filter(([, key]) => !isMac || key !== 'navigation');
function applyRendererSetting(key: typeof rendererSettings[number][1], checked: boolean): void {
  if (key === 'autoplay') {
    for (const player of viewerHost.querySelectorAll<HTMLMediaElement>('.media-view audio, .media-view video')) {
      player.autoplay = checked;
      if (checked) void player.play().catch(() => undefined);
    }
  }
  if (key === 'folderPreview' || key === 'folderThumbnails' || key === 'hideMacMetadata') {
    folderView?.setOptions({ inlinePreview: folderPreviewSetting.checked, thumbnails: folderThumbnailsSetting.checked, hideMacMetadata: hideMacMetadataSetting.checked });
  }
  if (key === 'hideMacMetadata') for (const archive of archiveViews) archive.setHideMacMetadata(checked);
  if (key === 'markdownToc') setupMarkdownToc();
  if (key === 'htmlScripts') for (const view of htmlPreviews) view.setScriptsEnabled(checked);
  if (key === 'documentPages') for (const navigation of pageNavigations) navigation.setEnabled(checked);
  if (key === 'lineNumbers' || key === 'wrapLines') {
    refreshLargeText?.();
    refreshFolderText?.();
    if (controller) void controller.update({ options: { locale: 'zh-CN', text: textOptions() } }).catch(() => undefined);
    for (const nested of nestedControllers) void nested.update({ options: { locale: 'zh-CN', text: textOptions() } }).catch(() => undefined);
  }
}
for (const [input, key] of rendererSettings) {
  input.checked = !input.disabled && savedSetting(key, key !== 'wrapLines');
  input.addEventListener('change', () => {
    try { window.localStorage.setItem(`slowlook.${key}`, String(input.checked)); } catch { /* use this session's value */ }
    applyRendererSetting(key, input.checked);
  });
}
window.addEventListener('storage', (event) => {
  const setting = rendererSettings.find(([, key]) => event.key === `slowlook.${key}`);
  if (!setting) return;
  const [input, key] = setting;
  if (input.disabled) return;
  input.checked = event.newValue === null ? key !== 'wrapLines' : event.newValue === 'true';
  applyRendererSetting(key, input.checked);
});

function attachPageNavigation(container: HTMLElement, mount: HTMLElement, filename: string): () => void {
  const titlebar = container === viewerHost;
  const section = titlebar ? undefined : container.closest<HTMLElement>('.folder-detail, .zip-content');
  const heading = section?.querySelector<HTMLElement>(':scope > .folder-detail-heading, :scope > .zip-content-heading');
  const host = titlebar ? element<HTMLElement>('.window-actions') : heading || container;
  const navigation = mountPageNavigation(container, mount, filename, { host, before: titlebar ? infoButton : undefined, enabled: documentPagesSetting.checked, titlebar });
  if (!navigation) return () => undefined;
  const stopOutline = mountWordOutline(container, mount, filename, {
    host, before: host.querySelector<HTMLElement>('.document-pages') || (titlebar ? infoButton : undefined), titlebar, initiallyExpanded: titlebar,
  });
  pageNavigations.add(navigation);
  return () => { stopOutline?.(); pageNavigations.delete(navigation); navigation.dispose(); };
}
document.querySelectorAll<HTMLButtonElement>('[data-external-link]').forEach((button) => button.addEventListener('click', () => {
  const destination = button.dataset.externalLink;
  if (destination === 'organization' || destination === 'flyfish' || destination === 'releases') window.slowLook.openProjectLink(destination);
}));
const updateButton = element<HTMLButtonElement>('#check-update');
const updateStatus = element('#update-status');
void window.slowLook.appVersion().then((version) => { element('#app-version').textContent = version ? `当前版本 v${version}` : '无法读取当前版本'; }).catch(() => { element('#app-version').textContent = '无法读取当前版本'; });
updateButton.addEventListener('click', async () => {
  updateButton.disabled = true;
  updateStatus.textContent = '正在检查 GitHub 的正式版本…';
  try {
    const result = await window.slowLook.checkForUpdates();
    updateStatus.textContent = result.state === 'available' ? `发现新版本 v${result.latestVersion}，可手动下载。`
      : result.state === 'up-to-date' ? `已是最新正式版本（v${result.latestVersion}）。` : 'message' in result ? result.message : '检查失败，请稍后重试。';
  } catch { updateStatus.textContent = '检查失败，请稍后重试。'; }
  finally { updateButton.disabled = false; }
});
const diagnosticRow = document.createElement('div'); diagnosticRow.className = 'setting-row about-row';
diagnosticRow.innerHTML = '<span><strong>运行诊断</strong><small id="diagnostics-status">日志保存在本机，不记录预览文件内容。</small></span><button type="button" class="about-link" id="open-diagnostics">打开日志目录 ↗</button>';
element('#group-about .settings-card').append(diagnosticRow);
element<HTMLButtonElement>('#open-diagnostics').addEventListener('click', async () => {
  try { const result = await window.slowLook.openDiagnostics(); if (!result.ok) element('#diagnostics-status').textContent = result.message || '无法打开日志目录。'; }
  catch { element('#diagnostics-status').textContent = '无法打开日志目录。'; }
});
pinButton.addEventListener('click', () => {
  window.slowLook.setPinned(!pinned);
});

function textOptions(): NonNullable<ViewerOptions['text']> {
  return { lineNumbers: lineNumbersSetting.checked, wrapLongLines: wrapLinesSetting.checked };
}

function trackedHtmlPreview(target: HTMLElement, source: HtmlPreviewSource, onReady: () => void): () => void {
  const view = mountHtmlPreview(target, source, htmlScriptsSetting.checked, onReady);
  htmlPreviews.add(view);
  return () => { htmlPreviews.delete(view); view.dispose(); };
}

function trackedArchive(view: ArchiveView): () => void {
  archiveViews.add(view);
  view.setHideMacMetadata(hideMacMetadataSetting.checked);
  return () => { archiveViews.delete(view); view(); };
}

function loadMarkdownImages(mount: HTMLElement, url: string, isCurrent: () => boolean): void {
  const shadow = mount.shadowRoot;
  const article = shadow?.querySelector('.markdown-body');
  if (!shadow || !article) return;
  const style = document.createElement('style');
  style.textContent = '.markdown-body img{max-width:100%;height:auto}';
  shadow.append(style);
  for (const image of Array.from(article.querySelectorAll<HTMLImageElement>('img[src]')).slice(0, 128)) {
    const reference = image.getAttribute('src') || '';
    image.removeAttribute('srcset');
    if (/^(?:data:|blob:)/i.test(reference)) continue;
    image.removeAttribute('src');
    void window.slowLook.resolveMarkdownImage(url, reference).then((resolved) => {
      if (resolved && isCurrent() && image.isConnected) image.src = resolved;
    }).catch(() => undefined);
  }
}

function stopMedia(): void {
  disposeMediaVisual?.();
  disposeMediaVisual = undefined;
  if (!media) return;
  media.pause();
  media.removeAttribute('src');
  media.load();
  media = undefined;
}

function stopTextRead(): void {
  textRead?.abort();
  textRead = undefined;
}

function stopProbe(): void {
  probeRead?.abort();
  probeRead = undefined;
  infoRead?.abort();
  infoRead = undefined;
}

function clearLargeText(): void {
  disposeLargeText?.();
  disposeLargeText = undefined;
  refreshLargeText = undefined;
}

function disposePreviewViews(): void {
  disposeMainPageNavigation?.();
  disposeMainPageNavigation = undefined;
  imageRead?.abort();
  imageRead = undefined;
  stopWatchingImage?.();
  stopWatchingImage = undefined;
  currentImageSize = undefined;
  removeMainImageWheel?.();
  removeMainImageWheel = undefined;
  folderView?.dispose();
  folderView = undefined;
  disposeZip?.();
  disposeZip = undefined;
}

function resetLoading(label = '正在准备预览'): void {
  loadingLabel.textContent = label;
  loadingDetail.textContent = '大文件可能需要一些时间';
  loadingProgress.hidden = true;
}

function mediaKind(name: string): 'audio' | 'video' | undefined {
  const extension = name.split('.').pop()?.toLowerCase();
  if (extension && ['mp3', 'm4a', 'aac', 'wav', 'flac', 'oga', 'ogg', 'opus', 'weba'].includes(extension)) return 'audio';
  if (extension && ['mp4', 'm4v', 'webm', 'ogv', 'mov'].includes(extension)) return 'video';
  return undefined;
}

function createMediaView(file: { name: string; size: number; url: string }, kind: 'audio' | 'video'): { wrapper: HTMLElement; player: HTMLMediaElement; audioDetails?: HTMLElement; dispose(): void } {
  const wrapper = document.createElement('div');
  wrapper.className = `media-view media-${kind}`;
  const player = document.createElement(kind);
  player.controls = true;
  player.preload = 'metadata';
  player.autoplay = autoplaySetting.checked;
  player.src = file.url;
  let audioDetails: HTMLElement | undefined;
  let dispose = (): void => {};
  if (kind === 'audio') {
    const card = document.createElement('div');
    card.className = 'audio-card';
    const waveform = mountAudioWaveform(player, file);
    dispose = waveform.dispose;
    const copy = document.createElement('div');
    copy.className = 'audio-copy';
    const eyebrow = document.createElement('span');
    eyebrow.className = 'audio-eyebrow';
    eyebrow.textContent = '音频预览';
    const title = document.createElement('h2');
    title.textContent = file.name;
    audioDetails = document.createElement('p');
    audioDetails.textContent = `${file.name.split('.').pop()?.toUpperCase() || 'AUDIO'} · ${formatSize(file.size)}`;
    copy.append(eyebrow, title, audioDetails);
    card.append(copy, waveform.element, player);
    wrapper.append(card);
  } else wrapper.append(player);
  return { wrapper, player, audioDetails, dispose };
}

function showMedia(file: PreviewFile, current: number, kind: 'audio' | 'video'): void {
  const { wrapper, player, audioDetails, dispose } = createMediaView(file, kind);
  media = player;
  disposeMediaVisual = dispose;
  player.addEventListener('loadedmetadata', () => {
    if (current !== generation) return;
    if (audioDetails && Number.isFinite(player.duration)) {
      const seconds = Math.floor(player.duration);
      audioDetails.textContent += ` · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    }
    loading.hidden = true;
    errorBox.hidden = true;
    if (lastReadyGeneration !== current) {
      lastReadyGeneration = current;
      window.slowLook.metric('content-ready');
    }
    if (autoplaySetting.checked) void player.play().catch(() => undefined);
  }, { once: true });
  player.addEventListener('error', () => {
    if (current !== generation) return;
    stopMedia();
    resetLoading('正在尝试其他预览方式');
    loading.hidden = false;
    void loadFlyfish(file, current);
  }, { once: true });
  viewerHost.replaceChildren(wrapper);
}

const LARGE_TEXT_THRESHOLD = 16 * 1024 * 1024;
const LARGE_TEXT_CHUNK = 1024 * 1024;
const MAX_FULL_TEXT = 64 * 1024 * 1024;
const textExtensions = new Set(['txt', 'log', 'md', 'markdown', 'srt', 'vtt', 'ass', 'ssa', 'lrc', 'json', 'jsonc', 'json5', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts', 'css', 'html', 'htm', 'xml', 'yaml', 'yml', 'ini', 'sh', 'bash', 'zsh', 'ps1', 'sql', 'go', 'rs', 'py', 'java', 'c', 'cpp', 'cc', 'h', 'hpp', 'cs', 'rb', 'swift', 'kt', 'php', 'toml', 'csv', 'tsv']);
function shouldPreviewTextInChunks(file: PreviewFile): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase();
  return file.size > LARGE_TEXT_THRESHOLD && Boolean(extension && textExtensions.has(extension));
}

function showLargeText(file: PreviewFile, current: number, viewerFilename = file.name): void {
  const container = document.createElement('div');
  container.className = 'large-text';
  const toolbar = document.createElement('div');
  toolbar.className = 'large-text-toolbar';
  const label = document.createElement('span');
  label.id = 'large-text-label';
  const start = document.createElement('button');
  const end = document.createElement('button');
  const full = document.createElement('button');
  start.type = end.type = full.type = 'button';
  start.textContent = '文件开头';
  end.textContent = '文件末尾';
  full.textContent = '完整加载';
  full.hidden = file.size > MAX_FULL_TEXT;
  const content = document.createElement('pre');
  content.id = 'large-text-content';
  const scroller = document.createElement('div');
  scroller.className = 'large-text-scroll';
  const gutter = document.createElement('div');
  gutter.className = 'large-text-gutter';
  gutter.setAttribute('aria-hidden', 'true');
  const gutterViewport = document.createElement('div');
  gutterViewport.className = 'large-text-gutter-viewport';
  const gutterNumbers = document.createElement('div');
  gutterNumbers.className = 'large-text-gutter-numbers';
  gutterViewport.append(gutterNumbers);
  gutter.append(gutterViewport);
  scroller.append(gutter, content);
  toolbar.append(label, start, end, full);
  container.append(toolbar, scroller);
  viewerHost.replaceChildren(container);
  let encoding = 'utf-8';
  let displayedLines = 0;
  let displayedBytes = 0;
  let showingTail = false;

  // Only create the numbers visible in the viewport, even for a fragment with many short lines.
  const updateGutter = (): void => {
    gutter.hidden = !lineNumbersSetting.checked;
    scroller.classList.toggle('with-line-numbers', lineNumbersSetting.checked);
    const lines = lineNumbersSetting.checked ? ` · 片段 ${displayedLines.toLocaleString()} 行${showingTail ? '，行号从片段开始' : ''}` : '';
    label.textContent = `仅显示${showingTail ? '末尾' : '开头'} ${formatSize(displayedBytes)} · 总计 ${formatSize(file.size)}${lines}`;
    if (gutter.hidden) return;
    const viewportHeight = scroller.clientHeight || 400;
    const first = Math.max(0, Math.floor((scroller.scrollTop - 20) / 21) - 1);
    const last = Math.min(displayedLines, first + Math.ceil(viewportHeight / 21) + 3);
    gutterViewport.style.height = `${viewportHeight}px`;
    gutterNumbers.style.transform = `translateY(${20 + first * 21 - scroller.scrollTop}px)`;
    gutterNumbers.textContent = Array.from({ length: Math.max(0, last - first) }, (_, index) => String(first + index + 1)).join('\n');
  };
  scroller.addEventListener('scroll', updateGutter, { passive: true });
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(updateGutter) : undefined;
  observer?.observe(scroller);
  refreshLargeText = updateGutter;
  disposeLargeText = () => {
    scroller.removeEventListener('scroll', updateGutter);
    observer?.disconnect();
  };

  const readChunk = async (tail: boolean): Promise<void> => {
    stopTextRead();
    const operation = new AbortController();
    textRead = operation;
    const first = tail ? Math.max(0, file.size - LARGE_TEXT_CHUNK) : 0;
    const last = Math.min(file.size - 1, first + LARGE_TEXT_CHUNK - 1);
    resetLoading('正在读取文件片段');
    loading.hidden = false;
    try {
      const response = await fetch(file.url, { headers: { Range: `bytes=${first}-${last}` }, signal: operation.signal });
      if (response.status !== 206) throw new Error('无法按需读取文件片段');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (current !== generation || operation.signal.aborted) return;
      if (!tail && bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
      else if (!tail && bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
      let offset = 0;
      if (tail && encoding === 'utf-8') while (offset < 3 && (bytes[offset] & 0xc0) === 0x80) offset += 1;
      if (tail && encoding.startsWith('utf-16') && first % 2 !== 0) offset = 1;
      let decoded: string;
      try {
        decoded = new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(offset), { stream: true });
      } catch {
        if (!tail) encoding = 'gb18030';
        decoded = new TextDecoder(encoding).decode(bytes.subarray(offset));
      }
      content.textContent = decoded;
      displayedLines = 1;
      for (let index = 0; index < decoded.length; index += 1) {
        const character = decoded.charCodeAt(index);
        if (character === 13) {
          displayedLines += 1;
          if (decoded.charCodeAt(index + 1) === 10) index += 1;
        } else if (character === 10) displayedLines += 1;
      }
      displayedBytes = bytes.byteLength;
      showingTail = tail;
      scroller.scrollTop = 0;
      updateGutter();
      loading.hidden = true;
      if (lastReadyGeneration !== current) {
        lastReadyGeneration = current;
        window.slowLook.metric('content-ready');
      }
    } catch (error) {
      if (current === generation && !operation.signal.aborted) showError(error instanceof Error ? error.message : String(error));
    } finally {
      if (textRead === operation) textRead = undefined;
    }
  };
  start.addEventListener('click', () => { void readChunk(false); });
  end.addEventListener('click', () => { void readChunk(true); });
  full.addEventListener('click', () => {
    stopTextRead();
    clearLargeText();
    resetLoading('正在加载完整文件');
    loading.hidden = false;
    void loadFlyfish(file, current, viewerFilename);
  });
  void readChunk(false);
}

let viewerPromise: Promise<typeof import('@file-viewer/web-full')> | undefined;
function loadViewer(): Promise<typeof import('@file-viewer/web-full')> {
  if (!viewerPromise) viewerPromise = import('@file-viewer/web-full').catch((error) => { viewerPromise = undefined; throw error; });
  return viewerPromise;
}
async function loadModules(filename: string): Promise<{ viewer: typeof import('@file-viewer/web-full'); renderers: ViewerOptions['renderers'] }> {
  const [viewer, core] = await Promise.all([loadViewer(), import('@file-viewer/core')]);
  const extras = selectExtraRenderers(filename, core.DEFAULT_RENDERER_DEFINITIONS);
  const renderers = await Promise.all([
    ...(extras.has('binary') ? [import('@file-viewer/renderer-binary').then((module) => module.binaryRenderer)] : []),
    ...(extras.has('design') ? [import('@file-viewer/renderer-design').then((module) => module.designRenderer)] : []),
    ...(extras.has('signature') ? [import('@file-viewer/renderer-signature').then((module) => module.signatureRenderer)] : []),
  ]);
  return { viewer, renderers: renderers as unknown as ViewerOptions['renderers'] };
}

function showMetadataFallback(file: PreviewFile, reason: string, sample?: Uint8Array): void {
  disposeMainPageNavigation?.();
  disposeMainPageNavigation = undefined;
  stopTextRead();
  clearLargeText();
  stopMedia();
  const oldController = controller;
  controller = undefined;
  if (oldController) void oldController.destroy();
  clearMarkdownToc();
  const root = document.createElement('div');
  root.className = 'metadata-fallback';
  const card = document.createElement('div');
  card.className = 'metadata-card';
  const icon = document.createElement('div');
  icon.className = 'metadata-icon';
  icon.textContent = (file.name.split('.').pop() || 'FILE').slice(0, 4).toUpperCase();
  const heading = document.createElement('h2');
  heading.textContent = file.name;
  const note = document.createElement('p');
  note.textContent = reason;
  card.append(icon, heading, note, fileInfoDetails(file, currentImageSize || (isImageFile(file.name) ? 'unknown' : undefined)));
  if (sample?.length) {
    const label = document.createElement('div');
    label.className = 'hex-label';
    label.textContent = '文件头 · 最多 64 字节';
    const hex = document.createElement('pre');
    hex.className = 'metadata-hex';
    hex.textContent = formatHexSample(sample);
    card.append(label, hex);
  }
  root.append(card);
  viewerHost.replaceChildren(root);
  loading.hidden = true;
  errorBox.hidden = true;
  if (lastReadyGeneration !== generation) {
    lastReadyGeneration = generation;
    window.slowLook.metric('content-ready');
  }
}

function clearMarkdownToc(): void {
  markdownOutline?.destroy();
  markdownOutline = undefined;
}

function reportImageSize(file: PreviewFile, size: ImageDimensions): void {
  if (currentPreview !== file) return;
  if (currentImageSize?.width === size.width && currentImageSize.height === size.height && currentImageSize.unit === size.unit) return;
  currentImageSize = size;
  sizeLabel.textContent = `${formatDimensions(size)} · ${formatSize(file.size)}`;
  if (!infoPanel.hidden) infoContent.firstElementChild?.replaceWith(fileInfoDetails(file, size));
}

function showFileInfo(file: PreviewFile): void {
  infoRead?.abort();
  infoPanel.hidden = false;
  const image = isImageFile(file.name);
  infoContent.replaceChildren(fileInfoDetails(file, image ? currentImageSize || 'unknown' : undefined));
  if (!image) return;
  const operation = new AbortController();
  infoRead = operation;
  void showPhotoExif(infoContent, file, operation.signal, size => {
    if (!currentImageSize) reportImageSize(file, size);
  }).finally(() => { if (infoRead === operation) infoRead = undefined; });
}

function hideFileInfo(): void {
  infoRead?.abort();
  infoRead = undefined;
  infoPanel.hidden = true;
}

function setupMarkdownToc(): void {
  clearMarkdownToc();
  if (!markdownTocSetting.checked || !currentPreview || !/\.(md|markdown)$/i.test(currentPreview.name)) return;
  markdownOutline = new MarkdownOutline(viewerHost, preview, toc, tocList);
  markdownOutline.mount();
}

function showError(message: string): void {
  welcome.hidden = true;
  preview.hidden = false;
  loading.hidden = true;
  errorMessage.textContent = message;
  errorBox.hidden = false;
}

function onViewerState(state: ViewerState, sourceGeneration: number): void {
  if (!isPreviewing || sourceGeneration !== generation) return;
  loading.hidden = !state.loading;
  if (state.error) {
    const message = state.error instanceof Error ? state.error.message : String(state.error);
    const file = currentPreview;
    if (!file || /\b404\b|not found/i.test(message)) showError(message);
    else queueMicrotask(() => {
      if (isPreviewing && sourceGeneration === generation && currentPreview === file) showMetadataFallback(file, '内容暂时无法预览，以下是文件信息。');
    });
  } else {
    errorBox.hidden = true;
  }
  if (state.ready && !state.loading && lastReadyGeneration !== generation) {
    lastReadyGeneration = generation;
    window.slowLook.metric('content-ready');
  }
}

function viewerOptions(renderers: ViewerOptions['renderers']): ViewerOptions {
  return {
    locale: 'zh-CN', theme: 'light', rendererMode: 'extend', renderers,
    image: { handTool: true },
    // The library ships a dedicated ZIP/XML worker; its default is disabled
    // unless explicitly configured. Keep page DOM layout on the UI thread.
    docx: { worker: true, renderYieldEveryMs: 8, visualPagination: true },
    pdf: { streaming: true, disableStream: true, disableAutoFetch: true },
    text: textOptions(),
    toolbar: { position: 'bottom-right', download: false, print: false, exportHtml: false },
    search: { enabled: true },
  };
}

function clarifySearchCount(mount: HTMLElement): void {
  const style = document.createElement('style');
  style.textContent = '.file-viewer-web-search-count::before{content:"匹配 ";font-weight:400}';
  mount.shadowRoot?.append(style);
}

async function renderZipEntry(name: string, blob: Blob, target: HTMLElement, signal: AbortSignal, archiveOwner = currentPreview, archiveDepth = 0): Promise<(() => void) | undefined> {
  if (/\.zip$/i.test(name)) {
    // The parent archive has already bounded this entry to 64 MiB. Give each
    // nested ZIP its own range-readable URL and revoke it on selection change.
    // A depth limit prevents deeply nested archives retaining unbounded blobs.
    if (archiveDepth >= 4) throw new Error('压缩包嵌套超过 4 层预览上限。');
    if (signal.aborted) return undefined;
    const url = URL.createObjectURL(blob);
    let cleanup: (() => void) | undefined;
    try {
      cleanup = trackedArchive(mountZipPreview(target, { name, url, size: blob.size }, () => undefined,
        (childName, child, mount, childSignal) => renderZipEntry(childName, child, mount, childSignal, archiveOwner, archiveDepth + 1)));
    } catch (error) { URL.revokeObjectURL(url); throw error; }
    let disposed = false;
    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      cleanup?.();
      URL.revokeObjectURL(url);
    };
    if (signal.aborted) { dispose(); return undefined; }
    signal.addEventListener('abort', dispose, { once: true });
    return () => { signal.removeEventListener('abort', dispose); dispose(); };
  }
  if (/\.(?:html|htm)$/i.test(name)) {
    if (signal.aborted) return undefined;
    const cleanup = trackedHtmlPreview(target, { url: '', size: blob.size, blob }, () => undefined);
    const stop = (): void => cleanup();
    signal.addEventListener('abort', stop, { once: true });
    return () => { signal.removeEventListener('abort', stop); cleanup(); };
  }
  if (/\.(docx|xlsx|pptx)$/i.test(name) && blob.size >= 8) {
    const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    if (signal.aborted) return undefined;
    if ([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((byte, index) => head[index] === byte)) {
      const owner = archiveOwner;
      if (!owner) throw new Error('预览已经关闭。');
      let previousError = '';
      let bytes: ArrayBuffer | undefined;
      while (!signal.aborted) {
        const password = await requestPassword(target, name, signal, previousError);
        if (password === null) {
          if (!signal.aborted) { const note = document.createElement('p'); note.className = 'zip-empty'; note.textContent = '已取消打开加密文档。'; target.replaceChildren(note); }
          return undefined;
        }
        bytes ??= await blob.arrayBuffer();
        const result = await contentTask({ url: owner.url, kind: 'office-data', password, data: bytes }, signal);
        if (signal.aborted) return undefined;
        if (result.ok && result.bytes) return await renderZipEntry(name, new Blob([result.bytes]), target, signal, owner);
        if (result.code !== 'password') throw new Error(result.message || '无法解密此文档。');
        previousError = result.message || '密码不正确，请重试。';
      }
      return undefined;
    }
  }
  const kind = mediaKind(name);
  if (kind) {
    const url = URL.createObjectURL(blob);
    const { wrapper, player, dispose: disposeVisual } = createMediaView({ name, size: blob.size, url }, kind);
    target.replaceChildren(wrapper);
    player.addEventListener('loadedmetadata', () => { if (!signal.aborted && autoplaySetting.checked) void player.play().catch(() => undefined); }, { once: true });
    let disposed = false;
    const dispose = (): void => { if (!disposed) { disposed = true; disposeVisual(); player.pause(); player.removeAttribute('src'); player.load(); URL.revokeObjectURL(url); } };
    if (signal.aborted) { dispose(); return undefined; }
    signal.addEventListener('abort', dispose, { once: true });
    return () => { signal.removeEventListener('abort', dispose); dispose(); };
  }
  const { viewer, renderers } = await loadModules(name);
  if (signal.aborted) return undefined;
  viewer.setDefaultFullAssetBaseUrl('/file-viewer/');
  const mount = document.createElement('div'); mount.className = 'viewer-root'; target.replaceChildren(mount);
  const nested = viewer.mountViewer(mount, { options: viewerOptions(renderers) });
  nestedControllers.add(nested);
  clarifySearchCount(mount);
  // A non-passive wheel listener makes Chromium wait for JavaScript before
  // scrolling. Documents inside large archives must not have one attached.
  const removeWheel = /\.(?:png|jpe?g|gif|webp|bmp|avif|svg|ico|tiff?|heic|heif|psd)$/i.test(name)
    ? installImageWheelZoom(target, () => nested) : () => undefined;
  let disposed = false;
  let stopImageSize: (() => void) | undefined;
  let stopPages: (() => void) | undefined;
  const dispose = (): void => { if (!disposed) { disposed = true; stopPages?.(); stopImageSize?.(); nestedControllers.delete(nested); removeWheel(); nested.destroy(); } };
  signal.addEventListener('abort', dispose, { once: true });
  try {
    await nested.load({ file: new File([blob], name), filename: name, size: blob.size });
    if (signal.aborted) { dispose(); return undefined; }
    stopPages = attachPageNavigation(target, mount, name);
    if (isImageFile(name)) stopImageSize = showNestedImageDimensions(target, mount, { name, size: blob.size, blob }, signal);
    return () => { signal.removeEventListener('abort', dispose); dispose(); };
  } catch (error) {
    signal.removeEventListener('abort', dispose); dispose(); throw error;
  }
}

async function contentTask(request: ContentRequest, signal: AbortSignal): Promise<ContentResponse> {
  if (signal.aborted) return { ok: false, code: 'cancelled', message: '预览已取消。' };
  const abort = (): void => window.slowLook.cancelContent(request.url);
  signal.addEventListener('abort', abort, { once: true });
  try { return await window.slowLook.contentTask(request); }
  finally { signal.removeEventListener('abort', abort); }
}

async function previewEncryptedOffice(file: PreviewFile, current: number, operation: AbortController): Promise<void> {
  loading.hidden = true;
  if (file.size > 64 * 1024 * 1024) {
    showMetadataFallback(file, '加密 Office 文件超过 64 MiB 预览上限。');
    return;
  }
  let previousError = '';
  while (current === generation && !operation.signal.aborted) {
    const password = await requestPassword(viewerHost, file.name, operation.signal, previousError);
    if (password === null) {
      if (!operation.signal.aborted && current === generation) showMetadataFallback(file, '已取消打开加密文档。');
      return;
    }
    loading.hidden = false; resetLoading('正在解密文档');
    const result = await contentTask({ url: file.url, kind: 'office', password }, operation.signal);
    if (operation.signal.aborted || current !== generation) return;
    if (!result.ok || !result.bytes) {
      loading.hidden = true;
      if (result.code === 'password') { previousError = result.message || '密码不正确，请重试。'; continue; }
      showMetadataFallback(file, result.message || '无法解密此文档。'); return;
    }
    resetLoading('正在解析解密后的文档');
    const cleanup = await renderZipEntry(file.name, new Blob([result.bytes]), viewerHost, operation.signal);
    if (operation.signal.aborted || current !== generation) { cleanup?.(); return; }
    disposeZip = cleanup;
    loading.hidden = true;
    if (lastReadyGeneration !== current) { lastReadyGeneration = current; window.slowLook.metric('content-ready'); }
    return;
  }
}

/** Preview a folder child without promoting it to the outer window's file. */
async function renderFolderFile(file: FolderFile, target: HTMLElement, signal: AbortSignal, forceOffice = false, forceFlyfishImage = false): Promise<(() => void) | undefined> {
  const disposeOnAbort = (dispose: () => void): (() => void) => {
    let closed = false;
    const stop = (): void => { if (!closed) { closed = true; dispose(); } };
    if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true });
    return () => { signal.removeEventListener('abort', stop); stop(); };
  };
  const archiveEntry = (name: string, blob: Blob, mount: HTMLElement, childSignal: AbortSignal) => renderZipEntry(name, blob, mount, childSignal, file);
  if (/\.(?:html|htm)$/i.test(file.name)) {
    return disposeOnAbort(trackedHtmlPreview(target, file, () => undefined));
  }
  if (/\.(zip|rar)$/i.test(file.name)) {
    const cleanup = /\.zip$/i.test(file.name)
      ? trackedArchive(mountZipPreview(target, file, () => undefined, archiveEntry))
      : trackedArchive(mountRarPreview(target, file, () => undefined, archiveEntry, contentTask));
    return disposeOnAbort(cleanup);
  }
  if (supportsBrowserImage(file.name) && !forceFlyfishImage) {
    let fallback: (() => void) | undefined;
    let cleanup = mountBrowserImage(target, file.url, () => undefined, () => {
      if (signal.aborted) return;
      cleanup();
      target.textContent = '正在尝试其他图片预览方式…';
      void renderFolderFile(file, target, signal, forceOffice, true).then((dispose) => {
        fallback = dispose; if (signal.aborted) dispose?.();
      }).catch(() => {
        if (signal.aborted) return;
        const card = document.createElement('div'); card.className = 'metadata-fallback';
        const contents = document.createElement('div'); contents.className = 'metadata-card';
        const heading = document.createElement('h2'); heading.textContent = file.name;
        const note = document.createElement('p'); note.textContent = '图片无法解码，显示文件信息。';
        contents.append(heading, note, fileInfoDetails(file)); card.append(contents); target.replaceChildren(card);
      });
    }, true);
    return disposeOnAbort(() => { cleanup(); fallback?.(); });
  }
  const kind = mediaKind(file.name);
  if (kind) {
    const { wrapper, player, dispose } = createMediaView(file, kind); target.replaceChildren(wrapper);
    player.addEventListener('loadedmetadata', () => { if (!signal.aborted && autoplaySetting.checked) void player.play().catch(() => undefined); }, { once: true });
    return disposeOnAbort(() => { dispose(); player.pause(); player.removeAttribute('src'); player.load(); });
  }
  if (/\.(docx|xlsx|pptx)$/i.test(file.name)) {
    const head = await readHead(file.url, file.size, 8, signal);
    if (signal.aborted) return undefined;
    if ([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((byte, index) => head[index] === byte)) {
      if (file.size > 64 * 1024 * 1024) throw new Error('加密 Office 文件超过 64 MiB 预览上限。');
      let error = '';
      while (!signal.aborted) {
        const password = await requestPassword(target, file.name, signal, error);
        if (password === null) return undefined;
        const result = await contentTask({ url: file.url, kind: 'office', password }, signal);
        if (signal.aborted) return undefined;
        if (result.ok && result.bytes) return renderZipEntry(file.name, new Blob([result.bytes]), target, signal, file);
        if (result.code !== 'password') throw new Error(result.message || '无法解密此文档。');
        error = result.message || '密码不正确，请重试。';
      }
      return undefined;
    }
    if (file.size > 128 * 1024 * 1024 && !forceOffice) {
      let nested: (() => void) | undefined;
      const cleanup = mountZipPreview(target, file, () => undefined, archiveEntry, { label: 'OFFICE STRUCTURE', fullPreview: () => {
        cleanup();
        void renderFolderFile(file, target, signal, true).then((dispose) => { nested = dispose; if (signal.aborted) dispose?.(); }).catch((error) => {
          if (!signal.aborted) { const note = document.createElement('p'); note.className = 'folder-detail-empty'; note.textContent = error instanceof Error ? error.message : '无法预览此文档。'; target.replaceChildren(note); }
        });
      } });
      return disposeOnAbort(() => { cleanup(); nested?.(); });
    }
  }
  let filename = file.name;
  const core = await import('@file-viewer/core');
  if (signal.aborted) return undefined;
  const lower = file.name.toLowerCase();
  const extension = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  const definitions: readonly RendererDefinition[] = core.DEFAULT_RENDERER_DEFINITIONS;
  const registered = definitions.some((definition) => definition.extensions.includes(extension) ||
    definition.filenamePatterns?.some((pattern) => pattern.toLowerCase() === lower || (pattern.startsWith('*.') && lower.endsWith(pattern.slice(1).toLowerCase()))));
  if (!registered || FORCE_INSPECTION_EXTENSIONS.includes(extension)) {
    const head = await readHead(file.url, file.size, 8192, signal);
    if (signal.aborted) return undefined;
    if (isProbablyText(head)) filename = 'preview.txt';
    else {
      const card = document.createElement('div'); card.className = 'metadata-fallback';
      const contents = document.createElement('div'); contents.className = 'metadata-card';
      const heading = document.createElement('h2'); heading.textContent = file.name;
      const note = document.createElement('p'); note.textContent = '暂不支持内容预览，显示文件信息。';
      const hex = document.createElement('pre'); hex.className = 'metadata-hex'; hex.textContent = formatHexSample(head);
      contents.append(heading, note, fileInfoDetails(file), hex); card.append(contents); target.replaceChildren(card);
      return undefined;
    }
  }
  if ((shouldPreviewTextInChunks(file) || (filename === 'preview.txt' && file.size > LARGE_TEXT_THRESHOLD))) {
    const bytes = await readHead(file.url, file.size, LARGE_TEXT_CHUNK, signal);
    if (signal.aborted) return undefined;
    let value: string;
    if (bytes[0] === 0xff && bytes[1] === 0xfe) value = new TextDecoder('utf-16le').decode(bytes);
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) value = new TextDecoder('utf-16be').decode(bytes);
    else {
      try { value = new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true }); }
      catch { value = new TextDecoder('gb18030').decode(bytes); }
    }
    const container = document.createElement('div'); container.className = 'folder-text-fragment';
    const note = document.createElement('p'); note.textContent = `仅显示开头 ${formatSize(bytes.length)} · 总计 ${formatSize(file.size)}`;
    const scroller = document.createElement('div'); scroller.className = 'large-text-scroll';
    const gutter = document.createElement('div'); gutter.className = 'large-text-gutter'; gutter.setAttribute('aria-hidden', 'true');
    const viewport = document.createElement('div'); viewport.className = 'large-text-gutter-viewport';
    const numbers = document.createElement('div'); numbers.className = 'large-text-gutter-numbers'; viewport.append(numbers); gutter.append(viewport);
    const text = document.createElement('pre'); text.id = 'large-text-content'; text.textContent = value;
    scroller.append(gutter, text); container.append(note, scroller); target.replaceChildren(container);
    let lineCount = 1; for (const character of value) if (character === '\n') lineCount += 1;
    const update = (): void => {
      gutter.hidden = !lineNumbersSetting.checked; scroller.classList.toggle('with-line-numbers', lineNumbersSetting.checked);
      if (gutter.hidden) return;
      const height = scroller.clientHeight || 400;
      const first = Math.max(0, Math.floor((scroller.scrollTop - 20) / 21) - 1);
      const last = Math.min(lineCount, first + Math.ceil(height / 21) + 3);
      viewport.style.height = `${height}px`; numbers.style.transform = `translateY(${20 + first * 21 - scroller.scrollTop}px)`;
      numbers.textContent = Array.from({ length: Math.max(0, last - first) }, (_, index) => String(first + index + 1)).join('\n');
    };
    scroller.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : undefined;
    observer?.observe(scroller); refreshFolderText = update; update();
    return disposeOnAbort(() => { scroller.removeEventListener('scroll', update); observer?.disconnect(); if (refreshFolderText === update) refreshFolderText = undefined; });
  }
  const { viewer, renderers } = await loadModules(filename);
  if (signal.aborted) return undefined;
  viewer.setDefaultFullAssetBaseUrl('/file-viewer/');
  const mount = document.createElement('div'); mount.className = 'viewer-root'; target.replaceChildren(mount);
  const nested = viewer.mountViewer(mount, { options: viewerOptions(renderers) });
  nestedControllers.add(nested);
  clarifySearchCount(mount);
  const removeWheel = /\.(?:png|jpe?g|gif|webp|bmp|avif|tiff?|heic|heif|psd|svg|ico)$/i.test(filename) ? installImageWheelZoom(target, () => nested) : () => undefined;
  let stopImageSize: (() => void) | undefined;
  let stopPages: (() => void) | undefined;
  const cleanup = disposeOnAbort(() => { stopPages?.(); stopImageSize?.(); nestedControllers.delete(nested); removeWheel(); nested.destroy(); });
  try {
    await nested.load({ url: file.url, filename, size: file.size });
    if (signal.aborted) cleanup();
    else {
      stopPages = attachPageNavigation(target, mount, filename);
      if (/\.(?:md|markdown)$/i.test(filename)) loadMarkdownImages(mount, file.url, () => !signal.aborted);
      else if (isImageFile(filename)) stopImageSize = showNestedImageDimensions(target, mount, file, signal);
    }
    return cleanup;
  }
  catch (error) { cleanup(); throw error; }
}

async function previewFile(file: PreviewFile): Promise<void> {
  const current = ++generation;
  isPreviewing = true;
  openDefaultButton.disabled = false;
  currentPreview = file;
  infoButton.hidden = false;
  infoPanel.hidden = true;
  nameLabel.textContent = file.name;
  nameLabel.title = file.name;
  sizeLabel.textContent = formatSize(file.size);
  if (isImageFile(file.name)) {
    imageRead?.abort();
    currentImageSize = undefined;
    const operation = new AbortController();
    imageRead = operation;
    void readImageDimensions(file, operation.signal).then(size => {
      if (size && !operation.signal.aborted && current === generation) reportImageSize(file, size);
    }).catch(() => {});
  }
  welcome.hidden = true;
  preview.hidden = false;
  loading.hidden = false;
  errorBox.hidden = true;
  resetLoading();
  if (/\.lnk$/i.test(file.name)) {
    showMetadataFallback(file, '这是一个快捷方式，显示它的文件信息和目标。');
    return;
  }
  if (/\.(?:html|htm)$/i.test(file.name)) {
    disposeZip = trackedHtmlPreview(viewerHost, file, () => {
      if (current !== generation) return;
      loading.hidden = true;
      if (lastReadyGeneration !== current) { lastReadyGeneration = current; window.slowLook.metric('content-ready'); }
    });
    return;
  }
  // ZIP uses range-based reads; RAR uses a seekable WASM worker.
  if (/\.(zip|rar)$/i.test(file.name)) {
    resetLoading('正在读取压缩包目录');
    const ready = (): void => {
      if (current !== generation) return;
      loading.hidden = true;
      if (lastReadyGeneration !== current) { lastReadyGeneration = current; window.slowLook.metric('content-ready'); }
    };
    disposeZip = /\.zip$/i.test(file.name)
      ? trackedArchive(mountZipPreview(viewerHost, file, ready, renderZipEntry))
      : trackedArchive(mountRarPreview(viewerHost, file, ready, renderZipEntry, contentTask));
    return;
  }
  if (supportsBrowserImage(file.name)) {
    resetLoading('正在读取图片');
    disposeZip = mountBrowserImage(viewerHost, file.url, (size) => {
      if (current !== generation) return;
      reportImageSize(file, size);
      loading.hidden = true;
      if (lastReadyGeneration !== current) { lastReadyGeneration = current; window.slowLook.metric('content-ready'); }
    }, () => {
      if (current !== generation) return;
      disposeZip?.(); disposeZip = undefined;
      void loadFlyfish(file, current);
    });
    return;
  }
  const kind = mediaKind(file.name);
  if (kind) {
    resetLoading('正在准备播放');
    showMedia(file, current, kind);
    return;
  }
  if (shouldPreviewTextInChunks(file)) {
    showLargeText(file, current, 'preview.txt');
    return;
  }
  let operation: AbortController | undefined;
  try {
    if (/\.(docx|xlsx|pptx)$/i.test(file.name)) {
      operation = new AbortController(); probeRead = operation;
      const head = await readHead(file.url, file.size, 8, operation.signal);
      if (current !== generation || operation.signal.aborted) return;
      if ([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((byte, index) => head[index] === byte)) {
        await previewEncryptedOffice(file, current, operation);
        return;
      }
      if (probeRead === operation) probeRead = undefined;
      operation = undefined;
      if (file.size > 128 * 1024 * 1024) {
        resetLoading('正在读取文档结构');
        disposeZip = mountZipPreview(viewerHost, file, () => {
          if (current !== generation) return;
          loading.hidden = true;
          if (lastReadyGeneration !== current) { lastReadyGeneration = current; window.slowLook.metric('content-ready'); }
        }, renderZipEntry, { label: 'OFFICE STRUCTURE', fullPreview: () => {
          if (current !== generation) return;
          disposeZip?.(); disposeZip = undefined; loading.hidden = false; resetLoading('正在读取完整文档');
          void loadFlyfish(file, current);
        } });
        return;
      }
    }
    const { DEFAULT_RENDERER_DEFINITIONS } = await import('@file-viewer/core');
    if (current !== generation) return;
    const lower = file.name.toLowerCase();
    const extension = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
    const definitions: readonly RendererDefinition[] = DEFAULT_RENDERER_DEFINITIONS;
    const registered = definitions.some((definition) => definition.extensions.includes(extension) ||
      definition.filenamePatterns?.some((pattern) => pattern.toLowerCase() === lower || (pattern.startsWith('*.') && lower.endsWith(pattern.slice(1).toLowerCase()))));
    const needsInspection = !registered || FORCE_INSPECTION_EXTENSIONS.includes(extension);
    if (!needsInspection) { await loadFlyfish(file, current); return; }
    operation = new AbortController();
    probeRead = operation;
    const bytes = await readHead(file.url, file.size, 8192, operation.signal);
    if (current !== generation || operation.signal.aborted) return;
    if (probeRead === operation) probeRead = undefined;
    if (extension === 'url') {
      const text = new TextDecoder().decode(bytes);
      const target = /^URL=(.*)$/im.exec(text)?.[1]?.trim();
      file.shortcut = { target };
      showMetadataFallback(file, '这是一个网络快捷方式，显示它的文件信息和目标。');
    } else if (isProbablyText(bytes)) {
      if (file.size > LARGE_TEXT_THRESHOLD) showLargeText(file, current, 'preview.txt');
      else await loadFlyfish(file, current, 'preview.txt');
    } else showMetadataFallback(file, '暂不支持此文件的内容预览，以下是文件信息和文件头。', bytes);
  } catch (error) {
    if (current === generation && !operation?.signal.aborted) showMetadataFallback(file, '内容暂时无法读取，以下是文件信息。');
  } finally {
    if (probeRead === operation) probeRead = undefined;
  }
}

async function loadFlyfish(file: PreviewFile, current: number, viewerFilename = file.name): Promise<void> {
  try {
    removeMainImageWheel?.(); removeMainImageWheel = undefined;
    if (/\.(?:png|jpe?g|gif|webp|bmp|avif|svg|ico|tiff?|heic|heif|psd)$/i.test(viewerFilename)) {
      removeMainImageWheel = installImageWheelZoom(viewerHost, () => controller);
    }
    const { viewer, renderers } = await loadModules(viewerFilename);
    if (current !== generation) return;
    if (!controller) {
      viewer.setDefaultFullAssetBaseUrl('/file-viewer/');
      const mountRoot = document.createElement('div');
      mountRoot.className = 'viewer-root';
      viewerHost.replaceChildren(mountRoot);
      controller = viewer.mountViewer(mountRoot, {
        options: viewerOptions(renderers),
      });
      clarifySearchCount(mountRoot);
      controller.subscribe((state) => onViewerState(state, current));
    }
    await controller.load({ url: file.url, filename: viewerFilename, size: file.size });
    if (current === generation) {
      const pageMount = viewerHost.querySelector<HTMLElement>('.viewer-root');
      if (pageMount) {
        disposeMainPageNavigation?.();
        disposeMainPageNavigation = attachPageNavigation(viewerHost, pageMount, viewerFilename);
      }
      if (isImageFile(viewerFilename) && !/\.svg$/i.test(viewerFilename)) {
        const mount = viewerHost.querySelector<HTMLElement>('.viewer-root');
        if (mount) {
          stopWatchingImage?.();
          stopWatchingImage = watchRenderedDimensions(mount, size => {
            if (current === generation) reportImageSize(file, size);
          });
        }
      }
      if (/\.(?:md|markdown)$/i.test(viewerFilename)) {
        const mount = viewerHost.querySelector<HTMLElement>('.viewer-root');
        if (mount) loadMarkdownImages(mount, file.url, () => current === generation);
      }
      setupMarkdownToc();
    }
  } catch (error) {
    if (current === generation) {
      const message = error instanceof Error ? error.message : String(error);
      if (/\b404\b|not found/i.test(message)) showError(message);
      else showMetadataFallback(file, '内容暂时无法预览，以下是文件信息。');
    }
  }
}

function clearPreview(): void {
  generation += 1;
  isPreviewing = false;
  finderNavigationAvailable = false;
  openDefaultButton.disabled = true;
  openFeedback.hidden = true;
  currentPreview = undefined;
  infoButton.hidden = true;
  infoPanel.hidden = true;
  clearMarkdownToc();
  disposePreviewViews();
  stopProbe();
  stopTextRead();
  clearLargeText();
  stopMedia();
  controller?.destroy();
  controller = undefined;
  viewerHost.replaceChildren();
  nameLabel.textContent = '';
  sizeLabel.textContent = '';
  loading.hidden = true;
  errorBox.hidden = true;
  preview.hidden = true;
  welcome.hidden = false;
}

window.slowLook.onStart((file) => {
  generation += 1;
  isPreviewing = false;
  finderNavigationAvailable = Boolean(file.finderNavigation);
  openDefaultButton.disabled = true;
  openFeedback.hidden = true;
  currentPreview = undefined;
  infoButton.hidden = true;
  infoPanel.hidden = true;
  clearMarkdownToc();
  disposePreviewViews();
  stopProbe();
  stopTextRead();
  clearLargeText();
  stopMedia();
  controller?.destroy();
  controller = undefined;
  viewerHost.replaceChildren();
  nameLabel.textContent = file.name;
  sizeLabel.textContent = '';
  welcome.hidden = true;
  preview.hidden = false;
  errorBox.hidden = true;
  loading.hidden = false;
  resetLoading();
  if (document.hasFocus()) preview.focus({ preventScroll: true });
});
window.slowLook.onPreview((file) => { void previewFile(file); });
window.slowLook.onDirectory((folder) => {
  const current = ++generation;
  isPreviewing = true;
  openDefaultButton.disabled = false;
  currentPreview = undefined;
  nameLabel.textContent = folder.name;
  nameLabel.title = folder.path;
  sizeLabel.textContent = '文件夹';
  welcome.hidden = true;
  preview.hidden = false;
  errorBox.hidden = true;
  loading.hidden = false;
  resetLoading('正在读取文件夹');
  folderView = mountFolderPreview(viewerHost, folder, window.slowLook.readDirectory, () => {
    if (current !== generation) return;
    loading.hidden = true;
    if (lastReadyGeneration !== current) { lastReadyGeneration = current; window.slowLook.metric('content-ready'); }
  }, { open: window.slowLook.openDirectoryFile, render: renderFolderFile, release: () => window.slowLook.releaseDirectoryPreview(folder.id) },
  { inlinePreview: folderPreviewSetting.checked, thumbnails: folderThumbnailsSetting.checked, hideMacMetadata: hideMacMetadataSetting.checked });
});
window.slowLook.onClear(clearPreview);
window.slowLook.onProgress((progress) => {
  if (!isPreviewing || loading.hidden) return;
  if (progress.phase === 'reading' && progress.total && progress.total > 0) {
    const loaded = Math.min(progress.loaded || 0, progress.total);
    loadingLabel.textContent = '正在读取文件';
    loadingDetail.textContent = `${formatSize(loaded)} / ${formatSize(progress.total)}`;
    loadingProgress.value = loaded / progress.total * 100;
    loadingProgress.hidden = false;
  } else {
    loadingLabel.textContent = progress.phase === 'parsing' ? '正在解析文件' : '正在按需读取文件';
    loadingDetail.textContent = '解析时间取决于文件大小和格式';
    loadingProgress.hidden = true;
  }
});
window.slowLook.onIntegrationStatus((message) => {
  const status = element('#integration-status');
  status.textContent = message ? `${message} ` : '';
  element('#integration-current-status').textContent = message || '等待文件管理器操作';
});
window.slowLook.onError((message) => {
  generation += 1;
  isPreviewing = false;
  openDefaultButton.disabled = true;
  openFeedback.hidden = true;
  currentPreview = undefined;
  infoButton.hidden = true;
  infoPanel.hidden = true;
  clearMarkdownToc();
  disposePreviewViews();
  stopProbe();
  stopTextRead();
  clearLargeText();
  stopMedia();
  controller?.destroy();
  controller = undefined;
  viewerHost.replaceChildren();
  showError(message);
});
openDefaultButton.addEventListener('click', () => {
  const current = generation;
  openFeedback.hidden = true;
  void window.slowLook.openWithDefault().then((result) => {
    if (current !== generation || result.ok) return;
    openFeedbackMessage.textContent = result.message || '无法使用默认应用打开，请检查文件和默认应用。';
    openFeedback.hidden = false;
  }).catch(() => {
    if (current !== generation) return;
    openFeedbackMessage.textContent = '无法使用默认应用打开，请检查文件和默认应用。';
    openFeedback.hidden = false;
  });
});
element('#open-feedback-close').addEventListener('click', () => { openFeedback.hidden = true; });
element('#choose').addEventListener('click', () => { void window.slowLook.selectFile(); });
element('#choose-welcome').addEventListener('click', () => { void window.slowLook.selectFile(); });
element('#choose-folder').addEventListener('click', () => { void window.slowLook.selectFolder(); });
element('#close').addEventListener('click', () => window.slowLook.hide());
infoButton.addEventListener('click', () => {
  if (!infoPanel.hidden) { hideFileInfo(); return; }
  if (currentPreview) showFileInfo(currentPreview);
});
element('#file-info-close').addEventListener('click', () => { hideFileInfo(); infoButton.focus(); });
element('#settings-open').addEventListener('click', () => {
  settingsPanel.hidden = false;
  element('[role="tab"][aria-selected="true"]').focus();
  void refreshStartup();
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-settings-tab]')) {
  button.addEventListener('click', () => {
    for (const tab of document.querySelectorAll<HTMLButtonElement>('[data-settings-tab]')) {
      const selected = tab === button;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const group of document.querySelectorAll<HTMLElement>('[data-settings-group]')) group.hidden = group.dataset.settingsGroup !== button.dataset.settingsTab;
  });
  button.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-settings-tab]'));
    const next = tabs[(tabs.indexOf(button) + (event.key === 'ArrowDown' ? 1 : tabs.length - 1)) % tabs.length];
    next.click();
    next.focus();
  });
}
element('#settings-close').addEventListener('click', () => {
  settingsPanel.hidden = true;
  element('#settings-open').focus();
});
settingsPanel.addEventListener('click', (event) => {
  if (event.target === settingsPanel) settingsPanel.hidden = true;
});

// Capture Space before a focused button or switch can handle it.
document.addEventListener('keydown', (event) => {
  if (!spaceClosesPreviewSetting.checked || preview.hidden || (event.code !== 'Space' && event.key !== ' ') ||
      event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
  const needsSpace = event.composedPath().some((target) => target instanceof HTMLElement && (
    target.isContentEditable || ['TEXTAREA', 'SELECT', 'VIDEO', 'AUDIO'].includes(target.tagName) ||
    (target instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'reset', 'submit'].includes(target.type)) ||
    ['textbox', 'combobox', 'slider', 'spinbutton'].includes(target.getAttribute('role') || '')
  ));
  if (needsSpace) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (!event.repeat) {
    settingsPanel.hidden = true;
    window.slowLook.hide();
  }
}, { capture: true });

document.addEventListener('keydown', (event) => {
  if (isMac && event.metaKey && event.key === ',' && settingsPanel.hidden) {
    event.preventDefault();
    element('#settings-open').click();
    return;
  }
  if (!settingsPanel.hidden) {
    if (event.key === 'Escape') { event.preventDefault(); settingsPanel.hidden = true; element('#settings-open').focus(); }
    return;
  }
  if (event.key === 'Escape' && !infoPanel.hidden) {
    event.preventDefault();
    hideFileInfo();
    infoButton.focus();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    void window.slowLook.selectFile();
    return;
  }
  const interacting = event.composedPath().some((target) => target instanceof HTMLElement && (
    target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'VIDEO', 'AUDIO'].includes(target.tagName) || target.getAttribute('role') === 'button'
  ));
  const navigationInteracting = event.composedPath().some((target) => target instanceof HTMLElement && (
    target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'VIDEO', 'AUDIO'].includes(target.tagName) ||
    ['textbox', 'slider', 'spinbutton'].includes(target.getAttribute('role') || '') || Boolean(target.closest('.folder-browser'))
  ));
  const navigatesFile = isMac
    ? !pinned && finderNavigationAvailable && (event.key === 'ArrowUp' || event.key === 'ArrowDown')
    : isPreviewing && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key);
  if (navigationSetting.checked && navigatesFile && !navigationInteracting && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
    event.preventDefault();
    window.slowLook.navigate(event.key);
    return;
  }
  if (event.key === 'Escape' || (event.code === 'Space' && !interacting && !event.repeat)) {
    event.preventDefault();
    window.slowLook.hide();
  }
});

document.addEventListener('dragover', (event) => {
  event.preventDefault();
  if (event.dataTransfer?.types.includes('Files')) dragOverlay.hidden = false;
});
document.addEventListener('dragleave', (event) => {
  if (!event.relatedTarget) dragOverlay.hidden = true;
});
document.addEventListener('drop', (event) => {
  event.preventDefault();
  dragOverlay.hidden = true;
  const file = event.dataTransfer?.files[0];
  if (file) void window.slowLook.openDroppedFile(file);
});

// Warm the rendering modules while the empty window remains responsive.
window.setTimeout(() => { void loadViewer().catch(() => undefined); }, 300);
