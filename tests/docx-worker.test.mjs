import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

test('DOCX parsing worker accepts only the bundled local JSZip and parses a document', async () => {
  const workerPath = fileURLToPath(new URL('../dist/file-viewer/vendor/docx/docx.worker.js', import.meta.url));
  const bytes = await readFile(new URL('./fixtures/office-sample.docx', import.meta.url));
  const run = (jsZipUrl) => new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      globalThis.self = globalThis;
      globalThis.location = { href: 'slowlook://app/file-viewer/vendor/docx/docx.worker.js' };
      globalThis.postMessage = data => parentPort.postMessage(data);
      globalThis.importScripts = url => {
        if (!url.startsWith('slowlook://app/file-viewer/vendor/docx/jszip.min.js')) throw new Error('unexpected import');
        // Evaluate the distributed UMD script as a classic Worker script,
        // without Node's CommonJS globals, as importScripts does in Chromium.
        new Function('module', 'exports', 'define', require('node:fs').readFileSync(workerData.zip, 'utf8'))(undefined, undefined, undefined);
      };
      require(workerData.worker);
      parentPort.on('message', data => globalThis.onmessage({ data }));
    `, { eval: true, workerData: { worker: workerPath, zip: fileURLToPath(new URL('../dist/file-viewer/vendor/docx/jszip.min.js', import.meta.url)) } });
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error('DOCX worker timed out')); }, 10000);
    worker.on('error', error => { clearTimeout(timer); void worker.terminate(); reject(error); });
    worker.on('message', message => {
      if (message.type !== 'parsed' && message.type !== 'error') return;
      clearTimeout(timer); void worker.terminate(); resolve(message);
    });
    worker.postMessage({ type: 'parse', id: 1, data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), options: {}, jsZipUrl });
  });
  const parsed = await run('slowlook://app/file-viewer/vendor/docx/jszip.min.js?file-viewer-docx=3');
  assert.equal(parsed.type, 'parsed');
  assert.ok(parsed.snapshot);
  const blocked = await run('slowlook://other/file-viewer/vendor/docx/jszip.min.js');
  assert.equal(blocked.type, 'error');
  assert.match(blocked.error.message, /same-origin/);
});
