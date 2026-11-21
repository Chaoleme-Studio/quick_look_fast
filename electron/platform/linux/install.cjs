#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function quoteExec(program) {
  if (!path.isAbsolute(program) || /[\r\n\0]/.test(program)) throw new Error('launcher must be an absolute path without line breaks');
  // Desktop entry escaping is performed before Exec argument parsing.
  return '"' + program.replace(/\\/g, '\\\\\\\\').replace(/(["`$])/g, '\\\\$1').replace(/%/g, '%%') + '"';
}

function quoteServiceExec(program) {
  if (!path.isAbsolute(program) || /[\r\n\0]/.test(program)) throw new Error('launcher must be an absolute path without line breaks');
  // D-Bus activation does not expand Desktop Entry field codes such as %u or %%.
  return '"' + program.replace(/[\\"]/g, '\\$&') + '"';
}

function entries(launcher, includeGnome) {
  const exec = quoteExec(launcher);
  const result = {
    'kio/servicemenus/quicklook-fast.desktop': `[Desktop Entry]\nType=Service\nMimeType=all/allfiles;inode/directory;\nActions=quicklookFastPreview;\nX-KDE-Priority=TopLevel\n\n[Desktop Action quicklookFastPreview]\nName=QuickLook Fast 预览\nName[en]=Preview with QuickLook Fast\nIcon=document-preview\nExec=${exec} -- %u\n`,
    'nemo/actions/quicklook-fast.nemo_action': `[Nemo Action]\nName=QuickLook Fast 预览\nComment=Preview the selected file with QuickLook Fast\nExec=${exec} -- %F\nIcon-Name=document-preview\nSelection=s\nExtensions=any;\n`,
  };
  if (includeGnome) result['dbus-1/services/org.gnome.NautilusPreviewer.service'] = `[D-BUS Service]\nName=org.gnome.NautilusPreviewer\nExec=${quoteServiceExec(launcher)} --service\n`;
  return result;
}

function install({ launcher, dataHome, includeGnome = false }) {
  if (!fs.existsSync(launcher) || !fs.statSync(launcher).isFile()) throw new Error('launcher file does not exist');
  const installed = [];
  const existing = [];
  for (const [relative, content] of Object.entries(entries(launcher, includeGnome))) {
    const target = path.join(dataHome, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    try {
      fs.writeFileSync(target, content, { flag: 'wx', mode: relative.startsWith('kio/servicemenus/') ? 0o755 : 0o644 });
      installed.push(target);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      existing.push(target);
    }
  }
  return { installed, existing };
}

async function run(args) {
  if (process.platform !== 'linux') throw new Error('Run this installer on Linux.');
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  if (args.includes('--remove-plasma-desktop')) {
    if (args.includes('--plasma-desktop') || args.includes('--gnome')) throw new Error('Use --remove-plasma-desktop separately.');
    const plasma = require('./plasma/install.cjs');
    const result = await plasma.uninstall(dataHome, require('dbus-next'));
    console.log(`Removed experimental Plasma desktop widgets: ${result.removed.length}`);
    return;
  }

  const launcherIndex = args.indexOf('--launcher');
  if (launcherIndex < 0 || !args[launcherIndex + 1]) throw new Error('Usage: node electron/platform/linux/install.cjs --launcher /absolute/path/to/quicklook-fast [--gnome] [--plasma-desktop]');
  const launcher = args[launcherIndex + 1];
  const result = install({ launcher, dataHome, includeGnome: args.includes('--gnome') });
  for (const target of result.installed) console.log(`Installed: ${target}`);
  for (const target of result.existing) console.log(`Already exists; left unchanged: ${target}`);
  if (args.includes('--gnome')) console.log('GNOME service installed when absent. Restart Files if it does not detect the service. A running previewer is not replaced.');
  console.log('Dolphin 26.04+: assign Space to the QuickLook Fast context-menu action in Dolphin keyboard settings.');

  if (args.includes('--plasma-desktop')) {
    const plasma = require('./plasma/install.cjs');
    const widget = plasma.ensurePackage({ launcher, dataHome });
    console.log(`${widget.installed ? 'Installed' : 'Using existing'} experimental Plasma desktop widget: ${widget.target}`);
    const desktops = await plasma.enableExisting(dataHome, require('dbus-next'));
    console.log(`Plasma desktop integration: ${JSON.stringify(desktops)}`);
    if (desktops.errors.length) throw new Error('Some desktops could not add the widget. Run this command again after resolving the errors.');
    if (!desktops.added.length && !desktops.existing.length) console.warn('No active Plasma Folder View desktop was found; run this command again from such a desktop.');
    if (desktops.skipped.length) console.warn('Inactive desktops were skipped; rerun this command when those activities are active.');
    console.warn('Experimental: Plasma desktop preview relies on private Plasma APIs. If they are unavailable, Space remains unchanged.');
    console.warn('After upgrading or reinstalling the widget, restart Plasma or log out and back in to refresh cached widget code.');
  }
}

if (require.main === module) {
  run(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { quoteExec, entries, install };
