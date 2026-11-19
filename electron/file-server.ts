import { createServer, type Server } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { fileResponse } from './protocol';

export interface ActiveFile {
  token: string;
  path: string;
  validate?: () => Promise<void>;
}

export interface FileProgress {
  token: string;
  phase: 'reading' | 'parsing' | 'range';
  loaded?: number;
  total?: number;
}

export async function startFileServer(
  getActiveFile: (token: string) => ActiveFile | undefined,
  onProgress?: (progress: FileProgress) => void,
): Promise<{ server: Server; origin: string }> {
  const server = createServer(async (request, response) => {
    const token = request.url?.split('?')[0].split('/')[2] || '';
    const file = getActiveFile(token);
    if (!request.url?.startsWith('/preview/') || !file || token !== file.token) {
      response.writeHead(404).end();
      return;
    }

    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Length, Content-Range');
    response.setHeader('Access-Control-Allow-Headers', 'Range');
    response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }

    const abort = new AbortController();
    response.on('close', () => abort.abort());
    try {
      await file.validate?.();
      const headers = new Headers();
      if (request.headers.range) headers.set('range', request.headers.range);
      const incoming = new Request('http://127.0.0.1/preview', {
        method: request.method || 'GET', headers, signal: abort.signal,
      });
      const result = await fileResponse(incoming, file.path);
      result.headers.forEach((value, name) => response.setHeader(name, value));
      response.writeHead(result.status);
      if (!result.body) {
        response.end();
        return;
      }
      const source = Readable.fromWeb(result.body as NodeReadableStream);
      // A range response represents only a small part of the file, so it cannot
      // be reported as a percentage of the complete document.
      if (onProgress && request.method === 'GET' && (result.status === 200 || result.status === 206)) {
        const ranged = result.status === 206;
        const total = Number(result.headers.get('Content-Length'));
        let loaded = 0;
        let lastUpdate = 0;
        if (ranged) onProgress({ token: file.token, phase: 'range' });
        else onProgress({ token: file.token, phase: 'reading', loaded: 0, total });
        if (!ranged) source.on('data', (chunk: Buffer) => {
          loaded += chunk.length;
          const now = Date.now();
          if (now - lastUpdate >= 100 && loaded < total) {
            lastUpdate = now;
            onProgress({ token: file.token, phase: 'reading', loaded, total });
          }
        });
        source.once('end', () => {
          if (!ranged) onProgress({ token: file.token, phase: 'parsing' });
        });
      }
      await pipeline(source, response);
    } catch {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法启动本地文件服务');
  return { server, origin: `http://127.0.0.1:${address.port}` };
}
