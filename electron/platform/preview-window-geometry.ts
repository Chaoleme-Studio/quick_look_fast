interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Place a new preview near the retained one without moving it off screen. */
export function nextPreviewWindowGeometry(workArea: Rectangle, previous: Rectangle): Rectangle & { minWidth: number; minHeight: number } {
  const width = Math.max(1, Math.min(Math.round(previous.width), workArea.width));
  const height = Math.max(1, Math.min(Math.round(previous.height), workArea.height));
  const offset = (position: number, min: number, max: number): number => {
    const clamp = (value: number): number => Math.min(Math.max(Math.round(value), min), max);
    const forward = clamp(position + 36);
    return Math.abs(forward - position) >= 18 ? forward : clamp(position - 36);
  };
  return {
    width, height,
    minWidth: Math.min(640, width), minHeight: Math.min(480, height),
    x: offset(previous.x, workArea.x, workArea.x + workArea.width - width),
    y: offset(previous.y, workArea.y, workArea.y + workArea.height - height),
  };
}
