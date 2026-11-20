'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions, checkForUpdates } = require('../build/dist-electron/support/update-checker.js');

test('update versions follow semver, including prereleases', () => {
  for (const [a, b, result] of [['v0.2.0', '0.1.9', 1], ['1.0.0', '1.0.0-rc.1', 1], ['1.0.0-rc.2', '1.0.0-rc.10', -1], ['2.0.0', '2.0.0+build', 0], ['bogus', '1.0.0', undefined]]) {
    assert.equal(compareVersions(a, b), result, `${a} compared with ${b}`);
  }
});

test('manual checks use the official release API and report the result', async () => {
  let requests = 0;
  const fetcher = async (url, options) => {
    requests++;
    assert.equal(url, 'https://api.github.com/repos/Chaoleme-Studio/quick_look_fast/releases/latest');
    assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify({ tag_name: 'v0.2.0', html_url: 'https://example.invalid/' }));
  };
  assert.deepEqual(await checkForUpdates('0.1.2', fetcher), { state: 'available', currentVersion: '0.1.2', latestVersion: '0.2.0' });
  assert.deepEqual(await checkForUpdates('0.2.0', fetcher), { state: 'up-to-date', currentVersion: '0.2.0', latestVersion: '0.2.0' });
  assert.equal(requests, 2);
});

test('manual checks handle missing releases, throttling, invalid data and network failure', async () => {
  for (const [fetcher, text] of [
    [async () => new Response('', { status: 404 }), /没有可用/],
    [async () => new Response('', { status: 403 }), /请求受限/],
    [async () => new Response(JSON.stringify({ tag_name: 'invalid' })), /版本号/],
    [async () => { throw new TypeError('connection failed'); }, /无法连接/],
    [async () => new Response('a'.repeat(256 * 1024 + 1)), /过大/],
  ]) {
    const result = await checkForUpdates('0.1.2', fetcher);
    assert.equal(result.state, 'error');
    assert.match(result.message, text);
  }
});
