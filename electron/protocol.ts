import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { lookup } from 'mime-types';

/** A single byte range, inclusive on both ends. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;

  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= size || requestedEnd < start) {
    return null;
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}

/** Serves local bytes without copying the entire file into the main process. */
export async function fileResponse(request: Request, filePath: string): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  try {
    const file = await stat(filePath);
    if (!file.isFile()) return new Response('File not found', { status: 404 });

    const rangeHeader = request.headers.get('range');
    const range = parseRange(rangeHeader, file.size);
    const common = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'Content-Type': lookup(filePath) || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    };
    if (rangeHeader && !range) {
      return new Response(null, {
        status: 416,
        headers: { ...common, 'Content-Range': `bytes */${file.size}` },
      });
    }

    const start = range?.start ?? 0;
    const end = range?.end ?? Math.max(0, file.size - 1);
    const length = range ? end - start + 1 : file.size;
    const headers: Record<string, string> = { ...common, 'Content-Length': String(length) };
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${file.size}`;

    const body = request.method === 'HEAD' || length === 0
      ? null
      : Readable.toWeb(createReadStream(filePath, { start, end, signal: request.signal })) as ReadableStream;
    return new Response(body, { status: range ? 206 : 200, headers });
  } catch {
    return new Response('Cannot read file', { status: 404 });
  }
}
