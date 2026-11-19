interface ZoomController {
  getZoomState(): { scale: number; minScale?: number; maxScale?: number } | null;
  applyViewState(state: { scale: number }, options: { source: 'user'; action: 'zoom-change' }): Promise<unknown>;
}

/** Mouse wheel zooms only Flyfish image surfaces, not documents or controls. */
export function installImageWheelZoom(host: HTMLElement, getController: () => ZoomController | undefined): () => void {
  let queued = 0;
  let active: ZoomController | undefined;
  let running = false;
  let disposed = false;
  const flush = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      while (!disposed && queued && active && active === getController()) {
        const controller = active;
        const delta = queued;
        queued = 0;
        const zoom = controller.getZoomState();
        if (!zoom || !Number.isFinite(zoom.scale)) break;
        // A conventional 120-pixel wheel notch changes the scale by ~5%,
        // instead of the viewer's 15 percentage point zoomIn/zoomOut step.
        const scale = Math.min(zoom.maxScale ?? 5, Math.max(zoom.minScale ?? 0.05, zoom.scale * Math.exp(-delta / 2400)));
        await controller.applyViewState({ scale }, { source: 'user', action: 'zoom-change' });
      }
    } catch { queued = 0; /* A viewer may have been replaced while zooming. */ }
    finally { running = false; }
  };
  const wheel = (event: WheelEvent): void => {
    if (event.defaultPrevented || !event.deltaY || event.ctrlKey || event.altKey || event.metaKey) return;
    const insideImage = event.composedPath().some((item) => item instanceof HTMLElement && item.classList.contains('image-viewer'));
    const controller = getController();
    if (!insideImage || !controller?.getZoomState()) return;
    event.preventDefault();
    if (controller !== active) { active = controller; queued = 0; }
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(host.clientHeight, 100) : 1;
    queued += Math.max(-360, Math.min(360, event.deltaY * unit));
    void flush();
  };
  host.addEventListener('wheel', wheel, { passive: false });
  return () => { disposed = true; queued = 0; host.removeEventListener('wheel', wheel); };
}
