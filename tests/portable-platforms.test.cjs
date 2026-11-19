const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

test('portable packager assembles Linux dependencies and a macOS bundle', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'slowlook-pack-platforms-'));
  const script = fs.readFileSync(path.join(__dirname, '../scripts/pack-portable.cjs'), 'utf8');
  function write(root, name, content = '') {
    const filename = path.join(root, name); fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, content);
  }
  function fixture(platform) {
    const root = path.join(temp, platform); fs.mkdirSync(root);
    for (const file of ['dist/index.html', 'dist-electron/main.js', 'docs/readme.md', 'README.md', 'LICENSE', 'NOTICE', 'THIRD_PARTY.md',
      'scripts/patch-flyfish-pptx.cjs', 'scripts/patch-flyfish-docx.cjs', 'scripts/flyfish-pptx-chart-fix.cjs',
      'integrations/linux/install.cjs', 'integrations/linux/install-portable.sh', 'public/branding/app.icns',
      'third-party/Arcade-Look-LICENSE', 'third-party/UnRAR-LICENSE.txt']) write(root, file, 'fixture');
    write(root, 'package.json', JSON.stringify({ version: '0.1.0' }));
    for (const name of ['mime-types', 'node-unrar-js', 'officecrypto-tool', 'dbus-next', 'tiny-dep']) {
      write(root, `node_modules/${name}/package.json`, JSON.stringify({ name, version: '1.0.0', ...(name === 'dbus-next' ? { dependencies: { 'tiny-dep': '1.0.0' } } : {}) }));
    }
    if (platform === 'linux') write(root, 'node_modules/electron/dist/electron', 'runtime');
    else {
      write(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron', 'runtime');
      write(root, 'node_modules/electron/dist/Electron.app/Contents/Info.plist', 'plist');
      write(root, 'node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Helper.app/Contents/Info.plist', 'plist');
      write(root, 'node_modules/electron/dist/Electron.app/Contents/Resources/electron.icns', 'old icon');
    }
    const edits = [];
    const load = (name) => name === 'node:child_process' ? { execFileSync: (...args) => edits.push(args) } : require(name);
    load.resolve = require.resolve;
    vm.runInNewContext(script, { require: load, __dirname: path.join(root, 'scripts'), process: { platform, arch: platform === 'linux' ? 'x64' : 'arm64', argv: [], env: {} }, console: { log() {}, error() {} } });
    return { root, edits };
  }
  try {
    const linux = fixture('linux');
    const linuxOutput = path.join(linux.root, 'artifacts/QuickLook-Fast-linux-x64');
    for (const file of ['quicklook-fast', 'install-integration.sh', 'resources/app/dist/index.html',
      'resources/app/node_modules/dbus-next/package.json', 'resources/app/node_modules/tiny-dep/package.json']) {
      assert.ok(fs.existsSync(path.join(linuxOutput, file)), `missing Linux file ${file}`);
    }
    const mac = fixture('darwin');
    const bundle = path.join(mac.root, 'artifacts/QuickLook-Fast-mac-arm64/QuickLook Fast.app/Contents');
    for (const file of ['MacOS/QuickLook Fast', 'Resources/app/dist/index.html', 'Resources/app/LICENSE', 'Resources/electron.icns']) {
      assert.ok(fs.existsSync(path.join(bundle, file)), `missing macOS file ${file}`);
    }
    assert.equal(fs.readFileSync(path.join(bundle, 'Resources/electron.icns'), 'utf8'), 'fixture');
    assert.ok(mac.edits.some((call) => call[1][1] === 'Set :CFBundleExecutable "QuickLook Fast"'));
    assert.ok(mac.edits.some((call) => call[1][1] === 'Set :LSMinimumSystemVersion "26.0"'));
    assert.ok(mac.edits.some((call) => String(call[1][1]).includes('cn.chaoleme.quicklookfast.electron-helper-app')));
  } finally {
    const relative = path.relative(os.tmpdir(), temp);
    if (!relative.startsWith('slowlook-pack-platforms-') || relative.includes('..') || path.isAbsolute(relative)) throw new Error('unsafe test cleanup path');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
