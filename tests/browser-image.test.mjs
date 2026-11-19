import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { mountBrowserImage, supportsBrowserImage } from '../src/browser-image.ts';

test('common images use a browser URL with fit, gentle wheel zoom and rotation', async () => {
  const window = new Window();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  let dispose;
  try {
    assert.equal(supportsBrowserImage('photo.PNG'), true);
    assert.equal(supportsBrowserImage('photo.heic'), false);
    const target = window.document.createElement('div'); window.document.body.append(target);
    let ready = 0, failures = 0;
    dispose = mountBrowserImage(target, 'http://127.0.0.1:9999/preview/token/photo.png', () => ready++, () => failures++);
    const image = target.querySelector('img'), viewport = target.querySelector('.browser-image-viewport');
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 2000 });
    Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 1000 });
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 1048 });
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 648 });
    image.dispatchEvent(new window.Event('load'));
    assert.equal(ready, 1); assert.equal(failures, 0);
    assert.equal(image.getAttribute('src'), 'http://127.0.0.1:9999/preview/token/photo.png');
    assert.equal(image.style.width, '1000px');
    viewport.dispatchEvent(new window.WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }));
    assert.ok(parseFloat(image.style.width) > 1040 && parseFloat(image.style.width) < 1060, 'one wheel step is about five percent');
    target.querySelector('[aria-label="实际大小"]').click(); assert.equal(image.style.width, '2000px');
    target.querySelector('[aria-label="顺时针旋转"]').click(); assert.match(image.style.transform, /rotate\(90deg\)/);
    assert.equal(target.querySelector('.browser-image-frame').style.width, '1000px');
  } finally {
    dispose?.(); if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; await window.happyDOM.close();
  }
});
