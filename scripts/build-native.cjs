const { existsSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (process.platform !== 'win32') {
  console.log('Windows Explorer integration is built on Windows.');
  process.exit(0);
}

const root = path.resolve(__dirname, '..');
const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
if (!existsSync(compiler)) {
  console.error('未找到 .NET Framework C# 编译器。请安装 .NET Framework 4.8 开发组件。');
  process.exit(1);
}
const output = path.join(root, 'build', 'native', 'windows');
mkdirSync(output, { recursive: true });
const result = spawnSync(compiler, [
  '/nologo',
  '/target:exe',
  '/platform:anycpu',
  '/optimize+',
  `/out:${path.join(output, 'QuickLookFast.Bridge.exe')}`,
  '/reference:System.Windows.Forms.dll',
  '/reference:System.Web.Extensions.dll',
  '/reference:System.Xml.dll',
  '/reference:Microsoft.CSharp.dll',
  path.join(root, 'native', 'windows', 'ExplorerBridge.cs'),
  path.join(root, 'native', 'windows', 'DopusSelection.cs'),
  path.join(root, 'native', 'windows', 'DopusIpc.cs'),
  path.join(root, 'native', 'windows', 'SelectionCache.cs'),
  path.join(root, 'native', 'windows', 'KeyboardRecovery.cs'),
], { stdio: 'inherit' });
if (result.error) console.error(result.error.message);
if (result.error || result.status) process.exit(result.status || 1);
const iconResult = spawnSync(compiler, [
  '/nologo', '/target:exe', '/platform:anycpu', '/optimize+',
  `/out:${path.join(output, 'QuickLookFast.IconEditor.exe')}`,
  path.join(root, 'native', 'windows', 'IconEditor.cs'),
], { stdio: 'inherit' });
if (iconResult.error) console.error(iconResult.error.message);
process.exit(iconResult.status || (iconResult.error ? 1 : 0));
