'use strict';
const fs = require('node:fs');
const path = require('node:path');

// The spreadsheet Worker is copied as a static asset, so the Vite transform
// cannot reach its customHeight scanner. Keep explicit heights fixed here.
const root = path.resolve(__dirname, '..');
const version = require(path.join(root, 'node_modules', '@file-viewer', 'renderer-spreadsheet', 'package.json')).version;
if (version !== '3.3.4') throw new Error(`Reassess the spreadsheet row-height patch for Flyfish ${version}.`);
const worker = path.join(root, 'build', 'dist', 'file-viewer', 'vendor', 'xlsx', 'sheet.worker.js');
let source = fs.readFileSync(worker, 'utf8');
const before = 'h.customHeight!==void 0&&!/^(?:0|false)$/i.test(h.customHeight)&&!g||m&&!g';
const after = 'h.customHeight!==void 0&&!/^(?:0|false)$/i.test(h.customHeight)||m&&!g';
if (!source.includes(after)) {
  if (source.split(before).length !== 2) throw new Error('Flyfish customHeight scanner changed; reassess the spreadsheet row-height repair.');
  source = source.replace(before, after);
  source = '/* QuickLook Fast modified the Flyfish spreadsheet Worker: preserve manually fixed row heights; see THIRD_PARTY.md and patch/patch-flyfish-xlsx.cjs. */\n' + source;
  fs.writeFileSync(worker, source);
}
