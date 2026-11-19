const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DirectoryService } = require('../dist-electron/directory-service.js');

test('directory preview pages entries, expands folders and rejects stale or arbitrary IDs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'slowlook-folder-'));
  try {
    await fs.mkdir(path.join(root, '子文件夹'));
    await fs.writeFile(path.join(root, '子文件夹', 'nested.txt'), 'hello');
    await Promise.all(Array.from({ length: 205 }, (_, index) => fs.writeFile(path.join(root, `item-${index}.txt`), 'x')));
    let linkCreated = false;
    try { await fs.symlink(path.join(root, '子文件夹'), path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir'); linkCreated = true; } catch (error) {
      if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
    }
    const service = new DirectoryService();
    const id = service.open(root);
    const first = await service.read(id, 0);
    assert.equal(first.entries.length, 200);
    assert.equal(first.nextOffset, 200);
    const second = await service.read(id, first.nextOffset);
    const entries = [...first.entries, ...second.entries];
    assert.equal(entries.length, 206 + Number(linkCreated));
    assert.equal(second.nextOffset, null);
    assert.equal(new Set(entries.map((entry) => entry.name)).size, entries.length);
    const child = entries.find((entry) => entry.name === '子文件夹');
    assert.equal(child.kind, 'directory');
    assert.deepEqual((await service.read(child.id, 0)).entries.map((entry) => entry.name), ['nested.txt']);
    const file = entries.find((entry) => entry.name === 'item-0.txt');
    assert.ok(file.id, 'listed files have opaque capabilities');
    assert.equal((await service.file(file.id)).size, 1);
    await assert.rejects(() => service.file(path.join(root, 'item-0.txt')), /失效/);
    if (linkCreated) {
      const link = entries.find((entry) => entry.name === 'link');
      assert.equal(link.kind, 'link');
      assert.equal(link.id, undefined);
    }
    await assert.rejects(() => service.read(root, 0));
    await assert.rejects(() => service.read(id, -1));
    service.clear();
    await assert.rejects(() => service.read(id, 0), /已失效/);
    await assert.rejects(() => service.file(file.id), /已失效/);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('directory handles reject an ancestor replaced with a link', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'slowlook-folder-link-'));
  const original = path.resolve(root, 'A'); const moved = path.resolve(root, 'A-saved'); const replacement = path.resolve(root, 'replacement');
  const safe = (target) => { const relative = path.relative(root, target); return relative && !relative.startsWith('..') && !path.isAbsolute(relative); };
  assert.ok([original, moved, replacement].every(safe), 'all test paths must stay inside the temporary directory');
  try {
    await fs.mkdir(path.join(original, 'B'), { recursive: true });
    await fs.mkdir(path.join(replacement, 'B'), { recursive: true });
    await fs.writeFile(path.join(replacement, 'B', 'outside-name.txt'), 'fixture');
    const service = new DirectoryService(); const rootId = service.open(root);
    const a = (await service.read(rootId, 0)).entries.find((entry) => entry.name === 'A');
    const b = (await service.read(a.id, 0)).entries.find((entry) => entry.name === 'B');
    await fs.rename(original, moved);
    try { await fs.symlink(replacement, original, process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (error) {
      if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
      t.skip('creating a junction is unavailable in this environment'); return;
    }
    await assert.rejects(() => service.read(b.id, 0), /链接|位置/);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  }
});
