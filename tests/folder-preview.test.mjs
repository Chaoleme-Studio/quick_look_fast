import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { mountFolderPreview } from '../src/folder-preview.ts';

test('folder preview distinguishes formats, switches files and respects settings', async () => {
  const window = new Window();
  const saved = new Map();
  for (const name of ['document', 'HTMLButtonElement']) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value: window[name] });
  }
  let resolveOld; const opens = []; const rendered = []; let released = 0; let dispose;
  try {
    const target = window.document.createElement('div'); window.document.body.append(target);
    const ready = new Promise((resolve) => {
      dispose = mountFolderPreview(target, { id: 'root', name: '示例', path: 'D:\\示例' }, async () => ({ entries: [
        { name: '方案.docx', kind: 'file', id: 'old' }, { name: '说明.txt', kind: 'file', id: 'new' }, { name: '图片.png', kind: 'file', id: 'image' },
      ], nextOffset: null, truncated: false }), resolve, {
        open(id, purpose) { opens.push({ id, purpose }); return id === 'old' ? new Promise((done) => { resolveOld = done; }) : Promise.resolve({ url: 'http://local/' + id, name: id + '.txt', size: 3 }); },
        async render(file, mount) { rendered.push(file.name); mount.textContent = file.name; return () => {}; },
        release() { released++; },
      }, { inlinePreview: true, thumbnails: false });
    });
    await ready;
    assert.equal(target.querySelector('.folder-type-document').textContent, 'DOCX');
    assert.equal(target.querySelector('.folder-type-text').textContent, 'TXT');
    target.querySelector('[data-folder-file="old"]').click();
    target.querySelector('[data-folder-file="new"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveOld({ url: 'http://local/old', name: 'old.docx', size: 3 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(rendered, ['new.txt'], 'an older asynchronous selection cannot replace the latest one');
    assert.equal(target.querySelector('[aria-current="true"]').dataset.folderFile, 'new');
    dispose.setOptions({ inlinePreview: false, thumbnails: false });
    assert.equal(target.querySelector('.folder-detail').hidden, true);
    assert.equal(target.querySelector('[data-folder-file="new"]').disabled, true);
    assert.ok(released >= 2);
    assert.equal(opens.filter((value) => value.purpose === 'preview').length, 2);
  } finally {
    dispose?.dispose();
    for (const [name, value] of saved) { if (value) Object.defineProperty(globalThis, name, value); else delete globalThis[name]; }
    await window.happyDOM.close();
  }
});

test('folder thumbnails start only when visible and limit simultaneous reads', async () => {
  const window = new Window(); const saved = new Map(); let observer;
  for (const [name, value] of [['document', window.document], ['HTMLButtonElement', window.HTMLButtonElement], ['IntersectionObserver', class {
    constructor(callback) { this.callback = callback; this.targets = []; observer = this; }
    observe(target) { this.targets.push(target); } unobserve() {} disconnect() {}
  }]]) { saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, value }); }
  const pending = []; let view;
  try {
    const target = window.document.createElement('div'); window.document.body.append(target);
    await new Promise((ready) => { view = mountFolderPreview(target, { id: 'root', name: '示例', path: 'D:\\示例' }, async () => ({
      entries: Array.from({ length: 8 }, (_, i) => ({ name: `image-${i}.png`, kind: 'file', id: String(i) })), nextOffset: null, truncated: false,
    }), ready, { open(id, purpose) { assert.equal(purpose, 'thumbnail'); return new Promise((resolve) => pending.push({ id, resolve })); },
      async render() {}, release() {} }, { inlinePreview: true, thumbnails: true }); });
    assert.equal(pending.length, 0, 'offscreen images are not requested');
    observer.callback(observer.targets.map((target) => ({ target, isIntersecting: true })));
    assert.equal(pending.length, 4, 'at most four thumbnail loads are active');
    observer.callback([{ target: observer.targets[4], isIntersecting: false }]);
    pending[0].resolve({ url: 'http://local/0', name: 'image-0.png', size: 2 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    target.querySelector('.folder-thumbnail').dispatchEvent(new window.Event('load'));
    assert.equal(pending.length, 5, 'another visible thumbnail can start after a load finishes');
    assert.equal(pending[4].id, '5', 'an image that left the viewport is removed from the queue');
    view.setOptions({ inlinePreview: true, thumbnails: false });
    assert.equal(target.querySelector('.folder-thumbnail').hidden, true);
  } finally {
    view?.dispose();
    for (const [name, value] of saved) { if (value) Object.defineProperty(globalThis, name, value); else delete globalThis[name]; }
    await window.happyDOM.close();
  }
});

test('cancelled thumbnail events cannot finish a new request for the same row', async () => {
  const window = new Window(); const saved = new Map(); let observer;
  for (const [name, value] of [['document', window.document], ['HTMLButtonElement', window.HTMLButtonElement], ['IntersectionObserver', class {
    constructor(callback) { this.callback = callback; this.targets = []; this.unobserved = []; observer = this; }
    observe(target) { this.targets.push(target); } unobserve(target) { this.unobserved.push(target); } disconnect() {}
  }]]) { saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, value }); }
  const pending = []; let view;
  try {
    const target = window.document.createElement('div'); window.document.body.append(target);
    await new Promise((ready) => { view = mountFolderPreview(target, { id: 'root', name: 'Demo', path: 'D:\\Demo' }, async () => ({
      entries: [{ name: 'photo.png', kind: 'file', id: 'photo' }], nextOffset: null, truncated: false,
    }), ready, { open() { return new Promise((resolve) => pending.push(resolve)); }, async render() {}, release() {} }, { inlinePreview: true, thumbnails: true }); });
    const holder = observer.targets[0];
    observer.callback([{ target: holder, isIntersecting: true }]);
    pending[0]({ url: 'http://local/old', name: 'photo.png', size: 3 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const oldImage = target.querySelector('.folder-thumbnail');
    observer.callback([{ target: holder, isIntersecting: false }]);
    observer.callback([{ target: holder, isIntersecting: true }]);
    assert.equal(pending.length, 2);
    const currentImage = target.querySelector('.folder-thumbnail');
    assert.notEqual(currentImage, oldImage);
    oldImage.dispatchEvent(new window.Event('load'));
    assert.equal(currentImage.hidden, true);
    assert.equal(observer.unobserved.length, 0, 'an old load must not stop observing the new request');
    pending[1]({ url: 'http://local/new', name: 'photo.png', size: 3 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    currentImage.dispatchEvent(new window.Event('load'));
    assert.equal(currentImage.hidden, false);
    assert.equal(observer.unobserved.length, 0, 'loaded images remain observed so offscreen pixels can be released');
    observer.callback([{ target: holder, isIntersecting: false }]);
    assert.equal(currentImage.hidden, true);
    assert.equal(currentImage.hasAttribute('src'), false, 'leaving the viewport releases the decoded image reference');
    observer.callback([{ target: holder, isIntersecting: true }]);
    assert.equal(pending.length, 3, 'returning to view starts a fresh thumbnail request');
  } finally {
    view?.dispose();
    for (const [name, value] of saved) { if (value) Object.defineProperty(globalThis, name, value); else delete globalThis[name]; }
    await window.happyDOM.close();
  }
});
