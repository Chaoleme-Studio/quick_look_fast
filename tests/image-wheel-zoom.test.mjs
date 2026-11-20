import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { installImageWheelZoom } from '../src/preview/image/image-wheel-zoom.ts';

test('wheel zoom applies only to the image preview, including its shadow DOM', async () => {
  const window = new Window();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement });
  try {
    const host = window.document.createElement('div');
    window.document.body.append(host);
    const viewer = window.document.createElement('div');
    host.append(viewer);
    const shadow = viewer.attachShadow({ mode: 'open' });
    const surface = window.document.createElement('div');
    surface.className = 'image-viewer';
    const image = window.document.createElement('img');
    surface.append(image); shadow.append(surface);
    const calls = [];
    let scale = 1;
    const controller = {
      getZoomState: () => ({ scale, minScale: 0.1, maxScale: 5 }),
      applyViewState: async (state, options) => { scale = state.scale; calls.push({ scale, options }); },
    };
    const cleanup = installImageWheelZoom(host, () => controller);
    const up = new window.WheelEvent('wheel', { deltaY: -120, bubbles: true, composed: true, cancelable: true });
    image.dispatchEvent(up);
    const down = new window.WheelEvent('wheel', { deltaY: 120, bubbles: true, composed: true, cancelable: true });
    image.dispatchEvent(down);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls.length, 2);
    assert.ok(calls[0].scale > 1.04 && calls[0].scale < 1.06, 'one notch should zoom by about 5%');
    assert.ok(Math.abs(scale - 1) < 0.0001, 'opposite wheel movements should restore the initial scale');
    assert.equal(calls[0].options.source, 'user');
    assert.equal(up.defaultPrevented, true);
    const outside = new window.WheelEvent('wheel', { deltaY: 120, bubbles: true, composed: true, cancelable: true });
    host.dispatchEvent(outside);
    assert.equal(outside.defaultPrevented, false);
    const modified = new window.WheelEvent('wheel', { deltaY: 120, ctrlKey: true, bubbles: true, composed: true, cancelable: true });
    Object.defineProperty(modified, 'ctrlKey', { value: true }); // Happy DOM omits modifier keys on WheelEvent.
    image.dispatchEvent(modified);
    assert.equal(modified.defaultPrevented, false, 'modified gestures are left to the viewer');
    cleanup();
  } finally {
    if (previous) Object.defineProperty(globalThis, 'HTMLElement', previous); else delete globalThis.HTMLElement;
    await window.happyDOM.close();
  }
});
