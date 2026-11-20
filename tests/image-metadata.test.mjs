import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readImageDimensions, readPhotoExif } from '../src/preview/image/image-metadata.ts';

const signal = new AbortController().signal;
function source(name, data) {
  const blob = new Blob(data);
  return { name, size: blob.size, blob };
}

test('reads image geometry independently of EXIF and identifies an SVG viewBox', async () => {
  const psd = Buffer.alloc(26);
  psd.write('8BPS');
  psd.writeUInt32BE(1080, 14);
  psd.writeUInt32BE(1920, 18);
  assert.deepEqual(await readImageDimensions(source('large.psd', [psd]), signal), { width: 1920, height: 1080 });
  assert.deepEqual(await readImageDimensions(source('icon.svg', ['<svg viewBox="0 0 48 32"></svg>']), signal), { width: 48, height: 32, unit: 'viewBox' });
  assert.equal((await readPhotoExif(source('large.psd', [psd]), signal)).status, 'unsupported');
});

test('locates PNG and WebP EXIF beyond the image data and reads actual EXIF size tags', async () => {
  const tags = Buffer.alloc(80);
  tags.write('II');
  tags.writeUInt16LE(42, 2);
  tags.writeUInt32LE(8, 4);
  tags.writeUInt16LE(2, 8);
  const entry = (offset, id, type, count, value) => {
    tags.writeUInt16LE(id, offset);
    tags.writeUInt16LE(type, offset + 2);
    tags.writeUInt32LE(count, offset + 4);
    tags.writeUInt32LE(value, offset + 8);
  };
  entry(10, 0x010f, 2, 6, 64);
  entry(22, 0x8769, 4, 1, 38);
  tags.writeUInt16LE(2, 38);
  entry(40, 0xa002, 4, 1, 2048);
  entry(52, 0xa003, 4, 1, 1536);
  tags.write('Canon\0', 64);
  const pixels = Buffer.alloc(600_000);
  const pngChunk = (name, bytes) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(bytes.length);
    header.write(name, 4);
    return [header, bytes, Buffer.alloc(4)];
  };
  const png = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...pngChunk('IDAT', pixels)];
  const end = pngChunk('IEND', Buffer.alloc(0));
  assert.equal((await readPhotoExif(source('no-tags.png', [...png, ...end]), signal)).status, 'missing');
  const riffChunk = (name, bytes) => {
    const header = Buffer.alloc(8);
    header.write(name);
    header.writeUInt32LE(bytes.length, 4);
    return [header, bytes];
  };
  const riff = Buffer.concat([Buffer.from('WEBP'), ...riffChunk('VP8 ', pixels), ...riffChunk('EXIF', tags)]);
  const riffHeader = Buffer.alloc(8);
  riffHeader.write('RIFF');
  riffHeader.writeUInt32LE(riff.length, 4);
  for (const file of [source('photo.png', [...png, ...pngChunk('eXIf', tags), ...end]), source('photo.webp', [riffHeader, riff])]) {
    const result = await readPhotoExif(file, signal);
    assert.equal(result.status, 'found');
    assert.ok(result.fields.some(([name, value]) => name === '相机' && value === 'Canon'));
    assert.deepEqual(result.dimensions, { width: 2048, height: 1536 });
  }
});
