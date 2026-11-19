import { readZipEntry, type ZipDirectory, type ZipEntry } from './zip-directory.ts';

/** Decompression runs away from Chromium's scroll and input thread. */
export async function extractZipEntry(url: string, size: number, directory: ZipDirectory, entry: ZipEntry, signal?: AbortSignal, password?: string): Promise<Blob> {
  if (signal?.aborted) throw new DOMException('操作已取消', 'AbortError');
  let worker: Worker;
  try {
    if (typeof Worker !== 'function') throw new Error('Workers unavailable');
    worker = new Worker(new URL('./zip-extract.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    // Useful for environments without Workers, including non-graphical tests.
    return readZipEntry(url, size, directory, entry, signal, password);
  }
  return new Promise<Blob>((resolve, reject) => {
    let finished = false;
    const done = (error?: Error, blob?: Blob): void => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(error); else resolve(blob!);
    };
    const abort = (): void => done(new DOMException('操作已取消', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ blob?: Blob; error?: string }>) => {
      if (event.data.blob instanceof Blob) done(undefined, event.data.blob);
      else done(new Error(event.data.error || '无法读取压缩包内文件。'));
    };
    worker.onerror = () => done(new Error('压缩包解压进程启动失败。'));
    worker.postMessage({ url, size, localOffset: entry.localOffset, crc: entry.crc, entrySize: entry.size, password });
    if (signal?.aborted) abort();
  });
}
