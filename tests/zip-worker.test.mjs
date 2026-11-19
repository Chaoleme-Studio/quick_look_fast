import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { Worker as NodeWorker } from 'node:worker_threads';
import { ZipWriter, Uint8ArrayWriter, TextReader } from '@zip.js/zip.js';
import { readZipDirectory } from '../src/zip-directory.ts';
import { extractZipEntry } from '../src/zip-extraction.ts';

const require = createRequire(import.meta.url);
const { startFileServer } = require('../dist-electron/file-server.js');

test('built ZIP worker decrypts one range-backed entry and is cancellable', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'slowlook-zip-worker-'));
  const filename = path.join(directory, 'encrypted.zip');
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
  await writer.add('folder/file.txt', new TextReader('worker preview 内容'), { password: 'correct', useWebWorkers: false });
  const bytes = await writer.close(); await writeFile(filename, bytes);
  const { server, origin } = await startFileServer(() => ({ token: 'worker', path: filename }));
  const oldWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  let parsed;
  try {
    const output = (await readdir(new URL('../dist/assets/', import.meta.url))).find((name) => /^zip-extract\.worker-.+\.js$/.test(name));
    assert.ok(output, 'Vite must include the ZIP worker in the distribution');
    const workerUrl = pathToFileURL(path.resolve('dist/assets', output)).href;
    let terminated = 0;
    class BrowserWorker {
      constructor() {
        this.thread = new NodeWorker(`
          const { parentPort, workerData } = require('node:worker_threads');
          globalThis.self = globalThis;
          globalThis.postMessage = data => parentPort.postMessage(data);
          const queued = [];
          parentPort.on('message', data => globalThis.onmessage ? globalThis.onmessage({ data }) : queued.push(data));
          import(workerData).then(() => queued.forEach(data => globalThis.onmessage({ data }))).catch(error => { throw error; });
        `, { eval: true, workerData: workerUrl });
        this.thread.on('message', data => this.onmessage?.({ data }));
        this.thread.on('error', error => this.onerror?.(error));
      }
      postMessage(data) { this.thread.postMessage(data); }
      terminate() { terminated++; void this.thread.terminate(); }
    }
    Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: BrowserWorker });
    const url = `${origin}/preview/worker/encrypted.zip`;
    parsed = await readZipDirectory(url, bytes.length);
    const entry = parsed.entries.find((item) => !item.directory);
    await assert.rejects(extractZipEntry(url, bytes.length, parsed, entry, undefined, 'wrong'), /密码/);
    assert.equal(await (await extractZipEntry(url, bytes.length, parsed, entry, undefined, 'correct')).text(), 'worker preview 内容');
    const abort = new AbortController();
    const pending = extractZipEntry(url, bytes.length, parsed, entry, abort.signal, 'correct');
    abort.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(terminated, 3, 'finish, password failure and cancellation each release their worker');
  } finally {
    if (oldWorker) Object.defineProperty(globalThis, 'Worker', oldWorker); else delete globalThis.Worker;
    await parsed?.reader.close();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
