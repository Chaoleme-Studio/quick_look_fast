import { formatDimensions, readImageDimensions, type ImageDimensions } from './image-metadata.ts';

// Flyfish exposes decoded bitmap elements for raster images, including the
// first page of a TIFF. Use their intrinsic dimensions, even after zooming.
export function watchRenderedDimensions(mount: HTMLElement, report: (size: ImageDimensions) => void): () => void {
  const root = mount.shadowRoot;
  if (!root) return () => {};
  const update = () => {
    const image = root.querySelector<HTMLImageElement>('.image-frame img, .tiff-frame img');
    if (image?.naturalWidth && image.naturalHeight) report({ width: image.naturalWidth, height: image.naturalHeight });
  };
  root.addEventListener('load', update, true);
  update();
  return () => root.removeEventListener('load', update, true);
}

export function showNestedImageDimensions(
  target: HTMLElement, mount: HTMLElement,
  source: Parameters<typeof readImageDimensions>[0], signal: AbortSignal,
): () => void {
  const label = document.createElement('span');
  label.className = 'nested-image-size';
  const show = (size: ImageDimensions) => {
    if (signal.aborted || !target.contains(mount)) return;
    label.textContent = formatDimensions(size);
    if (!label.parentNode) target.append(label);
  };
  const stop = /\.svg$/i.test(source.name) ? () => {} : watchRenderedDimensions(mount, show);
  void readImageDimensions(source, signal).then(size => { if (size) show(size); }).catch(() => {});
  return () => { stop(); label.remove(); };
}
