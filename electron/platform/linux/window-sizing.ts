/**
 * Window dimensions are in Electron's device-independent pixels, as is the
 * display's work area. Keep the initial preview inside that area so its native
 * resize border and shadow are reachable on small or scaled displays.
 */
export interface WindowRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PreviewWindowGeometry {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  x?: number;
  y?: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

export function linuxPreviewWindowGeometry(
  workArea: WindowRectangle,
  previous?: WindowRectangle,
  canPosition = true,
): PreviewWindowGeometry {
  // A work area should always be positive; guard transient display changes so
  // no invalid sizes are passed to BrowserWindow.
  const areaWidth = Number.isFinite(workArea.width) && workArea.width > 0 ? Math.floor(workArea.width) : 1080;
  const areaHeight = Number.isFinite(workArea.height) && workArea.height > 0 ? Math.floor(workArea.height) : 760;
  const marginX = Math.min(32, Math.floor(areaWidth * 0.05));
  const marginY = Math.min(32, Math.floor(areaHeight * 0.05));
  const maxWidth = Math.max(1, areaWidth - 2 * marginX);
  const maxHeight = Math.max(1, areaHeight - 2 * marginY);
  const defaultWidth = Math.max(1, Math.min(1080, Math.floor(areaWidth * 0.82), maxWidth));
  const defaultHeight = Math.max(1, Math.min(760, Math.floor(areaHeight * 0.82), maxHeight));
  // On small displays the calculated default can itself be below the normal
  // minimum. Keep headroom to shrink it further instead of making that
  // default the minimum size; larger displays retain the usual 640×480 limit.
  const minWidth = Math.max(1, Math.min(640, Math.floor(defaultWidth * 0.75)));
  const minHeight = Math.max(1, Math.min(480, Math.floor(defaultHeight * 0.75)));
  const geometry: PreviewWindowGeometry = {
    width: previous && Number.isFinite(previous.width) ? clamp(Math.round(previous.width), minWidth, maxWidth) : defaultWidth,
    height: previous && Number.isFinite(previous.height) ? clamp(Math.round(previous.height), minHeight, maxHeight) : defaultHeight,
    minWidth,
    minHeight,
  };

  // Positioning is unavailable on Wayland. On X11 a pinned preview's new
  // window can be offset, but must remain within the same display's work area.
  if (canPosition && previous && Number.isFinite(previous.x) && Number.isFinite(previous.y)) {
    const originX = Number.isFinite(workArea.x) ? Math.round(workArea.x) : 0;
    const originY = Number.isFinite(workArea.y) ? Math.round(workArea.y) : 0;
    geometry.x = clamp(Math.round(previous.x) + 36, originX + marginX, originX + areaWidth - marginX - geometry.width);
    geometry.y = clamp(Math.round(previous.y) + 36, originY + marginY, originY + areaHeight - marginY - geometry.height);
  }
  return geometry;
}
