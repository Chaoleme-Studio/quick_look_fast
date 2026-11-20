'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveMarkdownImage } = require('../build/dist-electron/files/markdown-images.js');

test('Markdown images are limited to safe raster files within the document directory', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'quicklook-md-image-'));
  const root = path.join(workspace, 'docs');
  fs.mkdirSync(path.join(root, 'images'), { recursive: true });
  const document = path.join(root, 'README.md');
  const image = path.join(root, 'images', '示例.png');
  fs.writeFileSync(document, '# demo');
  fs.writeFileSync(image, 'image');
  fs.writeFileSync(path.join(workspace, 'outside.png'), 'outside');
  fs.writeFileSync(path.join(root, 'script.svg'), '<svg/>');
  const oversized = path.join(root, 'large.png');
  const handle = fs.openSync(oversized, 'w');
  fs.ftruncateSync(handle, 12 * 1024 * 1024 + 1);
  fs.closeSync(handle);
  try {
    assert.equal(await resolveMarkdownImage(document, 'images/%E7%A4%BA%E4%BE%8B.png?view=1'), await fs.promises.realpath(image));
    for (const reference of ['../outside.png', '%2e%2e/outside.png', '/outside.png', 'C:/outside.png',
      'https://example.com/image.png', 'images\\示例.png', 'script.svg', 'missing.png', 'large.png']) {
      assert.equal(await resolveMarkdownImage(document, reference), undefined, reference);
    }
    const link = path.join(root, 'linked');
    fs.symlinkSync(workspace, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(await resolveMarkdownImage(document, 'linked/outside.png'), undefined, 'a junction cannot escape the document directory');
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
});
