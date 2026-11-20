import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { mountHtmlPreview } from '../src/preview/web/html-preview.ts';

test('HTML starts with an isolated page, and script setting reloads it', async () => {
  const window = new Window({ settings: { disableIframePageLoading: true } });
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  let view;
  try {
    const target = window.document.createElement('div'); window.document.body.append(target);
    let ready = 0;
    view = mountHtmlPreview(target, { url: 'http://127.0.0.1:1234/preview/token/demo.html', size: 33 * 1024 * 1024 }, true, () => ready++);
    let iframe = target.querySelector('iframe');
    assert.ok(iframe, 'a 33 MiB HTML starts directly without buffering it in the application');
    assert.equal(ready, 1);
    assert.match(iframe.getAttribute('sandbox'), /allow-scripts/);
    assert.doesNotMatch(iframe.getAttribute('sandbox'), /allow-same-origin|allow-top-navigation|allow-popups/);
    assert.equal(iframe.src, 'http://127.0.0.1:1234/preview/token/demo.html');
    view.setScriptsEnabled(false);
    const replacement = target.querySelector('iframe');
    assert.notEqual(replacement, iframe);
    assert.equal(replacement.getAttribute('sandbox'), '');
    view.setScriptsEnabled(true);
    iframe = target.querySelector('iframe');
    assert.match(iframe.getAttribute('sandbox'), /allow-scripts/);
    view.dispose();
    assert.equal(target.querySelector('iframe'), null);
  } finally {
    view?.dispose();
    if (saved) Object.defineProperty(globalThis, 'document', saved); else delete globalThis.document;
    await window.happyDOM.close();
  }
});

test('very large HTML waits for approval and source view reads only a bounded range', async () => {
  const window = new Window({ settings: { disableIframePageLoading: true } });
  const saved = new Map();
  const calls = [];
  for (const [name, value] of [['document', window.document], ['fetch', async (_url, options) => {
    calls.push(options.headers.Range); return new Response('<h1>sample</h1>', { status: 206 });
  }]]) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  let view;
  try {
    const target = window.document.createElement('div'); window.document.body.append(target);
    view = mountHtmlPreview(target, { url: 'http://127.0.0.1/file.html', size: 200 * 1024 * 1024 }, true, () => {});
    assert.equal(target.querySelector('iframe'), null);
    assert.match(target.textContent, /超过 64 MiB/);
    target.querySelectorAll('.html-preview-large button')[1].click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(calls, ['bytes=0-1048575']);
    assert.equal(target.querySelector('pre').textContent, '<h1>sample</h1>');
    target.querySelector('.html-preview-toolbar button').click();
    target.querySelector('.html-preview-large button').click();
    assert.ok(target.querySelector('iframe'), 'the user can choose to load the full document');
  } finally {
    view?.dispose();
    for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
    await window.happyDOM.close();
  }
});

test('HTML extracted from an archive uses a temporary isolated Blob URL', async () => {
  const window = new Window({ settings: { disableIframePageLoading: true } });
  const savedDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  let revoked, blobType;
  URL.createObjectURL = (value) => { blobType = value.type; return 'blob:quicklook-test'; };
  URL.revokeObjectURL = (value) => { revoked = value; };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  let view;
  try {
    const target = window.document.createElement('div'); window.document.body.append(target);
    const blob = new Blob(['<html><p>archive</p></html>']);
    view = mountHtmlPreview(target, { url: '', size: blob.size, blob }, true, () => {});
    assert.equal(target.querySelector('iframe').getAttribute('src'), 'blob:quicklook-test');
    assert.equal(blobType, 'text/html', 'untyped extracted entries are rendered as HTML');
    assert.match(target.querySelector('iframe').getAttribute('sandbox'), /allow-scripts/);
    view.dispose();
    assert.equal(revoked, 'blob:quicklook-test');
  } finally {
    view?.dispose(); URL.createObjectURL = create; URL.revokeObjectURL = revoke;
    if (savedDocument) Object.defineProperty(globalThis, 'document', savedDocument); else delete globalThis.document;
    await window.happyDOM.close();
  }
});
