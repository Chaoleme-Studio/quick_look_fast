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

if (require.main === module) {
  try {
    if (process.platform !== 'linux') throw new Error('Run this installer on Linux.');
    const args = process.argv.slice(2);
    const launcherIndex = args.indexOf('--launcher');
    if (launcherIndex < 0 || !args[launcherIndex + 1]) throw new Error('Usage: node integrations/linux/install.cjs --launcher /absolute/path/to/quicklook-fast [--gnome]');
    const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
    const result = install({ launcher: args[launcherIndex + 1], dataHome, includeGnome: args.includes('--gnome') });
    for (const target of result.installed) console.log(`Installed: ${target}`);
    for (const target of result.existing) console.log(`Already exists; left unchanged: ${target}`);
    if (args.includes('--gnome')) console.log('GNOME service installed when absent. Restart Files if it does not detect the service. A running previewer is not replaced.');
    console.log('Dolphin 26.04+: assign Space to the QuickLook Fast context-menu action in Dolphin keyboard settings.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { quoteExec, entries, install };
