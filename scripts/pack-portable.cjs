const fs = require('node:fs');
const path = require('node:path');

const supported = (process.platform === 'win32' && process.arch === 'x64') ||
  (process.platform === 'linux' && ['x64', 'arm64'].includes(process.arch)) ||
  (process.platform === 'darwin' && process.arch === 'arm64');
if (!supported) {
  console.error('只支持在目标系统上构建 Windows x64、Linux x64/arm64 或 macOS arm64。');
  process.exit(1);
}

const root = fs.realpathSync(path.resolve(__dirname, '..'));
const build = path.join(root, 'build');
const versions = path.join(build, 'versions');
const target = `${process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux'}-${process.arch}`;
for (const directory of [build, versions]) {
  if (fs.existsSync(directory) && fs.realpathSync(directory).toLowerCase() !== directory.toLowerCase()) {
    throw new Error(`构建目录不能是链接: ${directory}`);
  }
}
const existing = fs.existsSync(versions) ? fs.readdirSync(versions) : [];
const highest = existing.reduce((value, name) => /^V[1-9]\d{0,5}$/.test(name) ? Math.max(value, Number(name.slice(1))) : value, 0);
const directoryName = process.argv[2] || `V${highest + 1}`;
if (!/^V[1-9]\d{0,5}$/.test(directoryName)) throw new Error('版本目录应为 V1、V2 等格式');
const output = path.join(versions, directoryName);
if (fs.existsSync(output)) throw new Error(`版本目录已存在，拒绝覆盖: ${output}`);

const electron = path.join(root, 'node_modules', 'electron', 'dist');
const bridge = path.join(build, 'native', 'windows', 'QuickLookFast.Bridge.exe');
const finderBridge = path.join(build, 'native', 'macos', 'QuickLookFast.FinderBridge');
const iconEditor = path.join(build, 'native', 'windows', 'QuickLookFast.IconEditor.exe');
const icon = path.join(root, 'public', 'branding', 'app.ico');
const platformFiles = process.platform === 'win32' ? [bridge] : process.platform === 'darwin' ? [finderBridge] : [];
for (const required of [electron, ...platformFiles, path.join(build, 'dist', 'index.html'), path.join(build, 'dist-electron', 'main.js')]) {
  if (!fs.existsSync(required)) throw new Error(`构建文件缺失: ${required}`);
}

fs.mkdirSync(versions, { recursive: true });
fs.mkdirSync(output);
if (process.platform === 'darwin') {
  const bundle = path.join(output, 'QuickLook Fast.app');
  // Electron.app frameworks contain relative links; preserve the links as-is
  // so the archive never points back into the CI runner's node_modules.
  fs.cpSync(path.join(electron, 'Electron.app'), bundle, { recursive: true, verbatimSymlinks: true });
  const macos = path.join(bundle, 'Contents', 'MacOS');
  fs.renameSync(path.join(macos, 'Electron'), path.join(macos, 'QuickLook Fast'));
  fs.copyFileSync(finderBridge, path.join(macos, 'QuickLookFast.FinderBridge'));
  const plist = path.join(bundle, 'Contents', 'Info.plist');
  const edit = (key, value) => require('node:child_process').execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${JSON.stringify(value)}`, plist], { stdio: 'pipe' });
  const add = (key, value) => require('node:child_process').execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${JSON.stringify(value)}`, plist]);
  edit('CFBundleExecutable', 'QuickLook Fast');
  edit('CFBundleName', 'QuickLook Fast');
  edit('CFBundleDisplayName', 'QuickLook Fast');
  edit('CFBundleIdentifier', 'cn.chaoleme.quicklookfast');
  // Launch as an accessory before Electron loads the user's Dock preference.
  require('node:child_process').execFileSync('/usr/bin/plutil', ['-replace', 'LSUIElement', '-bool', 'YES', plist]);
  // Electron's distribution includes this key; use Add for runtimes that omit it.
  try { edit('LSMinimumSystemVersion', '26.0'); }
  catch { add('LSMinimumSystemVersion', '26.0'); }
  const automationDescription = 'QuickLook Fast needs the selected Finder file or folder to open its preview.';
  try { edit('NSAppleEventsUsageDescription', automationDescription); }
  catch { add('NSAppleEventsUsageDescription', automationDescription); }
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  edit('CFBundleVersion', version);
  edit('CFBundleShortVersionString', version);
  const frameworks = path.join(bundle, 'Contents', 'Frameworks');
  for (const helper of fs.readdirSync(frameworks).filter(name => /^Electron Helper.*\.app$/.test(name))) {
    const helperPlist = path.join(frameworks, helper, 'Contents', 'Info.plist');
    const variant = helper.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    require('node:child_process').execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :CFBundleIdentifier cn.chaoleme.quicklookfast.${variant}`, helperPlist]);
  }
  // The Electron distribution uses electron.icns; keep its existing plist key.
  fs.copyFileSync(path.join(root, 'public', 'branding', 'app.icns'), path.join(bundle, 'Contents', 'Resources', 'electron.icns'));
} else {
  fs.cpSync(electron, output, { recursive: true, verbatimSymlinks: true });
  fs.renameSync(path.join(output, process.platform === 'win32' ? 'electron.exe' : 'electron'), path.join(output, process.platform === 'win32' ? 'QuickLook Fast.exe' : 'quicklook-fast'));
  if (process.platform === 'win32' && fs.existsSync(path.join(output, 'electron_wer.dll'))) {
    fs.renameSync(path.join(output, 'electron_wer.dll'), path.join(output, 'QuickLook Fast_wer.dll'));
  }
}
if (process.platform === 'win32' && process.env.SLOWLOOK_SKIP_ICON_EMBED !== '1') {
  if (!fs.existsSync(iconEditor) || !fs.existsSync(icon)) throw new Error('图标构建工具或图标不存在，请先执行 pnpm run build:native。');
  const result = require('node:child_process').spawnSync(iconEditor, [path.join(output, 'QuickLook Fast.exe'), icon], { stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`无法写入 Windows 程序图标: ${result.error?.message || result.status}`);
}
const resources = process.platform === 'darwin' ? path.join(output, 'QuickLook Fast.app', 'Contents', 'Resources') : path.join(output, 'resources');
const app = path.join(resources, 'app');
const native = path.join(resources, 'native');
fs.mkdirSync(app, { recursive: true });
fs.mkdirSync(native, { recursive: true });
fs.mkdirSync(path.join(app, 'build'), { recursive: true });
for (const name of ['dist', 'dist-electron']) {
  fs.cpSync(path.join(build, name), path.join(app, 'build', name), { recursive: true });
}
fs.cpSync(path.join(root, 'docs'), path.join(app, 'docs'), { recursive: true });
fs.mkdirSync(path.join(app, 'public', 'branding'), { recursive: true });
fs.copyFileSync(path.join(root, 'public', 'branding', 'app.png'), path.join(app, 'public', 'branding', 'app.png'));
for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'README.md', 'LICENSE', 'NOTICE', 'THIRD_PARTY.md']) {
  fs.copyFileSync(path.join(root, name), path.join(app, name));
}
fs.mkdirSync(path.join(app, 'tests', 'fixtures'), { recursive: true });
fs.copyFileSync(path.join(root, 'tests', 'fixtures', 'README.md'), path.join(app, 'tests', 'fixtures', 'README.md'));
fs.mkdirSync(path.join(app, '.github', 'workflows'), { recursive: true });
fs.copyFileSync(path.join(root, '.github', 'workflows', 'release.yml'), path.join(app, '.github', 'workflows', 'release.yml'));
fs.cpSync(path.join(root, 'patch'), path.join(app, 'patch'), { recursive: true });
if (process.platform === 'win32') fs.copyFileSync(bridge, path.join(native, 'QuickLookFast.Bridge.exe'));
if (process.platform === 'linux') {
  const installer = path.join(app, 'build', 'dist-electron', 'platform', 'linux');
  fs.mkdirSync(installer, { recursive: true });
  fs.copyFileSync(path.join(root, 'electron', 'platform', 'linux', 'install.cjs'), path.join(installer, 'install.cjs'));
  fs.cpSync(path.join(root, 'electron', 'platform', 'linux', 'plasma'), path.join(installer, 'plasma'), { recursive: true });
  fs.copyFileSync(path.join(root, 'electron', 'platform', 'linux', 'install-portable.sh'), path.join(output, 'install-integration.sh'));
  fs.chmodSync(path.join(output, 'install-integration.sh'), 0o755);
}

const appModules = path.join(app, 'node_modules');
const visited = new Set();
function copyRuntimeDependency(name, parent) {
  const manifest = require.resolve(`${name}/package.json`, { paths: [parent] });
  if (visited.has(manifest)) return;
  visited.add(manifest);
  const source = path.dirname(manifest);
  const relative = path.relative(path.join(root, 'node_modules'), source);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`依赖不在项目 node_modules 中: ${name}`);
  fs.cpSync(source, path.join(appModules, relative), { recursive: true });
  const metadata = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  for (const dependency of Object.keys(metadata.dependencies || {})) copyRuntimeDependency(dependency, source);
}
for (const name of ['mime-types', 'node-unrar-js', 'officecrypto-tool', ...(process.platform === 'linux' ? ['dbus-next'] : [])]) copyRuntimeDependency(name, root);

// Preserve the notices of bundled npm dependencies alongside the application.
const licenses = path.join(app, 'third-party-licenses');
function collectLicenses(modulesDirectory, prefix = '') {
  if (!fs.existsSync(modulesDirectory)) return;
  for (const entry of fs.readdirSync(modulesDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const current = path.join(modulesDirectory, entry.name);
    if (entry.name.startsWith('@')) {
      collectLicenses(current, path.join(prefix, entry.name));
      continue;
    }
    const packagePath = path.join(current, 'package.json');
    if (!fs.existsSync(packagePath)) continue;
    const metadata = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    const destination = path.join(licenses, prefix, `${entry.name}@${metadata.version || 'unknown'}`);
    for (const file of fs.readdirSync(current, { withFileTypes: true })) {
      if (file.isFile() && /^(license|licence|notice|copying|third.party.notices)/i.test(file.name)) {
        fs.mkdirSync(destination, { recursive: true });
        fs.copyFileSync(path.join(current, file.name), path.join(destination, file.name));
      }
    }
    collectLicenses(path.join(current, 'node_modules'), path.join(prefix, entry.name, 'node_modules'));
  }
}
collectLicenses(path.join(root, 'node_modules'));
fs.mkdirSync(path.join(licenses, 'Arcade-Look'), { recursive: true });
fs.copyFileSync(path.join(root, 'docs', 'licenses', 'Arcade-Look-LICENSE'), path.join(licenses, 'Arcade-Look', 'LICENSE'));
fs.mkdirSync(path.join(licenses, 'UnRAR'), { recursive: true });
fs.copyFileSync(path.join(root, 'docs', 'licenses', 'UnRAR-LICENSE.txt'), path.join(licenses, 'UnRAR', 'LICENSE.txt'));
console.log(`${target} 便携目录: ${output}`);
