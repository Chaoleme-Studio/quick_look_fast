'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { mkdtemp, readFile, writeFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const dbus = require('dbus-next');
const { createNautilusHandler, startLinuxPreviewer } = require('../build/dist-electron/platform/linux/previewer.js');
const { parseFinderSelection, FINDER_SELECTION_SCRIPT } = require('../build/dist-electron/platform/macos-finder.js');
const installer = require('../electron/platform/linux/install.cjs');

const objectPath = '/org/gnome/NautilusPreviewer';
const iface = 'org.gnome.NautilusPreviewer2';

function message(member, signature, body, interfaceName = iface) {
  return new dbus.Message({ path: objectPath, interface: interfaceName, member, signature, body, serial: 12, sender: ':1.42' });
}

test('GNOME preview protocol handles local files, old signatures, properties and rejects remote URIs', () => {
  const sent = [];
  const opened = [];
  let closed = 0;
  const handler = createNautilusHandler(dbus, { send: (value) => sent.push(value) }, {
    open: (...args) => opened.push(args), close: () => { closed += 1; }, visible: () => true, status() {},
  });
  const selected = path.resolve('test file #1.txt');
  const uri = pathToFileURL(selected).href;
  assert.equal(handler(message('ShowFile', 'ssbs', [uri, '', false, 'token'])), true);
  assert.deepEqual(opened[0], [selected, false, 'token']);
  assert.equal(sent[0].type, dbus.MessageType.METHOD_RETURN);
  assert.equal(handler(message('ShowFile', 'sib', [uri, 1, true], 'org.gnome.NautilusPreviewer')), true);
  assert.deepEqual(opened[1], [selected, true, '']);
  handler(message('ShowFile', 'ssb', ['https://example.test/file', '', false]));
  assert.equal(opened.length, 2);
  assert.equal(sent.at(-1).type, dbus.MessageType.ERROR);
  handler(message('ShowFile', 's', [uri]));
  assert.equal(sent.at(-1).type, dbus.MessageType.ERROR);
  handler(message('Get', 'ss', [iface, 'Visible'], 'org.freedesktop.DBus.Properties'));
  assert.equal(sent.at(-1).body[0].value, true);
  handler(message('GetAll', 's', [iface], 'org.freedesktop.DBus.Properties'));
  assert.equal(sent.at(-1).body[0].ParentHandle.value, '');
  handler(message('Close', '', []));
  assert.equal(closed, 1);
});

test('GNOME integration does not replace another owner and sends directional events', async () => {
  function fake(owner) {
    return {
      sent: [], disconnected: false,
      on() {}, requestName: async (_name, flags) => { assert.equal(flags, dbus.NameFlag.DO_NOT_QUEUE); return owner; },
      addMethodHandler(handler) { this.handler = handler; }, send(value) { this.sent.push(value); },
      disconnect() { this.disconnected = true; },
    };
  }
  const statuses = [];
  const callbacks = { open() {}, close() {}, visible: () => false, status: (value) => statuses.push(value) };
  const occupied = fake(dbus.RequestNameReply.EXISTS);
  assert.equal(await startLinuxPreviewer(callbacks, { ...dbus, sessionBus: () => occupied }), undefined);
  assert.equal(occupied.disconnected, true);
  assert.match(statuses.at(-1), /已有预览程序/);
  const available = fake(dbus.RequestNameReply.PRIMARY_OWNER);
  const service = await startLinuxPreviewer(callbacks, { ...dbus, sessionBus: () => available });
  service.navigate('ArrowLeft');
  service.navigate('ArrowDown');
  service.navigate('Enter');
  service.visibilityChanged(true);
  assert.deepEqual(available.sent.slice(0, 2).map((value) => value.body[0]), [4, 5]);
  assert.equal(available.sent.length, 3);
  assert.equal(available.sent[2].body[1].Visible.value, true);
  service.close();
  assert.equal(available.disconnected, true);
});

test('Linux integration installer preserves existing files and quotes paths with spaces and percent signs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'slowlook-integration-'));
  try {
    const launcher = path.join(root, '50% My Look');
    await writeFile(launcher, 'launcher');
    const dataHome = path.join(root, 'data');
    const first = installer.install({ launcher, dataHome, includeGnome: true });
    assert.equal(first.installed.length, 3);
    const dolphin = path.join(dataHome, 'kio', 'servicemenus', 'quicklook-fast.desktop');
    const content = await readFile(dolphin, 'utf8');
    assert.match(content, /50%% My Look/);
    assert.match(content, / -- %u/);
    assert.match(content, /MimeType=all\/allfiles;inode\/directory;/, 'Dolphin menu handles files and directories');
    if (process.platform !== 'win32') assert.ok((fs.statSync(dolphin).mode & 0o111) !== 0, 'Dolphin service menu must be executable');
    const gnome = await readFile(path.join(dataHome, 'dbus-1', 'services', 'org.gnome.NautilusPreviewer.service'), 'utf8');
    assert.match(gnome, /50% My Look/);
    assert.doesNotMatch(gnome, /50%% My Look/);
    await writeFile(dolphin, 'user customization');
    const second = installer.install({ launcher, dataHome, includeGnome: true });
    assert.equal(second.existing.length, 3);
    assert.equal(await readFile(dolphin, 'utf8'), 'user customization');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Finder selection parser keeps spaces and filename newlines without interpreting script output', () => {
  const name = path.resolve('a b\nfile.txt');
  assert.equal(parseFinderSelection(`${name}\n`), name);
  assert.equal(parseFinderSelection('\n'), undefined);
  assert.equal(parseFinderSelection('relative.txt\n'), undefined);
  assert.match(FINDER_SELECTION_SCRIPT, /com\.apple\.finder/);
});
