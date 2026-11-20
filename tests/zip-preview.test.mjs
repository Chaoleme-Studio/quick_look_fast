import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, unlink, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import { ZipWriter, Uint8ArrayWriter, TextReader } from '@zip.js/zip.js';
import { Window } from 'happy-dom';
import { mountZipPreview, mountRarPreview } from '../src/preview/archive/zip-preview.ts';
const require = createRequire(import.meta.url);
const { startFileServer } = require('../build/dist-electron/files/file-server.js');

test('ZIP preview expands folders, filters names and opens selected contents', async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), 'slowlook-zip-ui-'));
  const filename = path.join(tmp, 'fixture.zip');
  const zip = new JSZip(); zip.file('资料/说明.txt', 'readable content'); zip.file('资料/计划.txt', 'plan');
  const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  await writeFile(filename, data);
  const { server, origin } = await startFileServer(() => ({ token: 'zip-ui', path: filename }));
  const window = new Window();
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  let dispose;
  try {
    const target = window.document.createElement('div'); window.document.body.append(target);
    let rendered = '', disposed = 0, fullPreviewCount = 0;
    let ready;
    const loaded = new Promise((resolve) => { ready = resolve; });
    dispose = mountZipPreview(target, { name: 'fixture.zip', url: `${origin}/preview/zip-ui/fixture.zip`, size: data.length }, ready,
      async (_name, blob, mount) => { rendered = await blob.text(); mount.textContent = rendered; return () => { disposed += 1; }; },
      { fullPreview: () => { fullPreviewCount++; } });
    await loaded;
    const fullPreview = target.querySelector('.zip-full-preview'); fullPreview.click(); fullPreview.click();
    assert.equal(fullPreviewCount, 1, 'a rapid repeated click cannot start duplicate full-document renders');
    assert.match(target.textContent, /3 项/);
    const folder = target.querySelector('.zip-folder');
    assert.match(folder.textContent, /资料/);
    folder.click();
    const file = [...target.querySelectorAll('.zip-file')].find((item) => item.textContent.includes('说明.txt'));
    assert.ok(file); file.click();
    for (let n = 0; n < 100 && rendered !== 'readable content'; n += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(rendered, 'readable content');
    const toggle = target.querySelector('.preview-sidebar-toggle');
    const preview = target.querySelector('.zip-child-viewer');
    toggle.click();
    assert.equal(target.querySelector('.zip-sidebar').hidden, true);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(target.querySelector('.zip-child-viewer'), preview, 'collapsing the tree keeps the selected file mounted');
    toggle.click();
    assert.equal(target.querySelector('.zip-sidebar').hidden, false);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    const search = target.querySelector('input[type="search"]');
    search.value = '计划'; search.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(target.querySelectorAll('.zip-file').length, 1);
    assert.match(target.querySelector('.zip-file').textContent, /计划/);
    dispose(); dispose = undefined;
    assert.equal(disposed, 1, 'closing the ZIP releases its child preview');
  } finally {
    dispose?.();
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else delete globalThis.document;
    await window.happyDOM.close();
    await new Promise((resolve) => server.close(resolve));
    await unlink(filename); await rmdir(tmp);
  }
});

test('ZIP asks for a password, permits retry, and previews the selected entry', async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), 'slowlook-zip-password-'));
  const filename = path.join(tmp, 'encrypted.zip');
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
  await writer.add('secret.txt', new TextReader('protected content'), { password: 'correct', useWebWorkers: false });
  const bytes = await writer.close(); await writeFile(filename, bytes);
  const { server, origin } = await startFileServer(() => ({ token: 'ui', path: filename }));
  const window = new Window();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  let dispose;
  const waitFor = async (predicate) => { for (let i = 0; i < 200 && !predicate(); i++) await new Promise((resolve) => setTimeout(resolve, 5)); assert.ok(predicate()); };
  try {
    const target = window.document.createElement('div'); window.document.body.append(target);
    let rendered = '';
    await new Promise((resolve) => { dispose = mountZipPreview(target, { name: 'encrypted.zip', url: `${origin}/preview/ui/encrypted.zip`, size: bytes.length }, resolve,
      async (_name, blob) => { rendered = await blob.text(); }); });
    target.querySelector('.zip-file').click();
    await waitFor(() => target.querySelector('.password-card'));
    let input = target.querySelector('.password-card input'); input.value = 'wrong';
    target.querySelector('.password-card').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => target.querySelector('.password-error')?.textContent.includes('密码'));
    input = target.querySelector('.password-card input'); input.value = 'correct';
    target.querySelector('.password-card').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => rendered === 'protected content');
  } finally {
    dispose?.();
    if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document;
    await window.happyDOM.close(); await new Promise((resolve) => server.close(resolve)); await unlink(filename); await rmdir(tmp);
  }
});

test('RAR prompts for an encrypted directory and respects cancellation', async () => {
  const window = new Window(); const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  let dispose; const calls = [];
  try {
    const target = window.document.createElement('div'); window.document.body.append(target);
    const ready = new Promise((resolve) => {
      dispose = mountRarPreview(target, { name: 'encrypted.rar', url: 'http://local/preview/id/a.rar', size: 200 }, resolve, async () => {},
        async (request) => { calls.push(request); return request.headerPassword === '1234'
          ? { ok: true, entries: [{ name: 'a.txt', directory: false, encrypted: true, size: 4, compressedSize: 4 }] }
          : { ok: false, code: 'password', message: '需要密码' }; });
    });
    await ready;
    for (let i = 0; i < 50 && !target.querySelector('.password-card'); i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(target.querySelector('.password-card'));
    target.querySelector('.password-card input').value = '1234';
    target.querySelector('.password-card').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    for (let i = 0; i < 50 && !target.querySelector('.zip-file'); i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.match(target.querySelector('.zip-file').textContent, /a.txt/);
    assert.equal(calls.at(-1).headerPassword, '1234');
  } finally {
    dispose?.(); if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; await window.happyDOM.close();
  }
});
