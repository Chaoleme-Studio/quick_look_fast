import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { mountBrowserImage, supportsBrowserImage } from '../src/preview/image/browser-image.ts';

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
    Object.defineProperty(viewport, 'scrollWidth', { configurable: true, value: 2048 });
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 1048 });
    viewport.scrollLeft = 300; viewport.scrollTop = 200;
    target.querySelector('[aria-label="实际大小"]').click();
    assert.equal(viewport.classList.contains('is-pannable'), true, 'a zoomed image exposes the hand cursor');
    image.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: 200, clientY: 200 }));
    window.dispatchEvent(new window.PointerEvent('pointermove', { pointerId: 1, pointerType: 'mouse', buttons: 1, clientX: 150, clientY: 160, cancelable: true }));
    assert.equal(viewport.scrollLeft, 350, 'dragging left pans the image horizontally');
    assert.equal(viewport.scrollTop, 240, 'dragging up pans the image vertically');
    assert.equal(viewport.classList.contains('is-panning'), true);
    window.dispatchEvent(new window.PointerEvent('pointerup', { pointerId: 1, pointerType: 'mouse' }));
    assert.equal(viewport.classList.contains('is-panning'), false);
    image.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, pointerId: 2, pointerType: 'mouse', button: 2, buttons: 2, clientX: 200, clientY: 200 }));
    window.dispatchEvent(new window.PointerEvent('pointermove', { pointerId: 2, pointerType: 'mouse', buttons: 2, clientX: 100, clientY: 100 }));
    assert.equal(viewport.scrollLeft, 350, 'right-click does not start panning');
    target.querySelector('[aria-label="顺时针旋转"]').click(); assert.match(image.style.transform, /rotate\(90deg\)/);
    assert.equal(target.querySelector('.browser-image-frame').style.width, '1000px');
  } finally {
    dispose?.(); if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; await window.happyDOM.close();
  }
});
