const AUTO_PREVIEW_LIMIT = 64 * 1024 * 1024;
const SOURCE_LIMIT = 1024 * 1024;

export interface HtmlPreviewSource { url: string; size: number; blob?: Blob }
export interface HtmlPreview { setScriptsEnabled(enabled: boolean): void; dispose(): void }

/** Render the original document by URL, avoiding a full copy into the app renderer. */
export function mountHtmlPreview(target: HTMLElement, source: HtmlPreviewSource, scriptsEnabled: boolean, onReady: () => void): HtmlPreview {
  const root = document.createElement('section'); root.className = 'html-preview';
  const toolbar = document.createElement('div'); toolbar.className = 'html-preview-toolbar';
  const pageButton = document.createElement('button'); pageButton.type = 'button'; pageButton.textContent = '网页预览';
  const sourceButton = document.createElement('button'); sourceButton.type = 'button'; sourceButton.textContent = '查看源码';
  const status = document.createElement('span'); status.className = 'html-preview-status'; status.setAttribute('role', 'status');
  toolbar.append(pageButton, sourceButton, status);
  const area = document.createElement('div'); area.className = 'html-preview-area';
  root.append(toolbar, area); target.replaceChildren(root);
  let frame: HTMLIFrameElement | undefined;
  let reading: AbortController | undefined;
  let disposed = false;
  let view: 'page' | 'source' = 'page';
  let largeConfirmed = false;
  let objectUrl: string | undefined;
  // Archive readers return an untyped Blob. Set its MIME without copying its
  // bytes so Chromium displays the entry as a page instead of a download.
  const url = source.blob ? (objectUrl = URL.createObjectURL(source.blob.slice(0, source.blob.size, 'text/html'))) : source.url;

  function updateButtons(): void {
    pageButton.setAttribute('aria-pressed', String(view === 'page'));
    sourceButton.setAttribute('aria-pressed', String(view === 'source'));
  }
  function stopCurrent(): void {
    reading?.abort(); reading = undefined;
    frame?.remove(); frame = undefined;
    area.replaceChildren();
  }
  function modeLabel(): string { return scriptsEnabled ? '本地隔离预览 · 脚本已启用' : '本地隔离预览 · 脚本已关闭'; }

  async function showSource(): Promise<void> {
    if (disposed) return;
    view = 'source'; updateButtons(); stopCurrent();
    status.textContent = source.size > SOURCE_LIMIT ? '只读取开头 1 MiB' : '正在读取源码…';
    const pre = document.createElement('pre'); pre.className = 'html-preview-source'; pre.textContent = '正在读取源码…'; area.append(pre);
    const operation = new AbortController(); reading = operation;
    try {
      let bytes: ArrayBuffer;
      if (source.blob) bytes = await source.blob.slice(0, SOURCE_LIMIT).arrayBuffer();
      else {
        const response = await fetch(url, { headers: { Range: `bytes=0-${SOURCE_LIMIT - 1}` }, signal: operation.signal });
        if (!response.ok || (source.size > SOURCE_LIMIT && response.status !== 206)) throw new Error('无法按范围读取源码。');
        bytes = await response.arrayBuffer();
      }
      if (disposed || operation.signal.aborted) return;
      const sample = new Uint8Array(bytes);
      let text: string;
      if (sample[0] === 0xff && sample[1] === 0xfe) text = new TextDecoder('utf-16le').decode(sample);
      else if (sample[0] === 0xfe && sample[1] === 0xff) text = new TextDecoder('utf-16be').decode(sample);
      else {
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: source.size > sample.length }); }
        catch { text = new TextDecoder('gb18030').decode(sample); }
      }
      pre.textContent = text;
      status.textContent = source.size > SOURCE_LIMIT ? '仅显示开头 1 MiB 源码' : '显示完整源码';
    } catch (error) {
      if (!disposed && !operation.signal.aborted) { pre.textContent = error instanceof Error ? error.message : '无法读取源码。'; status.textContent = '源码读取失败'; }
    } finally { if (reading === operation) reading = undefined; }
  }
  function showPage(force = false): void {
    if (disposed) return;
    view = 'page'; updateButtons(); stopCurrent();
    if (source.size > AUTO_PREVIEW_LIMIT && !largeConfirmed && !force) {
      status.textContent = '文件较大，默认不运行完整网页';
      const warning = document.createElement('div'); warning.className = 'html-preview-large';
      const message = document.createElement('p'); message.textContent = '这个 HTML 超过 64 MiB，完整网页可能占用较多内存。';
      const open = document.createElement('button'); open.type = 'button'; open.textContent = '加载完整网页';
      open.addEventListener('click', () => { largeConfirmed = true; showPage(true); });
      const fragment = document.createElement('button'); fragment.type = 'button'; fragment.textContent = '查看开头源码';
      fragment.addEventListener('click', () => { void showSource(); });
      warning.append(message, open, fragment); area.append(warning); return;
    }
    status.textContent = `${modeLabel()} · 正在加载…`;
    frame = document.createElement('iframe'); frame.className = 'html-preview-frame';
    frame.title = 'HTML 网页预览';
    // Do not allow same-origin: HTML scripts must not access the host bridge.
    frame.setAttribute('sandbox', scriptsEnabled ? 'allow-scripts allow-pointer-lock' : '');
    frame.referrerPolicy = 'no-referrer';
    const currentFrame = frame;
    currentFrame.addEventListener('load', () => { if (!disposed && frame === currentFrame) status.textContent = modeLabel(); }, { once: true });
    currentFrame.src = url; area.append(currentFrame);
  }
  pageButton.addEventListener('click', () => showPage());
  sourceButton.addEventListener('click', () => { void showSource(); });
  showPage();
  onReady();
  return {
    setScriptsEnabled(enabled) { if (disposed || scriptsEnabled === enabled) return; scriptsEnabled = enabled; if (view === 'page') showPage(); },
    dispose() { if (disposed) return; disposed = true; stopCurrent(); if (objectUrl) URL.revokeObjectURL(objectUrl); root.remove(); },
  };
}
