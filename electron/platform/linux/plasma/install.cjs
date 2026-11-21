'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ID = 'com.chaolemestudio.quicklookfast.desktoppreview';
const LEGACY_FILES = ['metadata.json', 'contents/helper.cjs', 'contents/ui/main.qml'];
const FILES = [...LEGACY_FILES, 'contents/launch-helper.sh'];
const DIRS = ['contents', 'contents/ui'];
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const qmlString = (value) => JSON.stringify(value).replace(/[\u2028\u2029]/g, (character) => `\\u${character.charCodeAt(0).toString(16)}`);
const shellQuote = (value) => `'${value.replace(/'/g, "'\\''")}'`;

function destination(dataHome) {
  if (!path.isAbsolute(dataHome)) throw new Error('XDG_DATA_HOME must be absolute');
  return path.join(dataHome, 'plasma', 'plasmoids', ID);
}

function installPackage({ launcher, dataHome }) {
  if (!path.isAbsolute(launcher)) throw new Error('launcher must be an absolute path');
  fs.accessSync(launcher, fs.constants.X_OK);
  if (!fs.statSync(launcher).isFile()) throw new Error('launcher must be a file');
  const target = destination(dataHome);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // A directory, file, or symlink at the destination is never overwritten.
  fs.mkdirSync(target, { mode: 0o700 });
  try {
    fs.mkdirSync(path.join(target, 'contents/ui'), { recursive: true });
    const helper = path.join(target, 'contents/helper.cjs');
    const wrapper = path.join(target, 'contents/launch-helper.sh');
    const metadata = { KPackageStructure: 'Plasma/Applet', KPlugin: { Id: ID, Name: 'QuickLook Fast Desktop Preview',
      Description: 'Space preview for the Plasma desktop', Version: '0.1.0', License: 'Apache-2.0', Icon: 'document-preview' },
      'X-Plasma-API-Minimum-Version': '6.0' };
    fs.writeFileSync(path.join(target, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
    fs.copyFileSync(path.join(__dirname, 'helper.cjs'), helper);
    // QML can stay cached across reinstalls; this script is read anew on each keypress.
    fs.writeFileSync(wrapper, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${shellQuote(launcher)} ${shellQuote(helper)} "$@"\n`);
    const qml = fs.readFileSync(path.join(__dirname, 'main.qml'), 'utf8')
      .replace('@WRAPPER@', qmlString(wrapper));
    fs.writeFileSync(path.join(target, 'contents/ui/main.qml'), qml);
    const manifest = { owner: ID, launcher, files: Object.fromEntries(FILES.map((name) => [name, hash(path.join(target, name))])) };
    fs.writeFileSync(path.join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    throw error;
  }
  return target;
}

function verifyPackage(dataHome) {
  const target = destination(dataHome);
  const info = fs.lstatSync(target);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('widget package is not a real directory');
  const manifestFile = path.join(target, 'manifest.json');
  const manifestInfo = fs.lstatSync(manifestFile);
  if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink()) throw new Error('manifest is not a normal file');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const declared = Object.keys(manifest.files || {}).sort();
  const ownedFiles = [FILES, LEGACY_FILES].find((names) => JSON.stringify(declared) === JSON.stringify(names.slice().sort()));
  if (manifest.owner !== ID || !ownedFiles) {
    throw new Error('widget manifest does not match; leaving it unchanged');
  }
  const files = [], directories = [];
  function inspect(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = path.posix.join(prefix, entry.name), absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('widget contains a symlink; leaving it unchanged');
      if (entry.isDirectory()) { directories.push(relative); inspect(absolute, relative); }
      else if (entry.isFile()) files.push(relative);
      else throw new Error('widget contains an unusual entry; leaving it unchanged');
    }
  }
  inspect(target);
  if (JSON.stringify(files.sort()) !== JSON.stringify([...ownedFiles, 'manifest.json'].sort()) ||
      JSON.stringify(directories.sort()) !== JSON.stringify(DIRS.slice().sort()) ||
      ownedFiles.some((name) => manifest.files[name] !== hash(path.join(target, name)))) {
    throw new Error('widget package was modified; leaving it unchanged');
  }
  return target;
}

function removePackage(dataHome) {
  const target = verifyPackage(dataHome);
  fs.rmSync(target, { recursive: true });
  return target;
}

function ensurePackage({ launcher, dataHome }) {
  try {
    return { target: installPackage({ launcher, dataHome }), installed: true };
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const target = verifyPackage(dataHome);
    const manifest = JSON.parse(fs.readFileSync(path.join(target, 'manifest.json'), 'utf8'));
    if (manifest.launcher !== launcher) {
      throw new Error('Existing Plasma desktop integration belongs to a different launcher; remove it before reinstalling.');
    }
    if (!manifest.files['contents/launch-helper.sh']) {
      throw new Error('The older experimental Plasma widget must be removed and reinstalled; then restart Plasma or log out and back in to refresh its cached QML.');
    }
    return { target, installed: false };
  }
}

function activationScript() {
  return `(function() {
    const plugin = ${JSON.stringify(ID)};
    const result = { added: [], existing: [], skipped: [], errors: [] };
    for (const desktop of desktops()) {
      if (desktop.type !== 'org.kde.plasma.folder') continue;
      const id = desktop.id;
      if (desktop.widgets(plugin).length) { result.existing.push(id); continue; }
      if (desktop.screen < 0) { result.skipped.push(id); continue; }
      try {
        const widget = desktop.addWidget(plugin, 0, 0, 1, 1);
        if (!widget || typeof widget.id !== 'number') result.errors.push({ desktop: id, error: String(widget) });
        else result.added.push({ desktop: id, widget: widget.id });
      } catch (e) { result.errors.push({ desktop: id, error: String(e) }); }
    }
    print(JSON.stringify(result));
  })();`;
}

function removalScript() {
  return `(function() {
    const plugin = ${JSON.stringify(ID)};
    const result = { removed: [], errors: [] };
    for (const desktop of desktops()) {
      for (const widget of desktop.widgets(plugin)) {
        try { const id = widget.id; widget.remove(); result.removed.push({ desktop: desktop.id, widget: id }); }
        catch (e) { result.errors.push({ desktop: desktop.id, error: String(e) }); }
      }
    }
    print(JSON.stringify(result));
  })();`;
}

async function evaluateScript(code, dbus) {
  // A timeout prevents the CLI from hanging forever if the session bus disappears.
  const bus = dbus.sessionBus();
  let timer;
  try {
    const request = new dbus.Message({ destination: 'org.kde.plasmashell', path: '/PlasmaShell',
      interface: 'org.kde.PlasmaShell', member: 'evaluateScript', signature: 's', body: [code] });
    const result = await Promise.race([
      bus.call(request),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Plasma session bus timed out')), 10000); }),
    ]);
    return JSON.parse(result.body[0]);
  } finally { clearTimeout(timer); bus.disconnect(); }
}

async function enableExisting(dataHome, dbus) {
  verifyPackage(dataHome);
  const result = await evaluateScript(activationScript(), dbus);
  if (!Array.isArray(result.added) || !Array.isArray(result.existing) ||
      !Array.isArray(result.skipped) || !Array.isArray(result.errors)) {
    throw new Error('Plasma returned an invalid desktop integration result.');
  }
  return result;
}

async function uninstall(dataHome, dbus) {
  // Refuse to touch desktop configuration when the owned package was modified.
  verifyPackage(dataHome);
  const result = await evaluateScript(removalScript(), dbus);
  if (!Array.isArray(result.errors) || result.errors.length) throw new Error(`Could not remove every widget: ${JSON.stringify(result.errors)}`);
  removePackage(dataHome);
  return result;
}

module.exports = { ID, FILES, destination, installPackage, ensurePackage, verifyPackage, removePackage, activationScript, removalScript, evaluateScript, enableExisting, uninstall };
