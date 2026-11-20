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
  let drag: { id: number; x: number; y: number; left: number; top: number; ratioX: number; ratioY: number } | undefined;
  const view = viewport.ownerDocument.defaultView;
  const canPan = (): boolean => loaded && (viewport.scrollWidth > viewport.clientWidth || viewport.scrollHeight > viewport.clientHeight);
  const syncHandCursor = (): void => { viewport.classList.toggle('is-pannable', canPan()); };
  const finishPan = (): void => {
    const current = drag;
    if (!current) return;
    drag = undefined;
    viewport.classList.remove('is-panning');
    view?.removeEventListener('pointermove', movePan);
    view?.removeEventListener('pointerup', endPan);
    view?.removeEventListener('pointercancel', endPan);
    view?.removeEventListener('blur', finishPan);
    if (viewport.hasPointerCapture?.(current.id)) viewport.releasePointerCapture(current.id);
    syncHandCursor();
  };
  const movePan = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.id) return;
    if (!(event.buttons & 1)) { finishPan(); return; }
    viewport.scrollLeft = drag.left - (event.clientX - drag.x) / drag.ratioX;
    viewport.scrollTop = drag.top - (event.clientY - drag.y) / drag.ratioY;
    event.preventDefault();
  };
  const endPan = (event: PointerEvent): void => { if (drag?.id === event.pointerId) finishPan(); };
  const startPan = (event: PointerEvent): void => {
    if (!view || event.defaultPrevented || event.pointerType !== 'mouse' || event.button !== 0 || event.isPrimary === false ||
        event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !canPan()) return;
    const rect = viewport.getBoundingClientRect();
    const ratioX = viewport.offsetWidth ? rect.width / viewport.offsetWidth : 1;
    const ratioY = viewport.offsetHeight ? rect.height / viewport.offsetHeight : 1;
    if (![ratioX, ratioY].every(value => Number.isFinite(value) && value > 0)) return;
    const x = (event.clientX - rect.left) / ratioX - viewport.clientLeft;
    const y = (event.clientY - rect.top) / ratioY - viewport.clientTop;
    if (x < 0 || y < 0 || x >= viewport.clientWidth || y >= viewport.clientHeight) return;
    finishPan();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop, ratioX, ratioY };
    viewport.classList.add('is-panning');
    view.addEventListener('pointermove', movePan, { passive: false });
    view.addEventListener('pointerup', endPan);
    view.addEventListener('pointercancel', endPan);
    view.addEventListener('blur', finishPan);
    try { viewport.setPointerCapture(event.pointerId); } catch { /* Window listeners still follow the pointer. */ }
    event.preventDefault();
  };
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
    syncHandCursor();
  }
  function changeScale(value: number): void { if (!loaded) return; fit = false; scale = Math.min(5, Math.max(0.01, value)); layout(); }
  const wheel = (event: WheelEvent): void => {
    if (!loaded || !event.deltaY || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(viewport.clientHeight, 100) : 1;
    changeScale(scale * Math.exp(-Math.max(-360, Math.min(360, event.deltaY * unit)) / 2400));
  };
  viewport.addEventListener('wheel', wheel, { passive: false });
  viewport.addEventListener('pointerdown', startPan);
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (fit) layout(); else syncHandCursor(); }) : undefined;
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
  return () => { disposed = true; finishPan(); observer?.disconnect(); viewport.removeEventListener('pointerdown', startPan); viewport.removeEventListener('wheel', wheel); img.removeAttribute('src'); };
}
