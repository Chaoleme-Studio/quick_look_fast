const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

test('portable packager keeps numbered versions and assembles each platform', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'slowlook-pack-platforms-'));
  const script = fs.readFileSync(path.join(__dirname, '../scripts/pack-portable.cjs'), 'utf8');
  function write(root, name, content = '') {
    const filename = path.join(root, name); fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, content);
  }
  function fixture(platform) {
    const root = path.join(temp, platform); fs.mkdirSync(root);
    for (const file of ['build/dist/index.html', 'build/dist-electron/main.js', 'docs/readme.md', 'README.md', 'LICENSE', 'NOTICE', 'THIRD_PARTY.md', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tests/fixtures/README.md', '.github/workflows/release.yml',
      'patch/patch-flyfish-pptx.cjs', 'patch/patch-flyfish-docx.cjs', 'patch/flyfish-pptx-chart-fix.cjs', 'patch/patch-flyfish-xlsx.cjs', 'patch/flyfish-xlsx-row-fix.cjs',
      'electron/platform/linux/install.cjs', 'electron/platform/linux/install-portable.sh', 'public/branding/app.icns', 'public/branding/app.png',
      'docs/licenses/Arcade-Look-LICENSE', 'docs/licenses/UnRAR-LICENSE.txt']) write(root, file, 'fixture');
    write(root, 'package.json', JSON.stringify({ version: '0.1.0' }));
    for (const name of ['mime-types', 'node-unrar-js', 'officecrypto-tool', 'dbus-next', 'tiny-dep']) {
      write(root, `node_modules/${name}/package.json`, JSON.stringify({ name, version: '1.0.0', ...(name === 'dbus-next' ? { dependencies: { 'tiny-dep': '1.0.0' } } : {}) }));
    }
    if (platform === 'linux') write(root, 'node_modules/electron/dist/electron', 'runtime');
    else if (platform === 'win32') {
      write(root, 'node_modules/electron/dist/electron.exe', 'runtime');
      write(root, 'node_modules/electron/dist/electron_wer.dll', 'crash helper');
      write(root, 'build/native/windows/QuickLookFast.Bridge.exe', 'bridge');
    } else {
      write(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron', 'runtime');
      write(root, 'node_modules/electron/dist/Electron.app/Contents/Info.plist', 'plist');
      write(root, 'node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Helper.app/Contents/Info.plist', 'plist');
      write(root, 'node_modules/electron/dist/Electron.app/Contents/Resources/electron.icns', 'old icon');
    }
    const edits = [];
    const load = (name) => name === 'node:child_process' ? { execFileSync: (...args) => edits.push(args) } : require(name);
    load.resolve = require.resolve;
    const run = (version) => vm.runInNewContext(script, { require: load, __dirname: path.join(root, 'scripts'), process: { platform, arch: platform === 'darwin' ? 'arm64' : 'x64', argv: ['node', 'pack', ...(version ? [version] : [])], env: { SLOWLOOK_SKIP_ICON_EMBED: '1' } }, console: { log() {}, error() {} } });
    run();
    return { root, edits, run };
  }
  try {
    const linux = fixture('linux');
    const linuxOutput = path.join(linux.root, 'build/versions/V1');
    for (const file of ['quicklook-fast', 'install-integration.sh', 'resources/app/build/dist/index.html',
      'resources/app/build/dist-electron/platform/linux/install.cjs', 'resources/app/patch/patch-flyfish-docx.cjs',
      'resources/app/node_modules/dbus-next/package.json', 'resources/app/node_modules/tiny-dep/package.json']) {
      assert.ok(fs.existsSync(path.join(linuxOutput, file)), `missing Linux file ${file}`);
    }
    const mac = fixture('darwin');
    const bundle = path.join(mac.root, 'build/versions/V1/QuickLook Fast.app/Contents');
    for (const file of ['MacOS/QuickLook Fast', 'Resources/app/build/dist/index.html', 'Resources/app/LICENSE', 'Resources/electron.icns']) {
      assert.ok(fs.existsSync(path.join(bundle, file)), `missing macOS file ${file}`);
    }
    assert.equal(fs.readFileSync(path.join(bundle, 'Resources/electron.icns'), 'utf8'), 'fixture');
    assert.ok(mac.edits.some((call) => call[1][1] === 'Set :CFBundleExecutable "QuickLook Fast"'));
    assert.ok(mac.edits.some((call) => call[1][1] === 'Set :LSMinimumSystemVersion "26.0"'));
    assert.ok(mac.edits.some((call) => String(call[1][1]).includes('cn.chaoleme.quicklookfast.electron-helper-app')));
    const windows = fixture('win32');
    const winOutput = path.join(windows.root, 'build/versions/V1');
    for (const file of ['QuickLook Fast.exe', 'QuickLook Fast_wer.dll', 'resources/app/public/branding/app.png', 'resources/app/docs/licenses/UnRAR-LICENSE.txt']) {
      assert.ok(fs.existsSync(path.join(winOutput, file)), `missing Windows file ${file}`);
    }
    assert.throws(() => windows.run('V1'), /拒绝覆盖/);
    assert.throws(() => windows.run('../outside'), /版本目录/);
    windows.run();
    assert.ok(fs.existsSync(path.join(windows.root, 'build/versions/V2/QuickLook Fast.exe')));
  } finally {
    const relative = path.relative(os.tmpdir(), temp);
    if (!relative.startsWith('slowlook-pack-platforms-') || relative.includes('..') || path.isAbsolute(relative)) throw new Error('unsafe test cleanup path');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
