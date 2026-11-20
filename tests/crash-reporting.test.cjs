'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { enableLocalCrashReports } = require('../build/dist-electron/support/crash-reporting.js');

test('native crash dumps are local and collected only when explicitly enabled', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quicklook-diagnostics-'));
  const calls = [];
  const app = { getPath: () => directory, setPath: (...args) => calls.push(args) };
  const reporter = { start: (options) => calls.push(options) };
  try {
    assert.equal(enableLocalCrashReports(app, reporter, []), false);
    assert.deepEqual(calls, []);
    assert.equal(enableLocalCrashReports(app, reporter, ['--diagnostics']), true);
    assert.deepEqual(calls[0], ['crashDumps', path.join(directory, 'crash-dumps')]);
    assert.equal(calls[1].uploadToServer, false);
    assert.ok(fs.statSync(calls[0][1]).isDirectory());
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
