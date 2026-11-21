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
const { parseFinderSelection, FINDER_SELECTION_SCRIPT, startFinderSpaceBridge } = require('../build/dist-electron/platform/macos-finder.js');
const { defaultMacSettings, readMacSettings, writeMacSettings } = require('../build/dist-electron/platform/macos-settings.js');
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

test('GNOME integration handles a file request delivered as its service name is acquired', async () => {
  const selected = path.resolve('cold start.txt');
  const opened = [];
  const sent = [];
  const bus = {
    on() {},
    addMethodHandler(handler) { this.handler = handler; },
    async requestName() {
      assert.equal(typeof this.handler, 'function');
      this.handler(message('ShowFile', 'ssb', [pathToFileURL(selected).href, '', true]));
      return dbus.RequestNameReply.PRIMARY_OWNER;
    },
    send(value) { sent.push(value); },
    disconnect() {},
  };
  const service = await startLinuxPreviewer({
    open: (...args) => opened.push(args), close() {}, visible: () => false, status() {},
  }, { ...dbus, sessionBus: () => bus });
  assert.deepEqual(opened, [[selected, true, '']]);
  assert.equal(sent[0].type, dbus.MessageType.METHOD_RETURN);
  service.close();
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

test('macOS settings keep independent visibility and a valid Finder mode across reads', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'quicklook-fast-mac-settings-'));
  try {
    assert.equal(readMacSettings(root), undefined, 'an upgrade can migrate the old Finder preference');
    assert.equal(defaultMacSettings.finderMode, 'space', 'new installs default to plain Space');
    const saved = { showDock: true, showMenuBar: false, finderMode: 'space', finderNavigation: false };
    writeMacSettings(root, saved);
    assert.deepEqual(readMacSettings(root), saved);
    writeMacSettings(root, { ...saved, finderMode: 'system' });
    assert.equal(readMacSettings(root).finderMode, 'system', 'explicit opt-out survives relaunch');
    await writeFile(path.join(root, 'mac-settings.json'), JSON.stringify({ showMenuBar: false, finderMode: 'invalid' }));
    assert.deepEqual(readMacSettings(root), { ...defaultMacSettings, showMenuBar: false });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Finder selection parser keeps spaces and filename newlines without interpreting script output', () => {
  const name = path.resolve('a b\nfile.txt');
  assert.equal(parseFinderSelection(`${name}\n`), name);
  assert.equal(parseFinderSelection(`${name}\r\n`), `${name}\r`);
  assert.equal(parseFinderSelection('\n'), undefined);
  assert.equal(parseFinderSelection('relative.txt\n'), undefined);
  assert.match(FINDER_SELECTION_SCRIPT, /com\.apple\.finder/);
});

test('Finder Space bridge forwards active source messages and preserves an explicit permissions failure', {
  skip: process.platform === 'win32', timeout: 5000,
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'quicklook-fast-finder-'));
  const file = path.join(root, 'file with spaces\nand a newline.txt');
  const selection = path.join(root, 'next file.txt');
  const sourceId = 'finder-source';
  const executable = path.join(root, 'bridge');
  await writeFile(executable, `#!/bin/sh
[ "$1" = "--prompt-accessibility" ] && [ "$2" = "--navigation-only" ] || exit 1
cat <<'EOF'
{"status":"accessibility-required"}
${JSON.stringify({ file, sourceId })}
{"status":"active"}
${JSON.stringify({ file: 'relative.txt', sourceId })}
${JSON.stringify({ file })}
invalid json
${JSON.stringify({ file, sourceId })}
EOF
IFS= read -r track && IFS= read -r navigate && IFS= read -r forget || exit 1
printf '%s\\n' "$track" "$navigate" "$forget" > "$0.commands"
cat <<'EOF'
${JSON.stringify({ selection, sourceId })}
{"status":"accessibility-required"}
${JSON.stringify({ file, sourceId })}
EOF
`, { mode: 0o700 });

  const files = [];
  const selections = [];
  const statuses = [];
  let bridge;
  try {
    await new Promise((resolve, reject) => {
      bridge = startFinderSpaceBridge(executable, {
        onFile(value, id) {
          files.push([value, id]);
          bridge.track(id, value);
          bridge.navigate(id, 'ArrowDown');
          bridge.forget(id);
        },
        onSelection: (value, id) => selections.push([value, id]),
        onStatus(value) {
          statuses.push(value);
          if (value === 'accessibility-required' && statuses.includes('active')) setTimeout(resolve, 30);
          if (value === 'unavailable') reject(new Error('Unexpected unavailable status'));
        },
      }, true, false);
    });
    assert.deepEqual(files, [[file, sourceId]]);
    assert.deepEqual(selections, [[selection, sourceId]]);
    assert.deepEqual(statuses, ['accessibility-required', 'active', 'accessibility-required']);
    const commands = (await readFile(`${executable}.commands`, 'utf8')).trimEnd().split('\n').map(JSON.parse);
    assert.deepEqual(commands, [
      { action: 'track', sourceId, filePath: file },
      { action: 'navigate', sourceId, key: 'ArrowDown' },
      { action: 'forget', sourceId },
    ]);
  } finally {
    bridge?.stop();
    await rm(root, { recursive: true, force: true });
  }
});
