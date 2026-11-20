import { formatDimensions, type ImageDimensions } from './image-metadata.ts';

/** Browser-decoded images avoid a second JavaScript Blob/base64 copy of the file. */
export function supportsBrowserImage(name: string): boolean {
  return /\.(?:png|apng|jpe?g|jfif|gif|webp|bmp|avif)$/i.test(name);
}

export function mountBrowserImage(target: HTMLElement, url: string, onReady: (size: ImageDimensions) => void, onFailure: () => void, showSize = false): () => void {
  const root = document.createElement('div'); root.className = 'browser-image-view';
  const bar = document.createElement('div'); bar.className = 'browser-image-toolbar';
  const viewport = document.createElement('div'); viewport.className = 'browser-image-viewport';
  const stage = document.createElement('div'); stage.className = 'browser-image-stage';
  const frame = document.createElement('div'); frame.className = 'browser-image-frame';
  const img = document.createElement('img'); img.alt = ''; img.draggable = false; frame.append(img); stage.append(frame); viewport.append(stage);
  let scale = 1, rotation = 0, fit = true, disposed = false, loaded = false;
  const button = (label: string, title: string, action: () => void): HTMLButtonElement => {
    const item = document.createElement('button'); item.type = 'button'; item.textContent = label; item.title = title; item.setAttribute('aria-label', title); item.addEventListener('click', action); return item;
  };
  const zoomOut = button('−', '缩小', () => changeScale(scale / 1.1));
  const percent = button('适应', '适应窗口', () => { fit = true; layout(); });
  const zoomIn = button('+', '放大', () => changeScale(scale * 1.1));
  const actual = button('1:1', '实际大小', () => changeScale(1));
  const rotate = button('↻', '顺时针旋转', () => { rotation = (rotation + 90) % 360; layout(); });
  const sizeLabel = document.createElement('span');
  sizeLabel.className = 'browser-image-size';
  if (showSize) bar.append(sizeLabel);
  bar.append(zoomOut, percent, zoomIn, actual, rotate); root.append(bar, viewport); target.replaceChildren(root);
  function layout(): void {
    if (!loaded || disposed) return;
    const width = img.naturalWidth, height = img.naturalHeight;
    const sideways = rotation % 180 !== 0;
    const rotatedWidth = sideways ? height : width, rotatedHeight = sideways ? width : height;
    if (fit) {
      const availableWidth = Math.max(1, viewport.clientWidth - 48), availableHeight = Math.max(1, viewport.clientHeight - 48);
      scale = Math.min(1, availableWidth / rotatedWidth, availableHeight / rotatedHeight);
    }
    frame.style.width = `${rotatedWidth * scale}px`; frame.style.height = `${rotatedHeight * scale}px`;
    img.style.width = `${width * scale}px`; img.style.height = `${height * scale}px`;
    img.style.transform = `translate(-50%, -50%) rotate(${rotation}deg)`;
    percent.textContent = `${Math.round(scale * 100)}%`;
  }
  function changeScale(value: number): void { if (!loaded) return; fit = false; scale = Math.min(5, Math.max(0.01, value)); layout(); }
  const wheel = (event: WheelEvent): void => {
    if (!loaded || !event.deltaY || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(viewport.clientHeight, 100) : 1;
    changeScale(scale * Math.exp(-Math.max(-360, Math.min(360, event.deltaY * unit)) / 2400));
  };
  viewport.addEventListener('wheel', wheel, { passive: false });
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (fit) layout(); }) : undefined;
  observer?.observe(viewport);
  img.addEventListener('load', () => {
    if (disposed || !img.naturalWidth || !img.naturalHeight) return;
    loaded = true;
    layout();
    const size = { width: img.naturalWidth, height: img.naturalHeight };
    if (showSize) sizeLabel.textContent = formatDimensions(size);
    onReady(size);
  });
  img.addEventListener('error', () => { if (!disposed) onFailure(); });
  img.src = url;
  return () => { disposed = true; observer?.disconnect(); viewport.removeEventListener('wheel', wheel); img.removeAttribute('src'); };
}
