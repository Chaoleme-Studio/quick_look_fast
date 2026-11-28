const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
if (process.platform === 'darwin') {
  const cache = path.join(root, '.local', 'cache');
  fs.mkdirSync(cache, { recursive: true });
  const test = path.join(cache, `finder-selection-test-${randomUUID()}`);
  try {
    execFileSync('/usr/bin/xcrun', ['swiftc', path.join(root, 'native', 'macos', 'FinderSelectionPath.swift'),
      path.join(root, 'tests', 'FinderSelectionPathTests.swift'), '-o', test], { cwd: root, stdio: 'inherit' });
    execFileSync(test, [], { cwd: root, stdio: 'inherit' });
  } finally { if (fs.existsSync(test)) fs.unlinkSync(test); }
  process.exit(0);
}
if (process.platform !== 'win32') process.exit(0);
const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const cache = path.join(root, '.local', 'cache');
fs.mkdirSync(cache, { recursive: true });
const id = randomUUID();
const fake = path.join(cache, `dopus-fake-${id}.exe`);
const test = path.join(cache, `dopus-test-${id}.exe`);
const cacheTest = path.join(cache, `selection-cache-test-${id}.exe`);
const ipcTest = path.join(cache, `dopus-ipc-test-${id}.exe`);
const requestTest = path.join(cache, `preview-request-test-${id}.exe`);
try {
  const compile = (args) => execFileSync(compiler, args, { cwd: root, stdio: 'inherit' });
  const source = (...parts) => path.join(root, ...parts);
  compile(['/nologo', '/target:exe', `/out:${fake}`, '/reference:System.Xml.dll', source('tests', 'FakeDopusRuntime.cs')]);
  compile(['/nologo', '/target:exe', `/out:${test}`, '/reference:System.Xml.dll', '/reference:System.Windows.Forms.dll', source('tests', 'DopusSelectionTests.cs'), source('native', 'windows', 'DopusSelection.cs'), source('native', 'windows', 'DopusIpc.cs')]);
  compile(['/nologo', '/target:exe', `/out:${cacheTest}`, '/reference:System.Windows.Forms.dll', source('tests', 'SelectionCacheTests.cs'), source('native', 'windows', 'SelectionCache.cs'), source('native', 'windows', 'KeyboardRecovery.cs')]);
  compile(['/nologo', '/target:exe', `/out:${ipcTest}`, '/reference:System.Windows.Forms.dll', source('tests', 'DopusIpcTests.cs'), source('native', 'windows', 'DopusIpc.cs')]);
  compile(['/nologo', '/target:exe', `/out:${requestTest}`, source('tests', 'PreviewRequestTests.cs'), source('native', 'windows', 'PreviewRequestTracker.cs')]);
  execFileSync(test, [fake], { cwd: root, stdio: 'inherit' });
  execFileSync(cacheTest, [], { cwd: root, stdio: 'inherit' });
  execFileSync(ipcTest, [], { cwd: root, stdio: 'inherit' });
  execFileSync(requestTest, [], { cwd: root, stdio: 'inherit' });
} finally {
  for (const file of [fake, test, cacheTest, ipcTest, requestTest]) if (fs.existsSync(file)) fs.unlinkSync(file);
}
