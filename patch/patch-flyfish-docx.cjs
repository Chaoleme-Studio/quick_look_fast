'use strict';

// Flyfish's worker permits JSZip on same-origin HTTP(S) only. QuickLook Fast has a
// privileged, local-only slowlook://app scheme. Permit precisely the bundled
// JSZip asset on that scheme, without loosening the normal HTTP(S) checks.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const version = require(path.join(root, 'node_modules', '@file-viewer', 'renderer-word', 'package.json')).version;
if (version !== '3.3.4') throw new Error(`Reassess the DOCX worker patch for Flyfish ${version}.`);
const filename = path.join(root, 'build', 'dist', 'file-viewer', 'vendor', 'docx', 'docx.worker.js');
let source = fs.readFileSync(filename, 'utf8');
const before = 'if (!["http:", "https:", "blob:"].includes(libraryUrl.protocol)\n\t        || workerLocation.origin === "null" || libraryUrl.origin !== workerLocation.origin\n\t        || libraryOriginUrl.username || libraryOriginUrl.password)';
const after = 'if (!(workerLocation.protocol === "slowlook:" && workerLocation.host === "app" && libraryUrl.protocol === "slowlook:" && libraryUrl.host === "app" && libraryUrl.pathname === "/file-viewer/vendor/docx/jszip.min.js" && !libraryUrl.username && !libraryUrl.password) &&\n\t        (!["http:", "https:", "blob:"].includes(libraryUrl.protocol)\n\t        || workerLocation.origin === "null" || libraryUrl.origin !== workerLocation.origin\n\t        || libraryOriginUrl.username || libraryOriginUrl.password))';
if (!source.includes(after)) {
  if (source.split(before).length !== 2) throw new Error('Flyfish DOCX worker URL validation changed; reassess this patch.');
  source = source.replace(before, after);
  source = '/* QuickLook Fast modified URL validation for its local bundled JSZip; see THIRD_PARTY.md. */\n' + source;
}
fs.writeFileSync(filename, source);
console.log('Applied local-only Flyfish DOCX worker URL repair.');
