'use strict';

const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { spawn } = require('node:child_process');

function decodeArg(value) {
  if (typeof value !== 'string' || value.length > 131072) throw new Error('invalid encoded argument');
  return decodeURIComponent(value);
}

function selectedPath(uri, desktopRoot) {
  if (typeof uri !== 'string' || uri.includes('\0')) throw new Error('invalid URL');
  if (/^file:/i.test(uri)) {
    if (!/^file:\/(?!\/)/i.test(uri) && !/^file:\/\/(?:localhost)?\//i.test(uri)) {
      throw new Error('only absolute local file URLs are supported');
    }
    const parsed = new URL(uri);
    if (parsed.protocol !== 'file:' || (parsed.hostname !== '' && parsed.hostname !== 'localhost') || parsed.search || parsed.hash) {
      throw new Error('only local file URLs without query or fragment are supported');
    }
    const selected = fileURLToPath(parsed);
    if (!selected.startsWith('/') || selected.includes('\0')) throw new Error('invalid absolute local path');
    return selected;
  }
  if (!/^desktop:\/(?!\/)/i.test(uri) || uri.includes('?') || uri.includes('#')) throw new Error('unsupported URL');
  if (typeof desktopRoot !== 'string' || !desktopRoot.startsWith('/') || desktopRoot.includes('\0')) throw new Error('invalid desktop folder');
  const encodedRelative = uri.slice('desktop:/'.length);
  if (/%2f/i.test(encodedRelative)) throw new Error('encoded path separators are not supported');
  const relative = decodeURIComponent(encodedRelative);
  if (!relative || relative.startsWith('/') || relative.includes('\0') || relative.split('/').some(part => part === '.' || part === '..')) {
    throw new Error('invalid desktop item path');
  }
  return path.posix.join(desktopRoot, relative);
}

function openFromArgs(args, options = {}) {
  if (args.length !== 2) throw new Error('expected encoded item URL and desktop folder');
  const selected = selectedPath(decodeArg(args[0]), decodeArg(args[1]));
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const child = (options.spawn || spawn)(options.launcher || process.execPath, ['--', selected], {
    env: environment, detached: true, stdio: 'ignore',
  });
  // Failures are logged by the Plasma executable engine. The GUI process itself is detached.
  child.on('error', (error) => { console.error(`QuickLook Fast failed to start: ${error.message}`); process.exitCode = 1; });
  child.unref();
  return selected;
}

if (require.main === module) {
  try { openFromArgs(process.argv.slice(2)); }
  catch (error) { console.error(`QuickLook Fast desktop helper: ${error.message}`); process.exitCode = 1; }
}

module.exports = { decodeArg, selectedPath, openFromArgs };
