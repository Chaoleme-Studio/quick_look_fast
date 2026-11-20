'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { recordDiagnostic } = require('../build/dist-electron/support/diagnostics.js');

test('diagnostics record bounded process status without file paths or arbitrary messages', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quicklook-log-'));
  try {
    recordDiagnostic(root, 'renderer-gone', { reason: 'crashed', exitCode: -1, message: 'private/path' });
    const log = path.join(root, 'logs', 'diagnostics.log');
    const first = fs.readFileSync(log, 'utf8');
    assert.match(first, /renderer-gone/);
    assert.doesNotMatch(first, /private|path/);
    fs.writeFileSync(log, 'x'.repeat(256 * 1024 + 1));
    recordDiagnostic(root, 'bridge-failed', { reason: 'EPIPE' });
    assert.ok(fs.statSync(log).size < 1024, 'the local log cannot grow without bound');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
