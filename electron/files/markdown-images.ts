import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|bmp|avif)$/i;

/** Resolve only raster images inside the Markdown document's own directory. */
export async function resolveMarkdownImage(documentPath: string, reference: unknown): Promise<string | undefined> {
  if (typeof reference !== 'string' || !reference || reference.length > 2048) return;
  const input = reference.trim().split(/[?#]/, 1)[0];
  let decoded: string;
  try { decoded = decodeURIComponent(input); } catch { return; }
  if (!decoded || /[\x00-\x1f\x7f\\:]/.test(decoded) || decoded.startsWith('/') ||
      decoded.split('/').includes('..') || !IMAGE_EXTENSION.test(decoded)) return;
  try {
    const directory = await realpath(path.dirname(documentPath));
    const candidate = await realpath(path.resolve(directory, decoded));
    const relative = path.relative(directory, candidate);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return;
    const info = await stat(candidate);
    if (!info.isFile() || info.size > MAX_IMAGE_BYTES) return;
    return candidate;
  } catch { return; }
}
