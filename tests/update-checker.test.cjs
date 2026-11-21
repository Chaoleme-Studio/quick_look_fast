'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { compareVersions, checkForUpdates } = require('../build/dist-electron/support/update-checker.js');

const page = 'https://github.com/Chaoleme-Studio/quick_look_fast/releases/latest';
const api = 'https://api.github.com/repos/Chaoleme-Studio/quick_look_fast/releases/latest';
const release = (tag) => `https://github.com/Chaoleme-Studio/quick_look_fast/releases/tag/${tag}`;
const manifestUrl = (tag) => `https://github.com/Chaoleme-Studio/quick_look_fast/releases/download/${tag}/update.json`;
const failure = (currentVersion = '0.1.2') => ({ state: 'error', currentVersion, message: '检查更新失败，请稍后重试。' });

function network(behavior) {
  const requests = [];
  const factory = (options) => {
    const request = new EventEmitter();
    request.options = options;
    request.aborted = false;
    request.abort = () => { request.aborted = true; };
    request.end = () => { queueMicrotask(() => behavior(request)); };
    requests.push(request);
    return request;
  };
  return { requests, factory };
}
function redirect(location = release('v1.0.0'), status = 302, method = 'HEAD') {
  return network((request) => request.emit('redirect', status, method, location, {}));
}
const failedRequest = () => network((request) => request.emit('error', new Error('network unavailable')));
function apiResponse(tag = 'v1.0.0', extra = {}) {
  return new Response(JSON.stringify({ tag_name: tag, html_url: release(tag), draft: false, prerelease: false, ...extra }));
}

test('update versions follow semver, including prereleases', () => {
  for (const [a, b, result] of [['v0.2.0', '0.1.9', 1], ['1.0.0', '1.0.0-rc.1', 1], ['1.0.0-rc.2', '1.0.0-rc.10', -1], ['2.0.0', '2.0.0+build', 0], ['bogus', '1.0.0', undefined]]) {
    assert.equal(compareVersions(a, b), result, `${a} compared with ${b}`);
  }
});

test('the official release redirect is checked without following it or spending API quota', async () => {
  // Electron can emit the writable request's close event before its network
  // redirect arrives; it must not be interpreted as a failed lookup.
  const primary = network((request) => {
    request.emit('close');
    request.emit('redirect', 302, 'HEAD', release('v1.0.0'), {});
  });
  const unusedApi = async (url) => {
    assert.equal(url, manifestUrl('v1.0.0'));
    return new Response('', { status: 404 }); // Already-published releases have no manifest.
  };
  assert.deepEqual(await checkForUpdates('0.3.0', unusedApi, primary.factory), { state: 'available', currentVersion: '0.3.0', latestVersion: '1.0.0' });
  assert.deepEqual(await checkForUpdates('1.0.0', unusedApi, primary.factory), { state: 'up-to-date', currentVersion: '1.0.0', latestVersion: '1.0.0' });
  assert.deepEqual(await checkForUpdates('1.0.0-rc.1', unusedApi, primary.factory), { state: 'available', currentVersion: '1.0.0-rc.1', latestVersion: '1.0.0' });
  for (const request of primary.requests) {
    assert.equal(request.options.url, page);
    assert.equal(request.options.method, 'HEAD');
    assert.equal(request.options.partition, 'quicklook-fast-update');
    assert.equal(request.options.credentials, 'omit');
    assert.equal(request.options.cache, 'no-store');
    assert.equal(request.options.redirect, 'manual');
    assert.equal(request.aborted, true, 'the destination is never followed');
  }
});

test('an unavailable page falls back to an independently verified release API', async () => {
  const unavailable = failedRequest();
  let requests = 0;
  const fetcher = async (url, options) => {
    if (url === manifestUrl('v1.0.0')) return new Response('', { status: 404 });
    requests++;
    assert.equal(url, api);
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    return apiResponse();
  };
  assert.deepEqual(await checkForUpdates('0.3.0', fetcher, unavailable.factory), { state: 'available', currentVersion: '0.3.0', latestVersion: '1.0.0' });
  assert.equal(requests, 1);
});

test('the version manifest is read and validated without sending credentials', async () => {
  const calls = [];
  const tag = 'v1.0.0';
  const name = 'QuickLook-Fast-v1.0.0-macos-arm64.zip';
  const manifest = {
    schema: 1, version: '1.0.0', notesUrl: release(tag),
    assets: { 'macos-arm64': { name, url: `https://github.com/Chaoleme-Studio/quick_look_fast/releases/download/${tag}/${name}`, size: 123, sha256: 'a'.repeat(64) } },
  };
  const fetcher = async (url, options) => {
    calls.push({ url, credentials: options.credentials, redirect: options.redirect });
    return Response.json(manifest);
  };
  assert.deepEqual(await checkForUpdates('0.3.0', fetcher, redirect().factory), { state: 'available', currentVersion: '0.3.0', latestVersion: '1.0.0' });
  assert.deepEqual(calls, [{ url: manifestUrl(tag), credentials: 'omit', redirect: 'follow' }]);
  const invalid = [
    { ...manifest, version: '2.0.0' },
    { ...manifest, notesUrl: release('v2.0.0') },
    { ...manifest, schema: 2 },
    { ...manifest, assets: {} },
    { ...manifest, assets: { 'macos-arm64': { ...manifest.assets['macos-arm64'], sha256: 'wrong' } } },
    { ...manifest, assets: { 'macos-arm64': { ...manifest.assets['macos-arm64'], url: 'https://example.invalid/file.zip' } } },
  ];
  for (const value of invalid) {
    assert.deepEqual(await checkForUpdates('0.3.0', async () => Response.json(value), redirect().factory), failure('0.3.0'));
  }
  assert.deepEqual(await checkForUpdates('0.3.0', async () => new Response('{bad json'), redirect().factory), failure('0.3.0'));
  assert.deepEqual(await checkForUpdates('0.3.0', async () => { throw new Error('manifest offline'); }, redirect().factory), { state: 'available', currentVersion: '0.3.0', latestVersion: '1.0.0' });
});

test('redirects to other hosts, repositories, protocols, or invalid versions never become update results', async () => {
  for (const location of [
    'http://github.com/Chaoleme-Studio/quick_look_fast/releases/tag/v1.0.0',
    'https://github.com.evil.invalid/Chaoleme-Studio/quick_look_fast/releases/tag/v1.0.0',
    'https://someone@github.com/Chaoleme-Studio/quick_look_fast/releases/tag/v1.0.0',
    'https://github.com:444/Chaoleme-Studio/quick_look_fast/releases/tag/v1.0.0',
    'https://github.com/other/quick_look_fast/releases/tag/v1.0.0',
    'https://github.com/Chaoleme-Studio/quick_look_fast/releases/tag/v1.0.0?download=1',
    'https://github.com/Chaoleme-Studio/quick_look_fast/releases/tag/v1.0.0#download',
    'https://github.com/Chaoleme-Studio/quick_look_fast/releases/tag/v1.0.0-rc.1',
    'https://github.com/Chaoleme-Studio/quick_look_fast/releases/tag/not-a-version',
    'https://github.com/Chaoleme-Studio/quick_look_fast/releases/tag/v1.0.0%2Fextra',
  ]) {
    const primary = redirect(location);
    const result = await checkForUpdates('0.1.2', async () => new Response('', { status: 403 }), primary.factory);
    assert.deepEqual(result, failure(), location);
    assert.equal(primary.requests[0].aborted, true);
  }
  for (const [status, method] of [[200, 'HEAD'], [302, 'GET']]) {
    const primary = redirect(release('v1.0.0'), status, method);
    assert.deepEqual(await checkForUpdates('0.1.2', async () => new Response('', { status: 429 }), primary.factory), failure());
  }
});

test('API metadata must describe the same official, non-draft stable release', async () => {
  const invalidResponses = [
    () => apiResponse('v1.0.0', { html_url: 'https://example.invalid/releases/tag/v1.0.0' }),
    () => apiResponse('v1.0.0', { html_url: release('v2.0.0') }),
    () => apiResponse('v1.0.0', { draft: true }),
    () => apiResponse('v1.0.0', { prerelease: true }),
    () => apiResponse('v1.0.0-rc.1'),
    () => new Response('{"tag_name":"v1.0.0"}'),
    () => new Response('{not json}'),
    () => new Response('a'.repeat(256 * 1024 + 1)),
    () => new Response('', { status: 404 }),
    () => new Response('', { status: 403 }),
    () => new Response('', { status: 429 }),
  ];
  for (const response of invalidResponses) {
    assert.deepEqual(await checkForUpdates('0.1.2', async () => response(), failedRequest().factory), failure());
  }
  assert.deepEqual(await checkForUpdates('0.1.2', async () => { throw new Error('GitHub unavailable'); }, failedRequest().factory), failure());
  assert.deepEqual(await checkForUpdates('not-semver', async () => apiResponse(), redirect().factory), failure('not-semver'));
});

test('a stalled redirect is cancelled and the API can still answer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let started = false;
  const stalled = network(() => { started = true; });
  const pending = checkForUpdates('0.3.0', async (url) => url === api ? apiResponse() : new Response('', { status: 404 }), stalled.factory);
  while (!started) await Promise.resolve();
  t.mock.timers.tick(7_000);
  assert.deepEqual(await pending, { state: 'available', currentVersion: '0.3.0', latestVersion: '1.0.0' });
  assert.equal(stalled.requests[0].aborted, true);
});
