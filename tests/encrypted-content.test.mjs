import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { readFile, writeFile, mkdtemp, unlink, rmdir, open } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import officeCrypto from 'officecrypto-tool';

const worker = new URL('../build/dist-electron/files/content-worker.js', import.meta.url);
const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
function run(task, workerFile = worker) {
  return new Promise((resolve, reject) => {
    const w = new Worker(workerFile, { workerData: task });
    w.once('message', (result) => { void w.terminate(); resolve(result); });
    w.once('error', reject);
  });
}

test('RAR lists headers and decrypts only the requested entry, including encrypted names', async () => {
  const file = fixture('FileEncByName.rar');
  const list = await run({ kind: 'rar-list', file });
  assert.equal(list.ok, true);
  const index = list.entries.findIndex((entry) => entry.name === '2中文.txt');
  assert.ok(index >= 0 && list.entries[index].encrypted);
  assert.equal((await run({ kind: 'rar-entry', file, index })).code, 'password');
  assert.equal((await run({ kind: 'rar-entry', file, index, password: 'wrong' })).code, 'password');
  const content = await run({ kind: 'rar-entry', file, index, password: '2中文' });
  assert.equal(content.ok, true);
  assert.match(new TextDecoder().decode(content.bytes), /中文中文/);
  const headerFile = fixture('HeaderEnc1234.rar');
  assert.equal((await run({ kind: 'rar-list', file: headerFile })).code, 'password');
  assert.equal((await run({ kind: 'rar-list', file: headerFile, headerPassword: 'wrong' })).code, 'password');
  const header = await run({ kind: 'rar-list', file: headerFile, headerPassword: '1234' });
  assert.equal(header.ok, true);
  assert.equal(header.headerEncrypted, true);
  const first = await run({ kind: 'rar-entry', file: headerFile, headerPassword: '1234', index: 0 });
  assert.equal(first.ok, true);
  assert.ok(first.bytes.byteLength > 0);
});

test('encrypted DOCX, XLSX and PPTX decrypt locally and reject a wrong password', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slowlook-office-'));
  const files = [];
  try {
    for (const [extension, type] of [['xlsx', undefined], ['docx', undefined], ['pptx', 'standard']]) {
      const original = await readFile(fixture(`office-sample.${extension}`));
      const encrypted = officeCrypto.encrypt(original, { password: 'test123', ...(type ? { type } : {}) });
      const filename = path.join(dir, `encrypted.${extension}`); files.push(filename);
      await writeFile(filename, encrypted);
      assert.equal((await run({ kind: 'office', file: filename, password: 'wrong' })).code, 'password');
      const output = await run({ kind: 'office', file: filename, password: 'test123' });
      assert.equal(output.ok, true);
      assert.deepEqual(Buffer.from(output.bytes), original);
      const nested = await run({ kind: 'office-data', file: 'unused', data: Uint8Array.from(encrypted).buffer, password: 'test123' });
      assert.equal(nested.ok, true);
      assert.deepEqual(Buffer.from(nested.bytes), original);
    }
  } finally { for (const file of files) await unlink(file); await rmdir(dir); }
});

const packagedWorker = process.env.SLOWLOOK_PORTABLE_DIST
  ? path.resolve(process.env.SLOWLOOK_PORTABLE_DIST, '../dist-electron/files/content-worker.js')
  : undefined;
test('packaged worker includes its WASM and Office dependencies', { skip: !packagedWorker }, async () => {
  assert.ok(existsSync(packagedWorker), 'configured portable worker is missing');
  const rar = await run({ kind: 'rar-list', file: fixture('HeaderEnc1234.rar'), headerPassword: '1234' }, packagedWorker);
  assert.equal(rar.ok, true); assert.equal(rar.headerEncrypted, true);
  const plain = await readFile(fixture('office-sample.xlsx'));
  const encrypted = officeCrypto.encrypt(plain, { password: 'test123' });
  const result = await run({ kind: 'office-data', file: 'unused', data: Uint8Array.from(encrypted).buffer, password: 'test123' }, packagedWorker);
  assert.equal(result.ok, true); assert.deepEqual(Buffer.from(result.bytes), plain);
});

test('RAR directory listing does not read a padded archive into memory', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slowlook-rar-range-'));
  const file = path.join(dir, 'padded.rar');
  try {
    const handle = await open(file, 'w');
    try { await handle.writeFile(await readFile(fixture('FileEncByName.rar'))); await handle.truncate(32 * 1024 * 1024); }
    finally { await handle.close(); }
    const result = await run({ kind: 'rar-list', file });
    assert.equal(result.ok, true);
    assert.ok(result.entries.length > 0);
    assert.ok(result.bytesRead > 0 && result.bytesRead < 1024 * 1024, `listing read ${result.bytesRead} bytes`);
  } finally { await unlink(file); await rmdir(dir); }
});

test('large encrypted Office inputs are refused before the file is read', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'slowlook-office-limit-'));
  const file = path.join(dir, 'large.xlsx');
  try {
    const handle = await open(file, 'w');
    try { await handle.truncate(64 * 1024 * 1024 + 1); } finally { await handle.close(); }
    const result = await run({ kind: 'office', file, password: 'test' });
    assert.equal(result.ok, false); assert.match(result.message, /64 MiB/);
  } finally { await unlink(file); await rmdir(dir); }
});
