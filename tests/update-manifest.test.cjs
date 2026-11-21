'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createManifest } = require('../scripts/create-update-manifest.cjs');
const { checkForUpdates } = require('../build/dist-electron/support/update-checker.js');

const repo = 'Chaoleme-Studio/quick_look_fast';
const tag = 'v1.0.0';
const base = `https://github.com/${repo}/releases`;
function release() {
  return {
    tag_name: tag, draft: false, prerelease: false,
    html_url: `${base}/tag/${tag}`, published_at: '2026-11-21T08:45:35Z',
    assets: ['windows-x64.zip', 'macos-arm64.zip', 'linux-x64.tar.gz', 'linux-arm64.tar.gz'].map((suffix, i) => {
      const name = `QuickLook-Fast-${tag}-${suffix}`;
      return { name, state: 'uploaded', browser_download_url: `${base}/download/${tag}/${name}`, size: i + 1, digest: `sha256:${String(i).repeat(64)}` };
    }),
  };
}

test('release manifest contains the completed packages with their sizes and SHA-256 digests', () => {
  const manifest = createManifest(release(), repo, tag);
  assert.equal(manifest.schema, 1);
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.notesUrl, `${base}/tag/${tag}`);
  assert.deepEqual(Object.keys(manifest.assets), ['windows-x64', 'macos-arm64', 'linux-x64', 'linux-arm64']);
  assert.equal(manifest.assets['linux-arm64'].size, 4);
  assert.equal(manifest.assets['linux-arm64'].sha256, '3'.repeat(64));
  assert.equal(manifest.assets['macos-arm64'].url, `${base}/download/${tag}/QuickLook-Fast-${tag}-macos-arm64.zip`);
});

test('release manifest rejects unfinished, foreign, or inconsistent assets', () => {
  const candidates = [];
  const missing = release(); missing.assets.pop(); candidates.push(missing);
  const duplicate = release(); duplicate.assets.push(duplicate.assets[0]); candidates.push(duplicate);
  const badDigest = release(); badDigest.assets[0].digest = 'sha256:bad'; candidates.push(badDigest);
  const unuploaded = release(); unuploaded.assets[0].state = 'new'; candidates.push(unuploaded);
  const foreign = release(); foreign.assets[0].browser_download_url = 'https://example.invalid/installer'; candidates.push(foreign);
  const draft = release(); draft.draft = true; candidates.push(draft);
  for (const candidate of candidates) assert.throws(() => createManifest(candidate, repo, tag));
  assert.throws(() => createManifest(release(), repo, 'v1.0.0-rc.1'));
});

test('a previous version can discover the generated manifest for a newer release', async () => {
  const newer = JSON.parse(JSON.stringify(release()).replaceAll('v1.0.0', 'v1.1.0'));
  const manifest = createManifest(newer, repo, 'v1.1.0');
  const request = () => {
    const value = new EventEmitter();
    value.abort = () => {};
    value.end = () => queueMicrotask(() => value.emit('redirect', 302, 'HEAD', `${base}/tag/v1.1.0`));
    return value;
  };
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    return Response.json(manifest);
  };
  assert.deepEqual(await checkForUpdates('1.0.0', fetcher, request), {
    state: 'available', currentVersion: '1.0.0', latestVersion: '1.1.0',
  });
  assert.deepEqual(calls, [`${base}/download/v1.1.0/update.json`]);
});
