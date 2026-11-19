import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, unlink, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader, TextReader } from '@zip.js/zip.js';
import { readZipDirectory, readZipEntry } from '../src/zip-directory.ts';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { startFileServer } = require('../dist-electron/file-server.js');

function patchUtf8Flags(zip) {
  const bytes = Buffer.from(zip);
  const end = bytes.length - 22;
  let offset = bytes.readUInt32LE(end + 16);
  const count = bytes.readUInt16LE(end + 10);
  for (let i = 0; i < count; i += 1) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    bytes.writeUInt16LE(bytes.readUInt16LE(offset + 8) & ~0x800, offset + 8);
    const local = bytes.readUInt32LE(offset + 42);
    bytes.writeUInt16LE(bytes.readUInt16LE(local + 6) & ~0x800, local + 6);
    offset += 46 + bytes.readUInt16LE(offset + 28) + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  return bytes;
}

function zip64End(zip) {
  const end = zip.length - 22;
  const old = Buffer.from(zip.subarray(end));
  const count = old.readUInt16LE(10), size = old.readUInt32LE(12), offset = old.readUInt32LE(16);
  const record = Buffer.alloc(56);
  record.writeUInt32LE(0x06064b50, 0); record.writeBigUInt64LE(44n, 4);
  record.writeUInt16LE(45, 12); record.writeUInt16LE(45, 14);
  record.writeBigUInt64LE(BigInt(count), 24); record.writeBigUInt64LE(BigInt(count), 32);
  record.writeBigUInt64LE(BigInt(size), 40); record.writeBigUInt64LE(BigInt(offset), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0); locator.writeBigUInt64LE(BigInt(end), 8); locator.writeUInt32LE(1, 16);
  old.writeUInt16LE(0xffff, 8); old.writeUInt16LE(0xffff, 10); old.writeUInt32LE(0xffffffff, 12); old.writeUInt32LE(0xffffffff, 16);
  return Buffer.concat([zip.subarray(0, end), record, locator, old]);
}

test('ZIP directories use bounded ranges, decode names, extract and verify selected entries', async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), 'slowlook-zip-'));
  const filename = path.join(tmp, 'fixture.zip');
  const zip = new JSZip();
  zip.file('中文/说明.txt', 'hello 中文');
  zip.file('large.bin', Buffer.alloc(1024 * 1024, 7), { compression: 'STORE' });
  const data = patchUtf8Flags(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', streamFiles: true }));
  await writeFile(filename, data);
  let active = { token: 'zip', path: filename };
  const { server, origin } = await startFileServer((token) => active?.token === token ? active : undefined);
  const url = `${origin}/preview/zip/fixture.zip`;
  const originalFetch = globalThis.fetch;
  let transferred = 0;
  globalThis.fetch = async (...args) => {
    const response = await originalFetch(...args);
    transferred += Number(response.headers.get('content-length') || 0);
    return response;
  };
  try {
    const result = await readZipDirectory(url, data.length);
    assert.ok(result.entries.some((item) => item.name === '中文/说明.txt'), 'UTF-8 filenames remain readable with bit 11 unset');
    assert.ok(transferred < 100000, 'reading the directory must not read the whole archive');
    const entry = result.entries.find((item) => item.name.endsWith('说明.txt'));
    assert.equal(await (await readZipEntry(url, data.length, result, entry)).text(), 'hello 中文');
    await assert.rejects(() => readZipEntry(url, data.length, result, { ...entry, flags: entry.flags | 1 }), /加密/);
    await assert.rejects(() => readZipEntry(url, data.length, result, { ...entry, size: 65 * 1024 * 1024 }), /64 MiB/);
    await assert.rejects(() => readZipEntry(url, data.length, result, { ...entry, crc: 0 }), /校验/);

    const z64 = zip64End(data);
    await writeFile(filename, z64);
    assert.equal((await readZipDirectory(url, z64.length)).entries.length, result.entries.length, 'ZIP64 end records are supported');

    const single = new JSZip(); single.file('abcd.txt', 'gbk');
    const gbkZip = await single.generateAsync({ type: 'nodebuffer' });
    const central = gbkZip.readUInt32LE(gbkZip.length - 6);
    Buffer.from('d6d0cec42e747874', 'hex').copy(gbkZip, 30);
    Buffer.from('d6d0cec42e747874', 'hex').copy(gbkZip, central + 46);
    await writeFile(filename, gbkZip);
    const gbk = await readZipDirectory(url, gbkZip.length);
    assert.equal(gbk.entries[0].name, '中文.txt', 'unflagged GBK filenames are decoded');
    assert.equal(await (await readZipEntry(url, gbkZip.length, gbk, gbk.entries[0])).text(), 'gbk');

    await writeFile(filename, Buffer.alloc(40));
    await assert.rejects(() => readZipDirectory(url, 40), /中央目录/);
    active = undefined;
    await assert.rejects(() => readZipDirectory(url, 40), /按需读取/);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
    await unlink(filename);
    await rmdir(tmp);
  }
});

test('encrypted ZIP entries support ZipCrypto and AES with password validation', async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), 'slowlook-encrypted-zip-'));
  const filename = path.join(tmp, 'protected.zip');
  const { server, origin } = await startFileServer(() => ({ token: 'protected', path: filename }));
  const url = `${origin}/preview/protected/protected.zip`;
  try {
    for (const zipCrypto of [true, false]) {
      const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
      await writer.add('large.bin', new Uint8ArrayReader(new Uint8Array(1024 * 1024)), { level: 0 });
      await writer.add('资料/秘密.txt', new TextReader('secret 中文'), { password: 'test123', zipCrypto });
      const data = await writer.close(); await writeFile(filename, data);
      let transferred = 0; const original = globalThis.fetch;
      globalThis.fetch = async (...args) => { const response = await original(...args); transferred += Number(response.headers.get('content-length') || 0); return response; };
      try {
        const directory = await readZipDirectory(url, data.length);
        assert.ok(transferred < 100000, 'opening an encrypted archive reads only its directory');
        const entry = directory.entries.find((item) => item.name.endsWith('秘密.txt'));
        assert.ok(entry && (entry.flags & 1));
        await assert.rejects(() => readZipEntry(url, data.length, directory, entry, undefined, 'wrong'), /密码/);
        assert.equal(await (await readZipEntry(url, data.length, directory, entry, undefined, 'test123')).text(), 'secret 中文');
        await directory.reader.close();
      } finally { globalThis.fetch = original; }
    }
  } finally { await new Promise((resolve) => server.close(resolve)); await unlink(filename); await rmdir(tmp); }
});
