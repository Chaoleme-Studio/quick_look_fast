export interface ImageDimensions {
  width: number;
  height: number;
  unit?: 'viewBox';
}

type ImageSource = { name: string; size: number } & ({ url: string } | { blob: Blob });
type ExifStatus = 'found' | 'missing' | 'limited' | 'unreadable' | 'unsupported';
type ExifField = [label: string, value: string | number | Date | undefined];

const maxExifBytes = 4 * 1024 * 1024;
const headerBytes = 32 * 1024;
const ascii = (bytes: Uint8Array) => String.fromCharCode(...bytes);

export function isImageFile(name: string): boolean {
  return /\.(?:png|apng|jpe?g|jfif|gif|webp|bmp|avif|svg|ico|tiff?|heic|heif|jxl|psd|psb|dng|cr2|nef|arw|orf|rw2|raf|cr3)$/i.test(name);
}

export function formatDimensions({ width, height, unit }: ImageDimensions): string {
  return `${width} × ${height} ${unit || 'px'}`;
}

function dimensions(width: unknown, height: unknown): ImageDimensions | undefined {
  if (typeof width === 'number' && typeof height === 'number' &&
      Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) return { width, height };
}

async function readBytes(source: ImageSource, start: number, length: number, signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted();
  if ('blob' in source) return new Uint8Array(await source.blob.slice(start, start + length).arrayBuffer());
  const end = start + length - 1;
  const response = await fetch(source.url, { headers: { Range: `bytes=${start}-${end}` }, signal });
  if (response.status !== 206 || Number(response.headers.get('Content-Length')) !== length) {
    await response.body?.cancel();
    throw new Error('无法读取图片片段');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== length) throw new Error('图片片段不完整');
  return bytes;
}

export async function readImageDimensions(source: ImageSource, signal: AbortSignal): Promise<ImageDimensions | undefined> {
  if (!source.size || !/\.(?:psd|psb|svg)$/i.test(source.name)) return;
  if (/\.svg$/i.test(source.name)) {
    const bytes = await readBytes(source, 0, Math.min(source.size, headerBytes), signal);
    const opening = /<svg(?:\s[^>]*?)?>/i.exec(new TextDecoder().decode(bytes))?.[0];
    if (!opening) return;
    const attributes = new Map(Array.from(opening.matchAll(/\s([\w:-]+)\s*=\s*(["'])(.*?)\2/gs), match => [match[1], match[3]]));
    const pixels = (value = '') => /^\s*\d+(?:\.\d+)?(?:px)?\s*$/.test(value) ? Number.parseFloat(value) : undefined;
    const explicit = dimensions(pixels(attributes.get('width')), pixels(attributes.get('height')));
    if (explicit) return explicit;
    const viewBox = attributes.get('viewBox')?.trim().split(/[\s,]+/).map(Number);
    const coordinateSize = viewBox?.length === 4 ? dimensions(viewBox[2], viewBox[3]) : undefined;
    if (coordinateSize) return { ...coordinateSize, unit: 'viewBox' };
    return;
  }
  if (source.size < 26) return;
  const bytes = await readBytes(source, 0, 26, signal);
  if (ascii(bytes.subarray(0, 4)) !== '8BPS') return;
  const view = new DataView(bytes.buffer);
  return dimensions(view.getUint32(18), view.getUint32(14));
}

interface ExifBlock {
  bytes?: Uint8Array;
  limited?: boolean;
}

// Walk container headers so PNG IDAT or WebP image payloads do not hide later EXIF blocks.
async function findExifChunk(source: ImageSource, head: Uint8Array, png: boolean, signal: AbortSignal): Promise<ExifBlock> {
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const end = png ? source.size : view.getUint32(4, true) + 8;
  if (end > source.size) throw new Error('图片容器不完整');
  let cursor = png ? 8 : 12;
  let windowStart = 0;
  let window = head;
  let reads = 0;
  for (let chunks = 0; cursor + 8 <= end && chunks < 8192; chunks += 1) {
    if (cursor + 8 > windowStart + window.length) {
      if (reads++ >= 64) return { limited: true };
      windowStart = cursor;
      window = await readBytes(source, cursor, Math.min(headerBytes, end - cursor), signal);
    }
    const offset = cursor - windowStart;
    const header = new DataView(window.buffer, window.byteOffset + offset, 8);
    const type = ascii(window.subarray(offset + (png ? 4 : 0), offset + (png ? 8 : 4)));
    const length = header.getUint32(png ? 0 : 4, !png);
    const next = cursor + 8 + length + (png ? 4 : length % 2);
    if (next > end) throw new Error('图片数据块不完整');
    if (png && type === 'IEND') return {};
    if (type === (png ? 'eXIf' : 'EXIF')) {
      if (length < 8) throw new Error('EXIF 数据块不完整');
      if (length > maxExifBytes) return { limited: true };
      const data = offset + 8 + length <= window.length
        ? window.subarray(offset + 8, offset + 8 + length)
        : await readBytes(source, cursor + 8, length, signal);
      const bytes = ascii(data.subarray(0, 6)) === 'Exif\0\0' ? data.subarray(6) : data;
      return { bytes };
    }
    cursor = next;
  }
  return { limited: cursor < end };
}

export async function readPhotoExif(source: ImageSource, signal: AbortSignal): Promise<{ status: ExifStatus; fields: ExifField[]; dimensions?: ImageDimensions }> {
  if (!source.size) return { status: 'unreadable', fields: [] };
  if (/\.(?:svg|gif|bmp|ico|jxl|psd|psb|orf|rw2|raf|cr3)$/i.test(source.name)) return { status: 'unsupported', fields: [] };
  try {
    const head = await readBytes(source, 0, Math.min(source.size, headerBytes), signal);
    const png = head.length >= 8 && ascii(head.subarray(0, 8)) === '\x89PNG\r\n\x1a\n';
    const webp = head.length >= 12 && ascii(head.subarray(0, 4)) === 'RIFF' && ascii(head.subarray(8, 12)) === 'WEBP';
    const jpeg = head[0] === 0xff && head[1] === 0xd8;
    const tiff = /^(?:II\x2a\0|MM\0\x2a)$/.test(ascii(head.subarray(0, 4)));
    const heif = /\.(?:heic|heif|avif)$/i.test(source.name) && ascii(head.subarray(4, 8)) === 'ftyp';
    if (!png && !webp && !jpeg && !tiff && !heif) return { status: 'unreadable', fields: [] };
    let block: ExifBlock;
    if (png || webp) block = await findExifChunk(source, head, png, signal);
    else {
      const length = Math.min(source.size, maxExifBytes);
      block = { bytes: length <= head.length ? head : await readBytes(source, 0, length, signal), limited: length < source.size };
    }
    if (!block.bytes) return { status: block.limited ? 'limited' : 'missing', fields: [] };
    signal.throwIfAborted();
    const exifr = await import('exifr');
    const tags = await (exifr.parse || exifr.default.parse)(block.bytes, {
      gps: false, ifd1: false, ihdr: false, xmp: false, icc: false, iptc: false,
      pick: ['Make', 'Model', 'LensModel', 'LensMake', 'DateTimeOriginal', 'CreateDate', 'ISO', 'ISOSpeed',
        'FNumber', 'ExposureTime', 'FocalLength', 'FocalLengthIn35mmFormat', 'ExposureCompensation',
        'WhiteBalance', 'Orientation', 'ExifImageWidth', 'ExifImageHeight', 'ImageWidth', 'ImageHeight'],
    });
    const pair = (first: unknown, second: unknown) => {
      const make = typeof first === 'string' ? first.trim() : '';
      const model = typeof second === 'string' ? second.trim() : '';
      return model.toLowerCase().startsWith(make.toLowerCase()) ? model : [make, model].filter(Boolean).join(' ');
    };
    const fields: ExifField[] = tags ? [
      ['相机', pair(tags.Make, tags.Model)], ['镜头', pair(tags.LensMake, tags.LensModel)],
      ['拍摄时间', tags.DateTimeOriginal ?? tags.CreateDate], ['感光度', tags.ISO ?? tags.ISOSpeed],
      ['光圈', tags.FNumber ? `f/${tags.FNumber}` : undefined],
      ['曝光时间', tags.ExposureTime > 0 ? `${tags.ExposureTime < 1 ? `1/${Math.round(1 / tags.ExposureTime)}` : tags.ExposureTime} 秒` : undefined],
      ['焦距', tags.FocalLength ? `${tags.FocalLength} mm` : undefined],
      ['等效焦距', tags.FocalLengthIn35mmFormat ? `${tags.FocalLengthIn35mmFormat} mm` : undefined],
      ['曝光补偿', typeof tags.ExposureCompensation === 'number' ? `${tags.ExposureCompensation} EV` : undefined],
      ['白平衡', tags.WhiteBalance], ['方向', tags.Orientation],
    ] : [];
    const size = dimensions(tags?.ExifImageWidth, tags?.ExifImageHeight) || dimensions(tags?.ImageWidth, tags?.ImageHeight);
    const visible = fields.filter(([, value]) => value !== undefined && value !== null && value !== '');
    return { status: visible.length || size ? 'found' : block.limited ? 'limited' : 'missing', fields: visible, dimensions: size };
  } catch {
    signal.throwIfAborted();
    return { status: 'unreadable', fields: [] };
  }
}
