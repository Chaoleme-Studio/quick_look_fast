import { parentPort, workerData } from 'node:worker_threads';
import { readFile, stat } from 'node:fs/promises';
import { createExtractorFromFile } from 'node-unrar-js';
import * as officeCrypto from 'officecrypto-tool';

type Task = { kind: 'rar-list' | 'rar-entry' | 'office' | 'office-data'; file: string; password?: string; headerPassword?: string; index?: number; data?: ArrayBuffer };
const task = workerData as Task;
const MAX_FILE = 64 * 1024 * 1024;
const MAX_ENTRIES = 20000;

interface RarAdapter {
  unrar: { HEAPU8: Uint8Array };
  open(name: string): number;
  create(name: string): number;
  closeFile(fd: number): void;
  read(fd: number, offset: number, length: number): number;
  write(fd: number, offset: number, length: number): boolean;
}

async function readRar(): Promise<unknown> {
  // The official UnRAR WASM wrapper normally writes extracted files to disk.
  // Replace only its output callbacks: input remains seekable file IO, output
  // is one bounded in-memory entry, and no archive path is ever written.
  const extractor = await createExtractorFromFile({ filepath: task.file, password: task.headerPassword || task.password || '' });
  const adapter = extractor as unknown as RarAdapter;
  const openFile = adapter.open.bind(adapter);
  const readFileBytes = adapter.read.bind(adapter);
  let bytesRead = 0;
  // The decoder may ask for other files for volumes or references. It is only
  // authorized to read the file currently selected in this preview.
  adapter.open = (name) => name === task.file ? openFile(name) : 0;
  adapter.read = (fd, offset, length) => { const read = readFileBytes(fd, offset, length); bytesRead += Math.max(0, read); return read; };
  const listing = extractor.getFileList();
  if (listing.arcHeader.flags.volume) throw new Error('暂不支持分卷 RAR。');
  const entries = [];
  for (const item of listing.fileHeaders) {
    if (entries.length >= MAX_ENTRIES) throw new Error('压缩包目录过大（最多 20000 项）。');
    entries.push({ name: item.name.replace(/\\/g, '/'), directory: item.flags.directory, encrypted: item.flags.encrypted,
      size: item.unpSize, compressedSize: item.packSize });
  }
  if (task.kind === 'rar-list') return { entries, headerEncrypted: listing.arcHeader.flags.headerEncrypted, solid: listing.arcHeader.flags.solid, bytesRead };
  const index = task.index;
  if (!Number.isSafeInteger(index) || index === undefined || index < 0 || index >= entries.length) throw new Error('压缩包条目已失效。');
  const selected = entries[index];
  if (selected.directory) throw new Error('请选择压缩包内的文件。');
  if (!Number.isSafeInteger(selected.size) || selected.size < 0 || selected.size > MAX_FILE || selected.compressedSize > MAX_FILE) {
    throw new Error('包内文件超过 64 MiB 预览上限。');
  }
  if (selected.encrypted && !task.password && !task.headerPassword) throw Object.assign(new Error('请输入密码。'), { reason: 'ERAR_MISSING_PASSWORD' });
  const closeFile = adapter.closeFile.bind(adapter);
  const outputFd = 0x3fffffff;
  const chunks: Uint8Array[] = [];
  let written = 0;
  adapter.create = () => outputFd;
  adapter.closeFile = (fd) => { if (fd !== outputFd) closeFile(fd); };
  adapter.write = (fd, offset, length) => {
    if (fd !== outputFd || length < 0 || written + length > MAX_FILE || written + length > selected.size) return false;
    chunks.push(adapter.unrar.HEAPU8.slice(offset, offset + length)); written += length;
    return true;
  };
  let seen = -1;
  const files = extractor.extract({ files: () => ++seen === index, password: task.password || task.headerPassword });
  let extracted = 0;
  for (const _file of files.files) extracted += 1;
  if (extracted !== 1 || written !== selected.size) throw new Error('包内文件内容不完整。');
  const result = new Uint8Array(written);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return { bytes: result.buffer, bytesRead };
}

async function decryptOffice(): Promise<unknown> {
  let source: Buffer;
  if (task.kind === 'office-data') {
    if (!(task.data instanceof ArrayBuffer) || task.data.byteLength > MAX_FILE) throw new Error('加密 Office 文件超过 64 MiB 预览上限。');
    source = Buffer.from(task.data);
  } else {
    const info = await stat(task.file);
    if (!info.isFile() || info.size > MAX_FILE) throw new Error('加密 Office 文件超过 64 MiB 预览上限。');
    source = await readFile(task.file);
  }
  if (!officeCrypto.isEncrypted(source)) throw new Error('文件不是受支持的加密 Office 文档。');
  const output = await officeCrypto.decrypt(source, { password: task.password || '' });
  if (output.byteLength > MAX_FILE) throw new Error('解密后的文档超过 64 MiB 预览上限。');
  return { bytes: Uint8Array.from(output).buffer };
}

void (async () => {
  try {
    const result = task.kind === 'office' || task.kind === 'office-data' ? await decryptOffice() : await readRar();
    const bytes = (result as { bytes?: ArrayBuffer }).bytes;
    parentPort?.postMessage({ ok: true, ...result as object }, bytes ? [bytes] : []);
  } catch (error) {
    const reason = error && typeof error === 'object' && 'reason' in error ? String(error.reason) : '';
    const message = error instanceof Error ? error.message : '无法读取加密内容。';
    const passwordError = /ERAR_(?:MISSING|BAD)_PASSWORD/.test(reason) ||
      (reason === 'ERAR_BAD_DATA' && Boolean(task.password || task.headerPassword)) || /incorrect password|password is incorrect/i.test(message);
    parentPort?.postMessage({ ok: false, code: passwordError ? 'password' : 'failed',
      message: passwordError ? '密码不正确或需要密码，请重试。' : message });
  }
})();
