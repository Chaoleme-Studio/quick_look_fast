const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { fileResponse, parseRange } = require('../dist-electron/protocol.js');
const { startFileServer } = require('../dist-electron/file-server.js');

const directory = mkdtempSync(path.join(tmpdir(), 'slowlook-test-'));
const filePath = path.join(directory, 'sample.txt');
const emptyPath = path.join(directory, 'empty.txt');
writeFileSync(filePath, '0123456789');
writeFileSync(emptyPath, '');
after(() => {
  unlinkSync(filePath);
  unlinkSync(emptyPath);
  rmdirSync(directory);
});

test('reads whole files and single byte ranges', async () => {
  const whole = await fileResponse(new Request('https://local.test/sample'), filePath);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('content-length'), '10');
  assert.equal(await whole.text(), '0123456789');

  const range = await fileResponse(new Request('https://local.test/sample', { headers: { range: 'bytes=2-5' } }), filePath);
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(await range.text(), '2345');
  assert.deepEqual(parseRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.deepEqual(parseRange('bytes=7-', 10), { start: 7, end: 9 });
  assert.deepEqual(parseRange('bytes=8-999', 10), { start: 8, end: 9 });
});

test('handles HEAD, empty files, invalid ranges and missing paths', async () => {
  const head = await fileResponse(new Request('https://local.test/sample', { method: 'HEAD' }), filePath);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '10');
  assert.equal(await head.text(), '');
  const empty = await fileResponse(new Request('https://local.test/empty'), emptyPath);
  assert.equal(empty.status, 200);
  assert.equal(await empty.text(), '');
  for (const range of ['bytes=10-', 'bytes=3-1', 'bytes=0-1,4-5', 'bytes=-0']) {
    const response = await fileResponse(new Request('https://local.test/sample', { headers: { range } }), filePath);
    assert.equal(response.status, 416);
    assert.equal(response.headers.get('content-range'), 'bytes */10');
  }
  assert.equal((await fileResponse(new Request('https://local.test/missing'), path.join(directory, 'missing'))).status, 404);
  assert.equal((await fileResponse(new Request('https://local.test/sample', { method: 'POST' }), filePath)).status, 405);
});

test('local file server exposes only the active token and streams ranges', async () => {
  let active = { token: 'first-token', path: filePath };
  const progress = [];
  const { server, origin } = await startFileServer(() => active, (value) => progress.push(value));
  try {
    const url = `${origin}/preview/first-token/sample.txt`;
    const response = await fetch(url, { headers: { Range: 'bytes=4-7', Origin: 'slowlook://app' } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 4-7/10');
    assert.match(response.headers.get('access-control-expose-headers'), /Content-Range/i);
    assert.equal(await response.text(), '4567');
    assert.ok(progress.some((event) => event.phase === 'range'));
    assert.equal(progress.some((event) => event.phase === 'reading'), false, 'a partial range must not pretend to be whole-file progress');
    progress.length = 0;
    assert.equal(await (await fetch(url)).text(), '0123456789');
    assert.ok(progress.some((event) => event.phase === 'reading' && event.total === 10));
    for (let i = 0; i < 20 && !progress.some((event) => event.phase === 'parsing'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(progress.some((event) => event.phase === 'parsing'));
    assert.equal((await fetch(`${origin}/preview/wrong-token/sample.txt`)).status, 404);
    active = { token: 'second-token', path: emptyPath };
    assert.equal((await fetch(url)).status, 404);
    assert.equal((await fetch(`${origin}/preview/second-token/empty.txt`, { method: 'HEAD' })).headers.get('content-length'), '0');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
