'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('desktop IPC bridge is exposed only to the main frame', () => {
  const code = fs.readFileSync(path.join(__dirname, '../build/dist-electron/preload.js'), 'utf8');
  function run(isMainFrame) {
    const exposed = [];
    const electron = { contextBridge: { exposeInMainWorld: (...args) => exposed.push(args) }, ipcRenderer: {}, webUtils: {} };
    vm.runInNewContext(code, { exports: {}, require: (name) => name === 'electron' ? electron : require(name), process: { isMainFrame, platform: 'win32' } });
    return exposed;
  }
  assert.equal(run(false).length, 0);
  assert.equal(run(true)[0][0], 'slowLook');
});
