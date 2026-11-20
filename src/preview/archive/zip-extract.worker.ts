import { readZipDirectory, readZipEntry } from './zip-directory.ts';

// Re-read only the central directory inside the worker. Identifying an entry
// by offset, CRC and size avoids relying on mutable or ambiguous file names.
self.onmessage = async (event: MessageEvent<{ url: string; size: number; localOffset: number; crc: number; entrySize: number; password?: string }>) => {
  const { url, size, localOffset, crc, entrySize, password } = event.data;
  let directory: Awaited<ReturnType<typeof readZipDirectory>> | undefined;
  try {
    directory = await readZipDirectory(url, size);
    const entry = directory.entries.find((item) => item.localOffset === localOffset && item.crc === crc && item.size === entrySize);
    if (!entry) throw new Error('压缩包内容已改变，请重新打开。');
    const blob = await readZipEntry(url, size, directory, entry, undefined, password);
    self.postMessage({ blob });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : '无法读取压缩包内文件。' });
  } finally {
    await directory?.reader.close().catch(() => undefined);
  }
};
