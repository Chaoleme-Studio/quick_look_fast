import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { mountAudioWaveform } from '../src/audio-waveform.ts';

test('waveform seeks, uses bounded decoded peaks, and skips large audio', async () => {
  const window = new Window();
  const originals = new Map(['window', 'document', 'fetch'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  let requests = 0;
  let closed = 0;
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (_url, options) => {
    requests += 1;
    assert.equal(options.headers.Range, 'bytes=0-1023');
    return new Response(new Uint8Array(1024));
  } });
  window.AudioContext = class {
    constructor(options) { assert.equal(options.sampleRate, 8000, 'waveform analysis uses a low-rate buffer'); }
    state = 'suspended';
    async decodeAudioData() {
      const data = Float32Array.from({ length: 960 }, (_, index) => index < 480 ? .1 : .8);
      return { numberOfChannels: 1, getChannelData: () => data };
    }
    async close() { this.state = 'closed'; closed += 1; }
  };
  try {
    const player = window.document.createElement('audio');
    Object.defineProperty(player, 'duration', { configurable: true, value: 60 });
    const visual = mountAudioWaveform(player, { url: 'http://localhost/audio', size: 1024 });
    player.dispatchEvent(new window.Event('loadedmetadata'));
    for (let i = 0; i < 50 && visual.element.querySelector('.audio-waveform-meta span:nth-child(2)').textContent !== '音频波形'; i += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(requests, 1);
    assert.equal(closed, 1);
    const bars = visual.element.querySelectorAll('.audio-waveform-bars span');
    assert.ok(parseFloat(bars[0].style.height) < parseFloat(bars[70].style.height), 'bar heights come from decoded audio samples');
    const seek = visual.element.querySelector('input');
    assert.equal(seek.disabled, false);
    seek.value = '30';
    seek.dispatchEvent(new window.Event('input'));
    assert.equal(player.currentTime, 30, 'dragging seeks the media element');
    assert.equal(visual.element.querySelectorAll('.is-played').length, 48);
    assert.match(seek.getAttribute('aria-valuetext'), /0:30 \/ 1:00/);
    visual.dispose();

    const large = window.document.createElement('audio');
    Object.defineProperty(large, 'duration', { configurable: true, value: 600 });
    const fallback = mountAudioWaveform(large, { url: 'http://localhost/large', size: 7 * 1024 * 1024 });
    large.dispatchEvent(new window.Event('loadedmetadata'));
    assert.equal(requests, 1, 'large audio must not be decoded or read into memory for the visual');
    assert.equal(fallback.element.querySelector('.audio-waveform-meta span:nth-child(2)').textContent, '波形示意');
    assert.equal(fallback.element.querySelector('input').disabled, false, 'large audio remains seekable');
    fallback.dispose();
  } finally {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
    await window.happyDOM.close();
  }
});
