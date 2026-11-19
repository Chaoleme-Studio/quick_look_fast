// Captures the real renderer using fixed, non-private demo data.
// Run on a desktop that can launch Electron: npm run build && npm run screenshots.
const { app, BrowserWindow, protocol, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const renderer = path.join(root, 'dist');
const output = path.join(root, 'docs', 'screenshots');
const scratch = path.join(root, '.npm-cache', 'screenshot-demo');
fs.mkdirSync(scratch, { recursive: true });
const profile = path.join(scratch, 'profile');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
const { fileResponse } = require(path.join(root, 'dist-electron', 'protocol.js'));
const { startFileServer } = require(path.join(root, 'dist-electron', 'file-server.js'));
protocol.registerSchemesAsPrivileged([{ scheme: 'slowlook', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);

// A small synthetic PDF, with no names or content taken from the user's files.
function demoPdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const content = '0.94 0.96 0.99 rg 0 0 612 792 re f 0.16 0.23 0.37 rg BT /F1 28 Tf 54 690 Td (QuickLook Fast) Tj ET BT /F1 16 Tf 54 650 Td (A calm space for your files.) Tj ET 0.34 0.49 0.73 rg 54 605 504 4 re f 0.25 0.30 0.39 rg BT /F1 12 Tf 54 560 Td (PDF preview - public demonstration document.) Tj ET';
  objects[3] = `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`;
  let data = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(data)); data += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(data);
  data += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) data += `${String(offset).padStart(10, '0')} 00000 n \n`;
  return Buffer.from(data + `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
}
const pdf = path.join(scratch, 'sample.pdf');
const text = path.join(scratch, 'welcome.txt');
fs.writeFileSync(pdf, demoPdf());
fs.writeFileSync(text, 'QuickLook Fast 文件预览\n\n这是用于截图的合成示例。\n选择左侧文件即可查看内容。\n');
const files = new Map([
  ['sample-text', { path: text, name: '使用说明.txt' }],
  ['sample-image', { path: path.join(root, 'public', 'branding', 'app.png'), name: '示例图片.png' }],
  ['sample-pdf', { path: pdf, name: 'sample.pdf' }],
  ['sample-pptx', { path: path.join(root, 'tests', 'fixtures', 'office-sample.pptx'), name: 'office-sample.pptx' }],
]);
const tokenFor = (id) => `capture-${id}`;
let fileServer;
app.whenReady().then(async () => {
  fs.mkdirSync(output, { recursive: true });
  const local = await startFileServer((token) => {
    for (const [id, file] of files) if (tokenFor(id) === token) return { token, path: file.path };
  });
  fileServer = local.server;
  const fileInfo = (id) => {
    const file = files.get(id); if (!file) throw new Error('Unknown demo file');
    return { name: file.name, size: fs.statSync(file.path).size, url: `${local.origin}/preview/${tokenFor(id)}/${encodeURIComponent(file.name)}` };
  };
  ipcMain.handle('capture-read-directory', (_event, id) => ({ entries: id === 'demo-root' ? [
    { name: '文档', kind: 'directory', id: 'demo-docs' },
    { name: '使用说明.txt', kind: 'file', id: 'sample-text' },
    { name: '示例图片.png', kind: 'file', id: 'sample-image' },
    { name: 'sample.pdf', kind: 'file', id: 'sample-pdf' },
    { name: 'office-sample.pptx', kind: 'file', id: 'sample-pptx' },
  ] : [], nextOffset: null, truncated: false }));
  ipcMain.handle('capture-open-directory-file', (_event, id) => fileInfo(id));
  protocol.handle('slowlook', async (request) => {
    const url = new URL(request.url); if (url.hostname !== 'app') return new Response('Not found', { status: 404 });
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const target = path.resolve(renderer, relative);
    if (target !== renderer && !target.startsWith(`${renderer}${path.sep}`)) return new Response('Not found', { status: 404 });
    return fileResponse(request, target);
  });
  const window = new BrowserWindow({ width: 1080, height: 760, show: false, frame: false, backgroundColor: '#11141b',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  await window.loadURL('slowlook://app/index.html');
  window.showInactive();
  const waitFor = (expression) => window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const start = Date.now(); const check = () => { try { if (${expression}) return resolve(); } catch {}
      if (Date.now() - start > 45000) return reject(Error('Screenshot preview timed out: ${expression.replaceAll("'", "")}'));
      setTimeout(check, 50); }; check();
  })`);
  const capture = async (name) => {
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    // Hidden Electron windows can return the preceding compositor frame even
    // after a DOM update. Allow the new document's frame to be presented.
    await new Promise((resolve) => setTimeout(resolve, 700));
    await window.capturePage(); // Flush a possibly stale compositor frame.
    await new Promise((resolve) => setTimeout(resolve, 250));
    const image = await window.capturePage(); if (image.isEmpty()) throw new Error('Electron returned an empty screenshot');
    fs.writeFileSync(path.join(output, name), image.toPNG()); console.log(`Saved ${name}`);
  };
  await waitFor("document.querySelector('#settings-open')");
  await capture('welcome.png');
  await window.webContents.executeJavaScript("document.querySelector('#settings-open').click();document.querySelector('[data-settings-tab=folder]').click()");
  await capture('settings.png');
  await window.webContents.executeJavaScript("document.querySelector('#settings-close').click()");
  window.webContents.send('capture-start', { name: 'D: · 演示' });
  window.webContents.send('capture-directory', { id: 'demo-root', name: 'D: · 演示', path: 'D:\\\\（合成示例）' });
  await waitFor("document.querySelector('[data-folder-file=sample-text]')");
  await window.webContents.executeJavaScript("document.querySelector('[data-folder-file=sample-text]').click()");
  await waitFor("document.querySelector('.folder-child-viewer .viewer-root')?.shadowRoot?.textContent.includes('QuickLook Fast')");
  await capture('folder.png');
  for (const [id, name] of [['sample-pdf', 'pdf.png'], ['sample-pptx', 'pptx.png']]) {
    const info = fileInfo(id); window.webContents.send('capture-start', { name: info.name }); window.webContents.send('capture-preview', info);
    await waitFor(`document.querySelector('#file-name')?.textContent === ${JSON.stringify(info.name)}`);
    await waitFor("document.querySelector('#loading').hidden && document.querySelector('#error').hidden && document.querySelector('#viewer .viewer-root')?.shadowRoot?.childElementCount");
    if (id === 'sample-pdf') await waitFor("document.querySelector('#viewer .viewer-root')?.shadowRoot?.querySelector('.textLayer')?.textContent.includes('QuickLook Fast')");
    if (id === 'sample-pptx') await waitFor("document.querySelector('#viewer .viewer-root')?.shadowRoot?.querySelector('.flyfish-pptx-content')?.dataset.renderState === 'ready'");
    await capture(name);
  }
  const readmePath = path.join(root, 'README.md');
  const readme = fs.readFileSync(readmePath, 'utf8');
  const startMarker = '<!-- screenshots:start -->', endMarker = '<!-- screenshots:end -->';
  const start = readme.indexOf(startMarker), end = readme.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || readme.indexOf(startMarker, start + startMarker.length) >= 0 || readme.indexOf(endMarker, end + endMarker.length) >= 0) throw new Error('README screenshot markers are missing or duplicated');
  const images = '\n\n![文件夹预览](docs/screenshots/folder.png)\n\n![PDF 预览](docs/screenshots/pdf.png)\n\n![PPTX 预览](docs/screenshots/pptx.png)\n\n![设置](docs/screenshots/settings.png)\n\n';
  const temporary = path.join(root, `.README-screenshots-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, readme.slice(0, start + startMarker.length) + images + readme.slice(end), { flag: 'wx' });
    fs.renameSync(temporary, readmePath);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  window.destroy(); fileServer.close(); app.quit();
}).catch((error) => { console.error(error); fileServer?.close(); app.exit(1); });
