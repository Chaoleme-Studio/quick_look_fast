const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('screenshot harness prepares five named captures from public or synthetic data', async () => {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'docs', 'screenshots');
  const captured = []; const events = []; const expressions = []; const handlers = new Map(); let resolveDone, rejectDone, updatedReadme, stagedReadme;
  const finished = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  const app = { setPath(_name, value) { assert.ok(fs.statSync(value).isDirectory()); }, whenReady: () => Promise.resolve(), quit: resolveDone, exit: () => rejectDone(new Error('capture script failed')) };
  class BrowserWindow {
    constructor() { this.webContents = { executeJavaScript: async (expression) => { expressions.push(expression); return true; }, send: (...args) => events.push(args) }; }
    async loadURL() {} showInactive() {} async capturePage() { return { isEmpty: () => false, toPNG: () => Buffer.from('test only') }; } destroy() {}
  }
  const electron = { app, BrowserWindow, protocol: { registerSchemesAsPrivileged() {}, handle() {} }, ipcMain: { handle: (name, fn) => handlers.set(name, fn) } };
  const fakeFs = { ...fs, writeFileSync(filename, data, ...args) {
    if (path.dirname(filename) === output && filename.endsWith('.png')) { captured.push(path.basename(filename)); return; }
    if (path.dirname(filename) === root && path.basename(filename).startsWith('.README-screenshots-')) { stagedReadme = String(data); return; }
    return fs.writeFileSync(filename, data, ...args);
  }, renameSync(from, to) {
    if (to === path.join(root, 'README.md') && path.basename(from).startsWith('.README-screenshots-')) { updatedReadme = stagedReadme; return; }
    return fs.renameSync(from, to);
  } };
  const load = (name) => {
    if (name === 'electron') return electron;
    if (name === 'node:fs') return fakeFs;
    const filename = name.replaceAll('\\', '/');
    if (filename.endsWith('dist-electron/files/file-server.js')) return { startFileServer: async () => ({ server: { close() {} }, origin: 'http://127.0.0.1:12345' }) };
    if (filename.endsWith('dist-electron/files/protocol.js')) return { fileResponse() {} };
    return require(name);
  };
  const source = fs.readFileSync(path.join(root, 'tools', 'screenshots', 'capture.cjs'), 'utf8');
  vm.runInNewContext(source, { require: load, __dirname: path.join(root, 'tools', 'screenshots'), Buffer, setTimeout, console: { log() {}, error: rejectDone }, process });
  await finished;
  assert.deepEqual(captured, ['welcome.png', 'settings.png', 'folder.png', 'pdf.png', 'pptx.png']);
  assert.match(updatedReadme, /!\[文件夹预览\]\(docs\/screenshots\/folder\.png\)/);
  assert.match(updatedReadme, /!\[PPTX 预览\]\(docs\/screenshots\/pptx\.png\)/);
  assert.ok(events.some(([name, payload]) => name === 'capture-directory' && payload.name.includes('演示')));
  assert.ok(expressions.some((value) => value.includes('#file-name') && value.includes('sample.pdf')), 'capture waits for the requested document');
  assert.ok(expressions.some((value) => value.includes('.textLayer') && value.includes('QuickLook Fast')), 'PDF capture waits for rendered text');
  const sample = await handlers.get('capture-read-directory')(null, 'demo-root');
  assert.equal(handlers.get('capture-app-version')(), require('../package.json').version);
  assert.ok(sample.entries.some((item) => item.id === 'sample-pptx'));
  assert.equal(fs.readFileSync(path.join(root, '.local/cache/screenshot-demo/sample.pdf')).subarray(0, 5).toString(), '%PDF-');
});
