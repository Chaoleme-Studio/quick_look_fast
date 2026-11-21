'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const plasma = require('../electron/platform/linux/plasma/install.cjs');
const bridge = require('../electron/platform/linux/plasma/helper.cjs');

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quicklook-plasma-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('Plasma helper resolves desktop and local file URLs without evaluating filenames', { skip: process.platform === 'win32' }, () => {
  const desktop = '/home/user/桌面 # %';
  assert.equal(bridge.selectedPath('desktop:/hello%20world%23%24%25%0A.txt', desktop), `${desktop}/hello world#$%\n.txt`);
  assert.equal(bridge.selectedPath('file:///tmp/%24%28touch%20bad%29%27%0A.txt', desktop), "/tmp/$(touch bad)'\n.txt");
  assert.equal(bridge.selectedPath('file://localhost/tmp/%25.txt', desktop), '/tmp/%.txt');
  for (const uri of ['file:relative', 'file://host.example/tmp/a', 'smb://host/file', 'desktop:/../etc/passwd',
    'desktop:/%2Fetc/passwd', 'desktop:/dir%2Ffile', 'desktop:/%2E%2E/etc',
    'file:///tmp/a?bad=1', 'file:///tmp/%00', 'file:///tmp/foo%2Fbar']) {
    assert.throws(() => bridge.selectedPath(uri, desktop), uri);
  }

  let started;
  const original = process.env.ELECTRON_RUN_AS_NODE;
  process.env.ELECTRON_RUN_AS_NODE = '1';
  try {
    bridge.openFromArgs([encodeURIComponent('desktop:/a%20b'), encodeURIComponent(desktop)], {
      launcher: '/path/to/quicklook-fast',
      spawn: (command, args, options) => {
        started = { command, args, options };
        const child = new EventEmitter();
        child.unref = () => {};
        return child;
      },
    });
  } finally {
    if (original === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
    else process.env.ELECTRON_RUN_AS_NODE = original;
  }
  assert.equal(started.command, '/path/to/quicklook-fast');
  assert.deepEqual(started.args, ['--', `${desktop}/a b`]);
  assert.equal(started.options.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(started.options.detached, true);
});

test('Plasma shell command quotes paths containing spaces, quotes and shell syntax', { skip: process.platform === 'win32' }, () => {
  const qml = fs.readFileSync(path.join(__dirname, '../electron/platform/linux/plasma/main.qml'), 'utf8');
  const start = qml.indexOf('function shellQuote(value) {');
  const end = qml.indexOf('\n\n        Component.onCompleted:', start);
  assert.ok(start >= 0 && end > start);
  const shellQuote = vm.runInNewContext(`(${qml.slice(start, end)})`);
  for (const text of ['plain', 'my file', "quote' $(touch bad) `danger`", '中文\nfile']) {
    const result = spawnSync('/bin/sh', ['-c', `printf %s ${shellQuote(text)}`], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, text);
  }
});

test('Plasma selection bridge recognizes both current and older model APIs', () => {
  const qml = fs.readFileSync(path.join(__dirname, '../electron/platform/linux/plasma/main.qml'), 'utf8');
  const start = qml.indexOf('function countSelection() {');
  const end = qml.indexOf('\n        function refreshSelection()', start);
  assert.ok(start >= 0 && end > start);
  const source = `${qml.slice(start, end)}; countSelection()`;
  const count = (model) => vm.runInNewContext(source, { folder: { model } });
  assert.equal(count({ selectionCount: 1 }), 1);
  assert.equal(count({ selectionCount: 3 }), 3);
  let selected = [];
  const older = { hasSelection: () => selected.length > 0, rowCount: () => 6, isSelected: (row) => selected.includes(row) };
  assert.equal(count(older), 0);
  selected = [5];
  assert.equal(count(older), 1);
  selected = [1, 5];
  assert.equal(count(older), 2);
});

test('Plasma installer preserves user files, rejects conflicts and removes only its own package', (t) => {
  const dataHome = temporaryDirectory(t);
  const first = plasma.ensurePackage({ launcher: process.execPath, dataHome });
  assert.equal(first.installed, true);
  assert.equal(plasma.ensurePackage({ launcher: process.execPath, dataHome }).installed, false);
  const extra = path.join(first.target, 'user-directory');
  fs.mkdirSync(extra);
  assert.throws(() => plasma.removePackage(dataHome), /modified/);
  assert.ok(fs.existsSync(extra));
  fs.rmdirSync(extra);
  fs.appendFileSync(path.join(first.target, 'contents/ui/main.qml'), '// user change');
  assert.throws(() => plasma.removePackage(dataHome), /modified/);
  assert.ok(fs.existsSync(first.target));

  const separate = path.join(dataHome, 'other-data');
  const clean = plasma.ensurePackage({ launcher: process.execPath, dataHome: separate });
  assert.equal(plasma.removePackage(separate), clean.target);
  assert.ok(!fs.existsSync(clean.target));
});

test('a cached Plasma widget reads the launcher path again after reinstall', { skip: process.platform === 'win32' }, (t) => {
  const dataHome = temporaryDirectory(t);
  const firstLauncher = path.join(dataHome, "old launcher' $(bad)");
  const secondLauncher = path.join(dataHome, "new launcher' $(bad)");
  const calls = path.join(dataHome, 'calls');
  for (const launcher of [firstLauncher, secondLauncher]) {
    fs.writeFileSync(launcher, '#!/bin/sh\nprintf "%s\\n" "$ELECTRON_RUN_AS_NODE" "$0" "$1" "$2" "$3" > "$QUICKLOOK_TEST_CALLS"\n', { mode: 0o755 });
  }

  const first = plasma.ensurePackage({ launcher: firstLauncher, dataHome });
  const widgetFile = path.join(first.target, 'contents/ui/main.qml');
  const wrapper = path.join(first.target, 'contents/launch-helper.sh');
  const cachedQml = fs.readFileSync(widgetFile, 'utf8');
  assert.ok(!cachedQml.includes(firstLauncher));
  plasma.removePackage(dataHome);

  const second = plasma.ensurePackage({ launcher: secondLauncher, dataHome });
  assert.equal(second.target, first.target);
  assert.equal(fs.readFileSync(widgetFile, 'utf8'), cachedQml, 'the cached widget must retain a stable helper path');
  const result = spawnSync('/bin/sh', [wrapper, 'encoded-file', 'encoded-desktop'], {
    encoding: 'utf8', env: { ...process.env, QUICKLOOK_TEST_CALLS: calls },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(calls, 'utf8').trimEnd().split('\n'), [
    '1', secondLauncher, path.join(second.target, 'contents/helper.cjs'), 'encoded-file', 'encoded-desktop',
  ]);
});

test('the previous Plasma widget can be removed safely during the launcher migration', (t) => {
  const dataHome = temporaryDirectory(t);
  const { target } = plasma.ensurePackage({ launcher: process.execPath, dataHome });
  const manifestFile = path.join(target, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  fs.rmSync(path.join(target, 'contents/launch-helper.sh'));
  delete manifest.files['contents/launch-helper.sh'];
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  assert.throws(() => plasma.ensurePackage({ launcher: process.execPath, dataHome }), /removed and reinstalled/);
  assert.equal(plasma.removePackage(dataHome), target);
  assert.ok(!fs.existsSync(target));
});

test('Plasma scripts add one widget per active folder desktop and remove only these widgets', () => {
  let nextId = 1;
  function desktop(id, screen, type = 'org.kde.plasma.folder') {
    return {
      id, screen, type, entries: [],
      widgets(plugin) { return this.entries.filter((widget) => widget.type === plugin); },
      addWidget(plugin) {
        const widget = { type: plugin, id: nextId++, remove: () => { this.entries = this.entries.filter((entry) => entry !== widget); } };
        this.entries.push(widget);
        return widget;
      },
    };
  }
  const desktops = [desktop(1, 0), desktop(2, 1), desktop(3, -1), desktop(4, 2, 'unrelated')];
  desktops[0].entries.push({ type: 'other.widget', id: 99 });
  function execute(source) {
    let output;
    vm.runInNewContext(source, { desktops: () => desktops, print: (value) => { output = value; } });
    return JSON.parse(output);
  }
  const first = execute(plasma.activationScript());
  assert.equal(first.added.length, 2);
  assert.deepEqual(first.skipped, [3]);
  assert.deepEqual(first.errors, []);
  const again = execute(plasma.activationScript());
  assert.deepEqual(again.existing, [1, 2]);
  assert.equal(again.added.length, 0);
  const removed = execute(plasma.removalScript());
  assert.equal(removed.removed.length, 2);
  assert.deepEqual(desktops[0].entries.map((item) => item.type), ['other.widget']);
});

test('Plasma uninstall preserves its package when the session bus is unavailable', async (t) => {
  const dataHome = temporaryDirectory(t);
  const target = plasma.installPackage({ launcher: process.execPath, dataHome });
  let disconnected = false;
  const fakeDbus = {
    Message: class { constructor(fields) { Object.assign(this, fields); } },
    sessionBus: () => ({
      call: async (message) => {
        assert.equal(message.destination, 'org.kde.plasmashell');
        assert.equal(message.member, 'evaluateScript');
        throw new Error('Plasma unavailable');
      },
      disconnect: () => { disconnected = true; },
    }),
  };
  await assert.rejects(plasma.uninstall(dataHome, fakeDbus), /Plasma unavailable/);
  assert.equal(disconnected, true);
  assert.ok(fs.existsSync(target));
});
