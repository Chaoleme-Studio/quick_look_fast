// A small sample is enough to avoid treating obvious binary data as text.
// This is a heuristic: arbitrary data cannot be classified perfectly.
export const FORCE_INSPECTION_EXTENSIONS: readonly string[] = ['bin', 'elf', 'exe', 'dll', 'class', 'macho'];

export function isProbablyText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true;
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return true;
  let control = 0;
  for (const byte of bytes) {
    if (byte === 0) return false;
    if ((byte < 32 && byte !== 9 && byte !== 10 && byte !== 12 && byte !== 13) || byte === 127) control += 1;
  }
  if (control / bytes.length > 0.01) return false;
  for (const encoding of ['utf-8', 'gb18030']) {
    try {
      new TextDecoder(encoding, { fatal: true }).decode(bytes, { stream: true });
      return true;
    } catch { /* Try the next encoding. */ }
  }
  return false;
}

export function formatHexSample(bytes: Uint8Array): string {
  return Array.from(bytes.subarray(0, 64), (byte) => byte.toString(16).padStart(2, '0').toUpperCase())
    .reduce<string[]>((rows, byte, index) => {
      if (index % 16 === 0) rows.push('');
      rows[rows.length - 1] += `${index % 16 ? ' ' : ''}${byte}`;
      return rows;
    }, []).join('\n');
}

export async function readHead(url: string, size: number, limit: number, signal?: AbortSignal): Promise<Uint8Array> {
  if (!size) return new Uint8Array();
  const last = Math.min(size, limit) - 1;
  const response = await fetch(url, { headers: { Range: `bytes=0-${last}` }, signal });
  if (response.status !== 206) throw new Error('无法读取文件片段');
  return new Uint8Array(await response.arrayBuffer());
}
