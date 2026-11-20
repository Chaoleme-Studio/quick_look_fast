import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isProbablyText, formatHexSample } from '../src/preview/file-inspection.ts';

test('classifies text and binary from a bounded sample', () => {
  assert.equal(isProbablyText(new TextEncoder().encode('1\n00:00:01,000 --> 00:00:02,000\n你好')), true);
  assert.equal(isProbablyText(Uint8Array.from([0xff, 0xfe, 0x61, 0])), true, 'UTF-16 BOM must not be mistaken for binary');
  assert.equal(isProbablyText(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x00, 0x00])), false);
  assert.equal(isProbablyText(Uint8Array.from([65, 0, 66])), false);
  assert.equal(isProbablyText(new Uint8Array()), true);
  assert.equal(formatHexSample(Uint8Array.from([0, 1, 254, 255])), '00 01 FE FF');
  assert.equal(formatHexSample(new Uint8Array(100)).split(' ').length < 100, true, 'hex fallback must be bounded');
});
