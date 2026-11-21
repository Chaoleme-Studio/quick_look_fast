'use strict';

// Build the same small release inventory that the updater reads. Package
// digests and sizes come from the completed release's uploaded assets.
const fs = require('node:fs');

const targets = {
  'windows-x64': 'windows-x64.zip',
  'macos-arm64': 'macos-arm64.zip',
  'linux-x64': 'linux-x64.tar.gz',
  'linux-arm64': 'linux-arm64.tar.gz',
};

function createManifest(release, repository, tag) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
      !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag)) throw new Error('Invalid repository or stable release tag');
  const base = `https://github.com/${repository}/releases`;
  const notesUrl = `${base}/tag/${tag}`;
  if (!release || release.tag_name !== tag || release.draft !== false || release.prerelease !== false ||
      release.html_url !== notesUrl || !Array.isArray(release.assets) ||
      typeof release.published_at !== 'string' || !Number.isFinite(Date.parse(release.published_at))) {
    throw new Error('Invalid release metadata');
  }
  const assets = {};
  for (const [target, suffix] of Object.entries(targets)) {
    const name = `QuickLook-Fast-${tag}-${suffix}`;
    const matching = release.assets.filter((item) => item?.name === name);
    const asset = matching[0];
    const url = `${base}/download/${tag}/${name}`;
    if (matching.length !== 1 || asset.state !== 'uploaded' || asset.browser_download_url !== url ||
        !Number.isSafeInteger(asset.size) || asset.size <= 0 ||
        typeof asset.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) {
      throw new Error(`Release asset is missing or invalid: ${name}`);
    }
    assets[target] = { name, url, size: asset.size, sha256: asset.digest.slice('sha256:'.length) };
  }
  return { schema: 1, version: tag.slice(1), publishedAt: release.published_at, notesUrl, assets };
}

if (require.main === module) {
  try {
    const [input, output, repository, tag] = process.argv.slice(2);
    if (!input || !output || !repository || !tag) throw new Error('Usage: node scripts/create-update-manifest.cjs RELEASE_JSON OUTPUT REPOSITORY TAG');
    const manifest = createManifest(JSON.parse(fs.readFileSync(input, 'utf8')), repository, tag);
    fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'w' });
    console.log(`Created ${output} for ${tag}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = { createManifest };
