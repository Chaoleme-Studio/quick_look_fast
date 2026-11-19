import type { Reader, ZipReader, Entry, FileEntry } from '@zip.js/zip.js';

/** ZIP parsing and decryption are supplied by zip.js; the source remains range-based. */
export interface ZipEntry {
  name: string;
  directory: boolean;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
  /** The library entry is kept in memory only while this preview is open. */
  source?: Entry;
}

interface RangeSource { setOperation(signal?: AbortSignal): void; clearOperation(signal?: AbortSignal): void }
export interface ZipDirectory { entries: ZipEntry[]; reader: ZipReader<unknown>; source: RangeSource }
export type ZipNameEncoding = 'auto' | 'utf-8' | 'gb18030' | 'cp437';

const MAX_DIRECTORY_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 20000;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const CP437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

function decodeName(bytes: Uint8Array, encoding: ZipNameEncoding): string {
  const cp437 = (): string => Array.from(bytes, (value) => value < 128 ? String.fromCharCode(value) : CP437[value - 128]).join('');
  if (encoding === 'cp437') return cp437();
  if (encoding !== 'auto') return new TextDecoder(encoding).decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { /* Try legacy Chinese names. */ }
  try {
    const gb = new TextDecoder('gb18030', { fatal: true }).decode(bytes);
    if (/[\u3400-\u9fff\uf900-\ufaff]/.test(gb)) return gb;
  } catch { /* Fall through to the ZIP default. */ }
  return cp437();
}

function createRangeReader(Base: typeof import('@zip.js/zip.js').Reader, url: string, size: number, lifetime?: AbortSignal): Reader<string> & RangeSource {
class RangeReader extends Base<string> {
  private operation?: AbortSignal;
  private readonly url: string;
  private readonly lifetime?: AbortSignal;
  constructor(url: string, size: number, lifetime?: AbortSignal) {
    super(url); this.size = size; this.url = url; this.lifetime = lifetime;
  }
  setOperation(signal?: AbortSignal): void { this.operation = signal; }
  clearOperation(signal?: AbortSignal): void { if (this.operation === signal) this.operation = undefined; }
  async readUint8Array(start: number, length: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0 || start + length > this.size) {
      throw new Error('ZIP 中的偏移或长度无效。');
    }
    if (length > MAX_DIRECTORY_BYTES) throw new Error('ZIP 目录或单次读取超过 16 MiB 上限。');
    if (!length) return new Uint8Array();
    const signals = [this.lifetime, this.operation].filter((s): s is AbortSignal => Boolean(s));
    const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
    const response = await fetch(this.url, { headers: { Range: `bytes=${start}-${start + length - 1}` }, signal });
    if (response.status !== 206 || response.headers.get('Content-Range') !== `bytes ${start}-${start + length - 1}/${this.size}`) {
      throw new Error('无法按需读取 ZIP，请检查文件是否发生变化。');
    }
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.length !== length) throw new Error('ZIP 数据不完整。');
    return data;
  }
}
  return new RangeReader(url, size, lifetime);
}

export async function readZipDirectory(url: string, size: number, signal?: AbortSignal, encoding: ZipNameEncoding = 'auto'): Promise<ZipDirectory> {
  if (!Number.isSafeInteger(size) || size < 22) throw new Error('ZIP 文件不完整。');
  const { Reader, ZipReader } = await import('@zip.js/zip.js');
  const source = createRangeReader(Reader, url, size, signal);
  const reader = new ZipReader(source, {
    useWebWorkers: false,
    decodeText: (bytes, _encoding, type) => type === 'filename' ? decodeName(bytes, encoding) : undefined,
  });
  try {
    const entries: ZipEntry[] = [];
    for await (const item of reader.getEntriesGenerator()) {
      if (entries.length >= MAX_ENTRIES) throw new Error('压缩包目录过大（最多 20000 项）。');
      const name = item.filename.replace(/\\/g, '/');
      if (name && !name.includes('\0')) entries.push({
        name, directory: item.directory, flags: item.encrypted ? 1 : 0,
        method: item.compressionMethod, crc: item.crc32 ?? 0,
        compressedSize: item.compressedSize, size: item.uncompressedSize,
        localOffset: item.offset, source: item,
      });
    }
    return { entries, reader, source };
  } catch (error) {
    await reader.close().catch(() => undefined);
    if (error instanceof Error && /end of central directory|central directory/i.test(error.message)) {
      throw new Error('找不到或无法读取 ZIP 中央目录。');
    }
    throw error;
  }
}

/** Decrypt and decompress just one selected entry; never materialize the entire ZIP. */
export async function readZipEntry(_url: string, _archiveSize: number, directory: ZipDirectory, entry: ZipEntry, signal?: AbortSignal, password?: string): Promise<Blob> {
  if (entry.directory) throw new Error('请选择压缩包内的文件。');
  if (entry.size > MAX_ENTRY_BYTES || entry.compressedSize > MAX_ENTRY_BYTES) throw new Error('包内文件超过 64 MiB 预览上限。');
  if ((entry.flags & 1) && !password) throw new Error('此文件已加密，请输入密码。');
  const raw = entry.source as FileEntry | undefined;
  if (!raw || !directory.entries.some((item) => item.source === raw) || !raw.getData) throw new Error('ZIP 条目已经失效。');
  if (entry.crc !== (raw.crc32 ?? 0)) throw new Error('压缩包内文件校验信息不一致。');
  const chunks: BlobPart[] = [];
  let length = 0;
  const output = new WritableStream<Uint8Array>({
    write(chunk) {
      length += chunk.length;
      if (length > MAX_ENTRY_BYTES || length > entry.size) throw new Error('解压结果超过预览上限或声明大小。');
      chunks.push(new Uint8Array(chunk));
    },
  });
  directory.source.setOperation(signal);
  try {
    await raw.getData(output, { password, signal, checkSignature: true, useWebWorkers: false });
    if (length !== entry.size) throw new Error('压缩包内文件大小不一致。');
    return new Blob(chunks);
  } catch (error) {
    if (error instanceof Error && /invalid password|password required/i.test(error.message)) throw new Error('密码不正确，请重试。');
    if (error instanceof Error && /signature|crc|authentication/i.test(error.message)) throw new Error('压缩包内文件校验失败或密码不正确。');
    throw error;
  } finally { directory.source.clearOperation(signal); }
}
