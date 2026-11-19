const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readStartup, writeStartup } = require('../dist-electron/login-startup.js');

test('login startup is opt-in, targets the current executable and reports the OS state', () => {
  let enabled = false;
  const writes = [];
  const app = {
    getLoginItemSettings: (options) => {
      assert.deepEqual(options, { path: 'C:\\SlowLook\\SlowLook.exe', args: ['--service'] });
      return { openAtLogin: enabled };
    },
    setLoginItemSettings: (options) => { writes.push(options); enabled = options.openAtLogin; },
  };
  assert.equal(readStartup(app, 'win32', 'C:\\SlowLook\\SlowLook.exe', false).enabled, false);
  assert.equal(writes.length, 0, 'reading settings must not change startup');
  assert.equal(writeStartup(app, 'win32', 'C:\\SlowLook\\SlowLook.exe', false, true).enabled, true);
  assert.deepEqual(writes[0], { path: 'C:\\SlowLook\\SlowLook.exe', args: ['--service'], name: 'QuickLook Fast', openAtLogin: true });
  assert.equal(writeStartup(app, 'win32', 'C:\\SlowLook\\SlowLook.exe', false, false).enabled, false);
  assert.equal(readStartup(app, 'linux', '/app', false).supported, false);
  assert.equal(readStartup(app, 'win32', 'C:\\SlowLook\\SlowLook.exe', true).supported, false);
});

test('macOS startup reports when system approval is required', () => {
  const app = { getLoginItemSettings: () => ({ openAtLogin: false, status: 'requires-approval' }), setLoginItemSettings() {} };
  const state = writeStartup(app, 'darwin', '/Applications/SlowLook.app', false, true);
  assert.equal(state.enabled, false);
  assert.match(state.message, /允许/);
});
