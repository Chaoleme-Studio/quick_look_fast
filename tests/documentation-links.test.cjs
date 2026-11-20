'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function checkLinks(root) {
  const documents = ['README.md', 'THIRD_PARTY.md', ...fs.readdirSync(path.join(root, 'docs'))
    .filter((name) => name.endsWith('.md')).map((name) => `docs/${name}`)];
  for (const document of documents) {
    const content = fs.readFileSync(path.join(root, document), 'utf8').replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
    for (const match of content.matchAll(/(!?)\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)) {
      const target = match[2];
      if (/^(?:https?:|mailto:|#)/i.test(target)) continue;
      const relative = decodeURIComponent(target.split('#')[0]);
      if (!relative) continue;
      const resolved = path.resolve(root, path.dirname(document), relative);
      assert.ok(fs.existsSync(resolved), `${document}: missing ${target}`);
      if (match[1] === '!' && relative.toLowerCase().endsWith('.png')) {
        assert.equal(fs.readFileSync(resolved).subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${document}: invalid PNG ${target}`);
      }
    }
  }
}

test('local documentation links and README images exist', () => checkLinks(path.resolve(__dirname, '..')));
test('portable documentation keeps all local links and README images', { skip: !process.env.SLOWLOOK_PORTABLE_DIST }, () => {
  checkLinks(path.resolve(process.env.SLOWLOOK_PORTABLE_DIST, '../..'));
});
