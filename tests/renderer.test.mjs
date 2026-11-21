import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { Window } from 'happy-dom';
import ts from 'typescript';
import JSZip from 'jszip';
import { Worker as NodeWorker } from 'node:worker_threads';

const require = createRequire(import.meta.url);
const { startFileServer } = require('../build/dist-electron/files/file-server.js');
const officeCrypto = require('officecrypto-tool');
const portableDist = process.env.SLOWLOOK_PORTABLE_DIST ? path.resolve(process.env.SLOWLOOK_PORTABLE_DIST) : undefined;

async function verifyTextPreview(useBundle, bundleDirectory) {
  const directory = await mkdtemp(path.join(tmpdir(), 'slowlook-renderer-'));
  let activeFile;
  const { server, origin } = await startFileServer(() => activeFile);
  const window = new Window({ url: 'http://127.0.0.1/' });
  const originalNodeName = Object.getOwnPropertyDescriptor(window.Node.prototype, 'nodeName');
  const originalGlobals = new Map();
  const callbacks = {};
  const metrics = [];
  const navigations = [];
  const topmost = [];
  const pins = [];
  const canvasCalls = [];
  let selectedFiles = 0, defaultOpens = 0, hiddenPreviews = 0;
  let defaultOpenResult = { ok: true };

  try {
    window.document.body.innerHTML = '<div id="app"></div>';
    window.localStorage.setItem('slowlook.alwaysOnTop', 'true');
    // DOMPurify calls the standard Node.prototype getter directly. Happy DOM's
    // base getter returns an empty name instead of dispatching to the node;
    // correct the test environment so it preserves valid slide/heading roots.
    Object.defineProperty(window.Node.prototype, 'nodeName', { configurable: true, get() {
      return this.nodeType === 1 ? this.tagName : ({ 3: '#text', 8: '#comment', 9: '#document', 11: '#document-fragment' })[this.nodeType] || '';
    } });
    // Real Chromium implements namespace lookup; Happy DOM does not.
    window.Node.prototype.lookupNamespaceURI = function (prefix) {
      let node = this.nodeType === 1 ? this : this.parentElement;
      while (node?.nodeType === 1) {
        const value = node.getAttribute(prefix ? `xmlns:${prefix}` : 'xmlns');
        if (value !== null) return value;
        node = node.parentElement;
      }
      return null;
    };
    // Happy DOM has no rasterizer. Record spreadsheet canvas operations so
    // the test can verify the renderer draws cells without claiming pixel fidelity.
    window.HTMLCanvasElement.prototype.getContext = function (kind) {
      if (kind !== '2d') return null;
      const state = { canvas: this, measureText: (value) => ({ width: String(value).length * 7 }), createLinearGradient: () => ({ addColorStop() {} }), createPattern: () => null };
      return new Proxy(state, { get(target, property) {
        if (property in target) return target[property];
        return (...args) => { if (['fillText', 'strokeText', 'fillRect', 'strokeRect'].includes(property)) canvasCalls.push({ method: property, color: target.fillStyle, value: args[0] }); };
      } });
    };
    // Chromium supports modulepreload. Avoid Happy DOM's fallback trying to
    // fetch file:// links with Node's HTTP-only fetch implementation.
    const tokenListPrototype = Object.getPrototypeOf(window.document.createElement('link').relList);
    const supportsToken = tokenListPrototype.supports;
    tokenListPrototype.supports = function (token) {
      return token === 'modulepreload' || (supportsToken ? supportsToken.call(this, token) : false);
    };
    window.slowLook = {
      platform: 'win32',
      onStart: (callback) => { callbacks.start = callback; },
      onPreview: (callback) => { callbacks.preview = callback; },
      onDirectory: (callback) => { callbacks.directory = callback; },
      onClear: (callback) => { callbacks.clear = callback; },
      onProgress: (callback) => { callbacks.progress = callback; },
      onError: (callback) => { callbacks.error = callback; },
      onIntegrationStatus: (callback) => { callbacks.integrationStatus = callback; },
      metric: (value) => metrics.push(value),
      hide: () => { hiddenPreviews += 1; },
      navigate: (key) => navigations.push(key),
      setAlwaysOnTop: (enabled) => topmost.push(enabled),
      setPinned: (enabled) => { pins.push(enabled); callbacks.pinState(enabled); },
      openProjectLink: (destination) => { callbacks.openedLink = destination; },
      appVersion: async () => '0.1.2',
      openDiagnostics: async () => { callbacks.openedDiagnostics = true; return { ok: true }; },
      checkForUpdates: async () => ({ state: 'available', currentVersion: '0.1.2', latestVersion: '0.2.0' }),
      onPinState: (callback) => { callbacks.pinState = callback; },
      getStartup: async () => ({ supported: true, enabled: false }),
      setStartup: async (enabled) => ({ supported: true, enabled }),
      setFinderShortcut: () => {},
      selectFile: async () => { selectedFiles++; },
      openWithDefault: async () => { defaultOpens++; return defaultOpenResult; },
      selectFolder: async () => {},
      readDirectory: async (id, offset) => id === 'root-folder'
        ? { entries: [{ name: '资料', kind: 'directory', id: 'child-folder' }, { name: '笔记.txt', kind: 'file', id: 'folder-note' }, { name: '网页.html', kind: 'file', id: 'folder-html' },
          { name: '加密.xlsx', kind: 'file', id: 'folder-protected' }, { name: '大文件.log', kind: 'file', id: 'folder-large' },
          { name: '音乐.mp3', kind: 'file', id: 'folder-audio' }, { name: '.DS_Store', kind: 'file', id: 'folder-mac-metadata' },
          { name: '__MACOSX', kind: 'directory', id: 'folder-mac-dir' }], nextOffset: null, truncated: false }
        : { entries: [{ name: 'nested.md', kind: 'file' }], nextOffset: null, truncated: false },
      openDirectoryFile: async (id) => {
        if (id === 'folder-note') { activeFile = { token: 'folder-note', path: example }; return { url: `${origin}/preview/folder-note/example.txt`, name: '笔记.txt', size: 32 }; }
        if (id === 'folder-html') { activeFile = { token: 'folder-html', path: htmlPath }; return { url: `${origin}/preview/folder-html/demo.html`, name: '网页.html', size: 64 }; }
        if (id === 'folder-protected') { activeFile = { token: 'folder-protected', path: protectedFile }; return { url: `${origin}/preview/folder-protected/office.xlsx`, name: '加密.xlsx', size: protectedBytes.length }; }
        if (id === 'folder-large') { activeFile = { token: 'folder-large', path: large }; return { url: `${origin}/preview/folder-large/large.log`, name: '大文件.log', size: largeBytes.length }; }
        if (id === 'folder-audio') { activeFile = { token: 'folder-audio', path: example }; return { url: `${origin}/preview/folder-audio/audio.mp3`, name: '音乐.mp3', size: 32 }; }
        throw new Error('No folder file fixture');
      },
      resolveMarkdownImage: async (_url, reference) => reference === 'thumbnail.png' ? `${origin}/preview/image/thumbnail.png` : undefined,
      releaseDirectoryPreview: () => {},
      contentTask: async () => ({ ok: false, code: 'failed', message: 'No content task fixture' }),
      cancelContent: () => {},
      focusPreview: () => {},
      openDroppedFile: async () => {},
    };
    for (const name of [
      'window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Document',
      'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLButtonElement', 'HTMLSelectElement',
      'CustomEvent', 'Event', 'MutationObserver', 'ResizeObserver', 'getComputedStyle',
      'DOMParser', 'XMLSerializer', 'Image',
    ]) {
      originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      const value = name === 'window' ? window : window[name];
      if (value !== undefined) Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
    }
    for (const name of ['requestAnimationFrame', 'cancelAnimationFrame']) {
      originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { value: window[name].bind(window), writable: true, configurable: true });
    }
    // Run the real packaged PPTX worker in a Node worker thread while retaining
    // the browser Worker API used by Flyfish's production renderer.
    originalGlobals.set('Worker', Object.getOwnPropertyDescriptor(globalThis, 'Worker'));
    class BrowserWorker {
      constructor(url) {
        if (!String(url).includes('pptx.worker.js')) throw new Error(`Unexpected test worker: ${url}`);
        const workerPath = path.resolve(bundleDirectory || 'build/dist', 'file-viewer/vendor/pptx/pptx.worker.js');
        this.worker = new NodeWorker(`
          const { parentPort, workerData } = require('node:worker_threads');
          globalThis.self = globalThis;
          globalThis.postMessage = (data) => parentPort.postMessage(data);
          console.log = () => {};
          require(workerData);
          parentPort.on('message', (data) => globalThis.onmessage({ data }));
        `, { eval: true, workerData: workerPath });
      }
      addEventListener(type, callback) {
        if (type === 'message') this.worker.on('message', (data) => callback({ data }));
        else if (type === 'error') this.worker.on('error', (error) => callback({ error, message: error.message }));
      }
      postMessage(data) { this.worker.postMessage(data); }
      terminate() { void this.worker.terminate(); }
    }
    Object.defineProperty(globalThis, 'Worker', { value: BrowserWorker, writable: true, configurable: true });

    if (useBundle) {
      const dist = bundleDirectory || fileURLToPath(new URL('../build/dist/', import.meta.url));
      const html = await readFile(path.join(dist, 'index.html'), 'utf8');
      const entry = html.match(/src="\.\/([^"]+\.js)"/);
      const stylesheet = html.match(/href="\.\/([^"]+\.css)"/);
      assert.ok(entry, 'production renderer entry is missing');
      assert.ok(stylesheet, 'production stylesheet is missing');
      const link = window.document.createElement('link');
      link.rel = 'stylesheet';
      link.href = pathToFileURL(path.join(dist, stylesheet[1])).href;
      window.document.head.appendChild(link);
      await import(pathToFileURL(path.join(dist, entry[1])).href);
    } else {
      let source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
      source = source.replace("import './style.css';", '');
      source = source.replace(/from '\.\/([^']+)'/g, (_match, module) =>
        'from ' + JSON.stringify(new URL('../src/' + module + '.ts', import.meta.url).href));
      for (const name of ['@file-viewer/core', '@file-viewer/web-full', '@file-viewer/renderer-binary', '@file-viewer/renderer-design', '@file-viewer/renderer-signature', 'exifr']) {
        source = source.replaceAll(`import('${name}')`, `import(${JSON.stringify(import.meta.resolve(name))})`);
      }
      const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
      await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
    }
    const example = path.join(directory, '预览 sample.txt');
    assert.deepEqual(topmost, [], 'legacy topmost preference must not make the window permanently topmost');
    assert.equal(window.document.querySelector('#open-default').disabled, true, 'there is no file to open on the welcome page');
    window.document.querySelector('#choose').click();
    assert.equal(selectedFiles, 1, 'the folder icon selects a file for preview');
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true, cancelable: true }));
    assert.equal(selectedFiles, 2, 'Ctrl+O continues to select a preview file');
    await writeFile(example, 'SlowLook preview regression test', 'utf8');
    activeFile = { token: 'text-token', path: example };
    callbacks.start({ name: path.basename(example) });
    assert.equal(window.document.querySelector('#open-default').disabled, true, 'opening is disabled until the file is known');
    callbacks.preview({ url: `${origin}/preview/text-token/${encodeURIComponent(path.basename(example))}`, name: path.basename(example), size: 32 });
    assert.equal(window.document.querySelector('#open-default').disabled, false);
    window.document.querySelector('#open-default').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(defaultOpens, 1, 'the primary action opens the current file with its default application');
    defaultOpenResult = { ok: false, message: '没有默认应用' };
    window.document.querySelector('#open-default').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(window.document.querySelector('#open-feedback').hidden, false);
    assert.match(window.document.querySelector('#open-feedback').textContent, /没有默认应用/);
    window.document.querySelector('#open-feedback-close').click();
    assert.equal(window.document.querySelector('#open-feedback').hidden, true, 'the error can be dismissed without closing the preview');
    defaultOpenResult = { ok: true };
    callbacks.progress({ phase: 'reading', loaded: 50, total: 100 });
    assert.equal(window.document.querySelector('#loading-progress').value, 50);
    assert.equal(window.document.querySelector('#loading-progress').hidden, false);
    callbacks.progress({ phase: 'parsing' });
    assert.equal(window.document.querySelector('#loading-progress').hidden, true, 'parsing must not be represented by an invented percentage');

    for (let attempt = 0; attempt < 300 && !metrics.includes('content-ready'); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const loading = window.document.querySelector('#loading');
    const error = window.document.querySelector('#error');
    assert.equal(error.hidden, true, window.document.querySelector('#error-message').textContent);
    const viewerText = window.document.querySelector('.viewer-root')?.shadowRoot?.textContent?.slice(-700) || '';
    assert.ok(metrics.includes('content-ready'), `Flyfish did not report a completed preview (loading=${loading.hidden}, error=${error.hidden}, viewer=${Boolean(window.document.querySelector('.viewer-root'))}, preloads=${window.document.querySelectorAll('link').length}, content=${viewerText})`);
    assert.equal(loading.hidden, true, 'loading overlay remained visible after the preview completed');
    const content = window.document.querySelector('.viewer-root').shadowRoot.textContent;
    assert.match(content, /SlowLook preview regression test/);
    const textViewer = window.document.querySelector('.viewer-root').shadowRoot.querySelector('.code-viewer');
    assert.equal(textViewer.dataset.lineNumbers, 'true', 'text line numbers should be enabled by default');
    assert.ok(textViewer.querySelector('.code-line-numbers'));

    const pressSpace = (target) => {
      const event = new window.KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    window.document.querySelector('#settings-open').click();
    const spaceSetting = window.document.querySelector('#settings-space-closes-preview');
    assert.equal(spaceSetting.checked, true);
    spaceSetting.click();
    assert.equal(pressSpace(spaceSetting), false, 'when disabled, a focused switch accepts Space');
    assert.equal(hiddenPreviews, 0);
    spaceSetting.click();
    const textField = window.document.createElement('textarea');
    window.document.querySelector('#group-general').append(textField);
    assert.equal(pressSpace(textField), false, 'Space remains available in a text field');
    textField.remove();
    assert.equal(pressSpace(spaceSetting), true, 'a focused switch cannot consume the close shortcut');
    assert.equal(hiddenPreviews, 1);
    assert.equal(window.document.querySelector('#settings').hidden, true);

    const codePath = path.join(directory, 'sample.js');
    const codeData = 'const answer = 42;\n// A comment\nanswer++;';
    await writeFile(codePath, codeData, 'utf8');
    activeFile = { token: 'code', path: codePath };
    callbacks.start({ name: 'sample.js' });
    callbacks.preview({ url: `${origin}/preview/code/sample.js`, name: 'sample.js', size: Buffer.byteLength(codeData) });
    for (let attempt = 0; attempt < 300 && !window.document.querySelector('.viewer-root')?.shadowRoot?.querySelector('.hljs-keyword'); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const codeViewer = window.document.querySelector('.viewer-root')?.shadowRoot?.querySelector('.code-viewer');
    assert.ok(codeViewer?.querySelector('.hljs-keyword'), 'JavaScript keywords should be highlighted');
    assert.equal(codeViewer.querySelector('.code-line-numbers').textContent, '1\n2\n3');
    window.document.querySelector('#settings-open').click();
    const lineSetting = window.document.querySelector('#settings-line-numbers');
    const wrapSetting = window.document.querySelector('#settings-wrap-lines');
    window.document.querySelector('#tab-reading').click();
    assert.equal(window.document.querySelector('#group-reading').hidden, false);
    assert.equal(window.document.querySelector('#group-general').hidden, true);
    lineSetting.checked = false;
    lineSetting.dispatchEvent(new window.Event('change', { bubbles: true }));
    for (let attempt = 0; attempt < 150 && window.document.querySelector('.viewer-root')?.shadowRoot?.querySelector('.code-viewer')?.dataset.lineNumbers !== 'false'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(window.document.querySelector('.viewer-root').shadowRoot.querySelector('.code-viewer').dataset.lineNumbers, 'false', 'turning off line numbers updates the current preview');
    wrapSetting.checked = true;
    wrapSetting.dispatchEvent(new window.Event('change', { bubbles: true }));
    for (let attempt = 0; attempt < 150 && window.document.querySelector('.viewer-root')?.shadowRoot?.querySelector('.code-viewer')?.dataset.wrapLongLines !== 'true'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(window.document.querySelector('.viewer-root').shadowRoot.querySelector('.code-viewer').dataset.wrapLongLines, 'true', 'wrap setting updates the current preview');
    lineSetting.checked = true;
    lineSetting.dispatchEvent(new window.Event('change', { bubbles: true }));
    wrapSetting.checked = false;
    wrapSetting.dispatchEvent(new window.Event('change', { bubbles: true }));
    window.document.querySelector('#settings-close').click();

    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    assert.deepEqual(navigations, ['ArrowDown']);
    window.document.querySelector('#settings-open').click();
    const navigationSetting = window.document.querySelector('#settings-navigation');
    const startupSetting = window.document.querySelector('#settings-startup');
    for (let attempt = 0; attempt < 100 && startupSetting.disabled; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(startupSetting.checked, false, 'login startup is off until explicitly enabled');
    startupSetting.checked = true;
    startupSetting.dispatchEvent(new window.Event('change', { bubbles: true }));
    for (let attempt = 0; attempt < 100 && startupSetting.disabled; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(startupSetting.checked, true, 'the startup setting follows the system response');
    callbacks.integrationStatus('DOpus：未读取到选中项');
    assert.equal(window.document.querySelector('#integration-current-status').textContent, 'DOpus：未读取到选中项');
    assert.equal(window.document.querySelector('#settings-always-on-top'), null, 'pinning is the only topmost control');
    navigationSetting.checked = false;
    navigationSetting.dispatchEvent(new window.Event('change', { bubbles: true }));
    window.document.querySelector('#settings-close').click();
    window.document.querySelector('#pin-window').click();
    assert.deepEqual(pins, [true], 'pin button should fix this preview');
    assert.equal(window.document.querySelector('#pin-window').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(topmost, [], 'topmost state is managed with the pinned window in the main process');
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    assert.deepEqual(navigations, ['ArrowDown'], 'disabled navigation should not forward the key');
    assert.equal(window.localStorage.getItem('slowlook.navigation'), 'false');
    window.document.querySelector('#settings-open').click();
    window.document.querySelector('[data-settings-tab="about"]').click();
    assert.match(window.document.querySelector('#group-about').textContent, /www\.chaoleme\.cn/);
    window.document.querySelector('[data-external-link="organization"]').click();
    assert.equal(callbacks.openedLink, 'organization');
    assert.match(window.document.querySelector('#app-version').textContent, /0\.1\.2/);
    window.document.querySelector('#check-update').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(window.document.querySelector('#update-status').textContent, /0\.2\.0/);
    window.document.querySelector('[data-external-link="releases"]').click();
    assert.equal(callbacks.openedLink, 'releases');
    window.document.querySelector('#open-diagnostics').click();
    assert.equal(callbacks.openedDiagnostics, true);
    navigationSetting.checked = true;
    navigationSetting.dispatchEvent(new window.Event('change', { bubbles: true }));
    window.document.querySelector('#settings-close').click();
    window.document.querySelector('#settings-open').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    assert.deepEqual(navigations, ['ArrowDown', 'ArrowLeft'], 'navigation should work after closing settings even when the settings button retains focus');

    callbacks.start({ name: 'missing.txt' });
    activeFile = { token: 'missing-token', path: path.join(directory, 'missing.txt') };
    callbacks.preview({ url: `${origin}/preview/missing-token/missing.txt`, name: 'missing.txt', size: 0 });
    for (let attempt = 0; attempt < 300 && error.hidden; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(error.hidden, false, 'a failed load should show the error state');
    assert.equal(loading.hidden, true, 'a failed load should not leave the loading overlay visible');

    const htmlPath = path.join(directory, 'demo.html');
    await writeFile(htmlPath, '<!doctype html><p>local preview</p><script>window.demo=true</script>');
    activeFile = { token: 'html-token', path: htmlPath };
    callbacks.start({ name: 'demo.html' });
    callbacks.preview({ url: `${origin}/preview/html-token/demo.html`, name: 'demo.html', size: 33 * 1024 * 1024 });
    let htmlFrame = window.document.querySelector('.html-preview iframe');
    assert.ok(htmlFrame, 'large HTML follows the interactive page route rather than the text fragment route');
    assert.match(htmlFrame.getAttribute('sandbox'), /allow-scripts/);
    assert.equal(loading.hidden, true);
    const htmlSetting = window.document.querySelector('#settings-html-scripts');
    assert.equal(htmlSetting.checked, true, 'HTML scripts are enabled by default');
    htmlSetting.checked = false; htmlSetting.dispatchEvent(new window.Event('change', { bubbles: true }));
    htmlFrame = window.document.querySelector('.html-preview iframe');
    assert.equal(htmlFrame.getAttribute('sandbox'), '', 'the setting immediately reloads the page without scripts');
    htmlSetting.checked = true; htmlSetting.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.match(window.document.querySelector('.html-preview iframe').getAttribute('sandbox'), /allow-scripts/);

    const htmlZipPath = path.join(directory, 'html-archive.zip');
    const htmlZip = new JSZip(); htmlZip.file('page.html', '<p>archive page</p><script>window.demo=true</script>');
    const htmlZipBytes = await htmlZip.generateAsync({ type: 'nodebuffer' });
    await writeFile(htmlZipPath, htmlZipBytes);
    activeFile = { token: 'html-zip', path: htmlZipPath };
    callbacks.start({ name: 'html-archive.zip' });
    callbacks.preview({ url: `${origin}/preview/html-zip/html-archive.zip`, name: 'html-archive.zip', size: htmlZipBytes.length });
    for (let attempt = 0; attempt < 150 && !window.document.querySelector('.zip-file'); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
    window.document.querySelector('.zip-file').click();
    for (let attempt = 0; attempt < 150 && !window.document.querySelector('.zip-content .html-preview iframe'); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(window.document.querySelector('.zip-content .html-preview iframe')?.getAttribute('sandbox') || '', /allow-scripts/, 'an HTML entry in an archive uses the same isolated viewer');

    // Nested ZIPs retain the application's bounded, searchable archive viewer
    // and inherit the live metadata setting instead of opening a generic viewer.
    const innerZip = new JSZip();
    innerZip.file('story.html', '<p>Nested archive content</p>');
    innerZip.file('.DS_Store', 'metadata');
    for (const format of ['docx', 'xlsx', 'pptx']) {
      innerZip.file(`document.${format}`, await readFile(new URL(`./fixtures/office-sample.${format}`, import.meta.url)));
    }
    const outerZip = new JSZip();
    outerZip.file('inner.zip', await innerZip.generateAsync({ type: 'uint8array' }));
    outerZip.file('other.html', '<p>Other entry</p>');
    const nestedBytes = await outerZip.generateAsync({ type: 'nodebuffer' });
    const nestedPath = path.join(directory, 'outer.zip');
    await writeFile(nestedPath, nestedBytes);
    activeFile = { token: 'nested-zip', path: nestedPath };
    callbacks.start({ name: 'outer.zip' });
    callbacks.preview({ url: `${origin}/preview/nested-zip/outer.zip`, name: 'outer.zip', size: nestedBytes.length });
    for (let attempt = 0; attempt < 150 && !window.document.querySelector('.zip-file'); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
    const nativeCreateObjectURL = URL.createObjectURL;
    let nestedUrl;
    URL.createObjectURL = function (value) {
      const url = nativeCreateObjectURL.call(this, value);
      nestedUrl ||= url;
      return url;
    };
    try {
      [...window.document.querySelectorAll('.zip-file')].find((row) => row.textContent.includes('inner.zip')).click();
      for (let attempt = 0; attempt < 150 && window.document.querySelectorAll('.zip-view').length < 2; attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
      const innerView = window.document.querySelectorAll('.zip-view')[1];
      assert.ok(innerView, 'a ZIP entry opens a second interactive archive view');
      for (let attempt = 0; attempt < 150 && !innerView.querySelector('.zip-file'); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
      const outerView = window.document.querySelectorAll('.zip-view')[0];
      const outerToggle = outerView.querySelector('.zip-content-heading .preview-sidebar-toggle');
      assert.equal(outerToggle.getAttribute('aria-expanded'), 'false', 'drilling in collapses the parent sidebar to leave room for the nested viewer');
      assert.match(innerView.querySelector('.zip-heading strong').textContent, /inner\.zip/);
      assert.doesNotMatch(innerView.querySelector('.zip-tree').textContent, /\.DS_Store/, 'the nested archive inherits the default metadata filter');
      const metadataSetting = window.document.querySelector('#settings-hide-mac-metadata');
      metadataSetting.checked = false; metadataSetting.dispatchEvent(new window.Event('change', { bubbles: true }));
      assert.match(innerView.querySelector('.zip-tree').textContent, /\.DS_Store/, 'changing the filter immediately updates nested archives');
      metadataSetting.checked = true; metadataSetting.dispatchEvent(new window.Event('change', { bubbles: true }));
      for (const format of ['docx', 'xlsx', 'pptx']) {
        [...innerView.querySelectorAll('.zip-file')].find((row) => row.textContent.includes(`document.${format}`)).click();
        const rendered = () => {
          const shadow = innerView.querySelector('.viewer-root')?.shadowRoot;
          return format === 'docx' ? shadow?.querySelector('.docx') : format === 'xlsx' ? shadow?.querySelector('canvas')
            : shadow?.querySelector('.flyfish-pptx-content')?.dataset.renderState === 'ready';
        };
        for (let attempt = 0; attempt < 500 && !rendered(); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
        assert.ok(rendered(), `${format} inside the nested ZIP reaches its document renderer`);
      }
      [...innerView.querySelectorAll('.zip-file')].find((row) => row.textContent.includes('story.html')).click();
      for (let attempt = 0; attempt < 150 && !innerView.querySelector('.html-preview iframe'); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
      assert.ok(innerView.querySelector('.html-preview iframe'), 'a file in the inner archive can be previewed');
      outerToggle.click();
      assert.equal(outerToggle.getAttribute('aria-expanded'), 'true', 'the parent list remains available through its toggle');
      [...outerView.querySelectorAll('.zip-file')].find((row) => row.textContent.includes('other.html')).click();
      assert.equal(window.document.querySelectorAll('.zip-view').length, 1, 'switching the outer entry closes the nested viewer');
      assert.ok(nestedUrl, 'the inner archive has a temporary URL');
      await assert.rejects(fetch(nestedUrl), 'switching the outer entry releases the inner archive URL');
    } finally { URL.createObjectURL = nativeCreateObjectURL; }

    const lastZip = new JSZip(); lastZip.file('content.txt', 'deep');
    let deepBytes = await lastZip.generateAsync({ type: 'uint8array' });
    for (let depth = 5; depth >= 1; depth--) {
      const zip = new JSZip(); zip.file(`layer-${depth}.zip`, deepBytes);
      deepBytes = await zip.generateAsync({ type: 'uint8array' });
    }
    const deepPath = path.join(directory, 'deep.zip'); await writeFile(deepPath, deepBytes);
    activeFile = { token: 'deep-zip', path: deepPath };
    callbacks.start({ name: 'deep.zip' });
    callbacks.preview({ url: `${origin}/preview/deep-zip/deep.zip`, name: 'deep.zip', size: deepBytes.length });
    for (let depth = 1; depth <= 5; depth++) {
      let view;
      for (let attempt = 0; attempt < 150; attempt++) {
        view = window.document.querySelectorAll('.zip-view')[depth - 1];
        if (view?.querySelector('.zip-file')) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const row = [...view.querySelectorAll('.zip-file')].find((item) => item.textContent.includes(`layer-${depth}.zip`));
      assert.ok(row, `nested layer ${depth} is selectable`);
      row.click();
      if (depth < 5) {
        for (let attempt = 0; attempt < 150 && window.document.querySelectorAll('.zip-view').length <= depth; attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(window.document.querySelectorAll('.zip-view').length, depth + 1);
      } else {
        for (let attempt = 0; attempt < 150 && !view.querySelector('.zip-content-body').textContent.includes('超过 4 层'); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
        assert.match(view.querySelector('.zip-content-body').textContent, /超过 4 层/, 'deep nesting is stopped with an explanatory error');
        assert.equal(window.document.querySelectorAll('.zip-view').length, 5);
      }
    }

    // After a failure, new selections must load normally rather than retain the old error.
    for (const [name, data, expected] of [
      ['next.json', '{"message":"SlowLook recovered after an error"}', /SlowLook recovered after an error/],
      ['notes.md', '# SlowLook markdown preview\n\n![示例](thumbnail.png)', /SlowLook markdown preview/],
    ]) {
      const next = path.join(directory, name);
      await writeFile(next, data, 'utf8');
      activeFile = { token: `token-${name}`, path: next };
      const previousReadyCount = metrics.filter((metric) => metric === 'content-ready').length;
      callbacks.start({ name });
      callbacks.preview({ url: `${origin}/preview/token-${name}/${name}`, name, size: Buffer.byteLength(data) });
      for (let attempt = 0; attempt < 300 && metrics.filter((metric) => metric === 'content-ready').length === previousReadyCount && error.hidden; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(error.hidden, true, `${name}: ${window.document.querySelector('#error-message').textContent}`);
      assert.equal(loading.hidden, true, `${name}: loading overlay remained visible after switching files`);
      assert.ok(metrics.filter((metric) => metric === 'content-ready').length > previousReadyCount, `${name}: the next file did not finish loading`);
      assert.match(window.document.querySelector('.viewer-root').shadowRoot.textContent, expected);
      if (name === 'notes.md') {
        // Supply deterministic geometry for the outline's scrolling behavior.
        const article = window.document.querySelector('.viewer-root').shadowRoot.querySelector('.markdown-body');
        for (let attempt = 0; attempt < 100 && !article.querySelector('img')?.getAttribute('src'); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
        assert.match(article.querySelector('img')?.getAttribute('src') || '', /\/preview\/image\/thumbnail\.png$/, 'relative Markdown images use a local capability URL');
        const scroller = window.document.querySelector('.viewer-root').shadowRoot.querySelector('.markdown-viewer');
        Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 300 });
        Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 1000 });
        scroller.getBoundingClientRect = () => ({ top: 0, bottom: 300, left: 0, right: 500, width: 500, height: 300 });
        const headings = ['SlowLook markdown preview', 'Second section', 'Last section'].map((title, index) => {
          const heading = window.document.createElement(index ? 'h2' : 'h1');
          heading.textContent = title;
          heading.getBoundingClientRect = () => ({ top: 20 + index * 300 - scroller.scrollTop, bottom: 40 + index * 300 - scroller.scrollTop, left: 0, right: 500, width: 500, height: 20 });
          return heading;
        });
        article.replaceChildren(...headings);
        for (let attempt = 0; attempt < 100 && window.document.querySelectorAll('.toc-item').length !== 3; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(window.document.querySelector('#markdown-toc').hidden, false, 'Markdown headings should produce an outline');
        assert.match(window.document.querySelector('.toc-item').textContent, /SlowLook markdown preview/);
        assert.equal(window.document.querySelectorAll('.toc-item')[0].getAttribute('aria-current'), 'location');
        scroller.scrollTop = 300;
        scroller.dispatchEvent(new window.Event('scroll'));
        assert.equal(window.document.querySelectorAll('.toc-item')[1].getAttribute('aria-current'), 'location', 'the outline follows the current section');
        scroller.scrollTop = 700;
        scroller.dispatchEvent(new window.Event('scroll'));
        assert.equal(window.document.querySelectorAll('.toc-item')[2].getAttribute('aria-current'), 'location', 'the last section is active at the bottom');
      }
    }

    for (const [name, bytes, expected] of [
      ['subtitles.srt', Buffer.from('1\n00:00:01,000 --> 00:00:02,000\n字幕内容\n'), /字幕内容/],
      ['unknown.unlikelyfoo', Buffer.from('Plain text in an unknown extension'), /Plain text in an unknown extension/],
      ['text-data.bin', Buffer.from('Readable text despite the binary extension'), /Readable text despite the binary extension/],
    ]) {
      const filePath = path.join(directory, name);
      await writeFile(filePath, bytes);
      activeFile = { token: name, path: filePath };
      const before = metrics.filter((metric) => metric === 'content-ready').length;
      callbacks.start({ name });
      callbacks.preview({ url: `${origin}/preview/${name}/${name}`, name, size: bytes.length });
      for (let attempt = 0; attempt < 200 && metrics.filter((metric) => metric === 'content-ready').length === before; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
      assert.match(window.document.querySelector('.viewer-root')?.shadowRoot?.textContent || '', expected, `${name} should fall back to readable text`);
    }

    for (const format of ['docx', 'xlsx', 'pptx']) {
      const filePath = fileURLToPath(new URL(`./fixtures/office-sample.${format}`, import.meta.url));
      const bytes = await readFile(filePath);
      activeFile = { token: format, path: filePath };
      const before = metrics.filter((metric) => metric === 'content-ready').length;
      callbacks.start({ name: `office-sample.${format}` });
      callbacks.preview({ url: `${origin}/preview/${format}/office-sample.${format}`, name: `office-sample.${format}`, size: bytes.length });
      for (let attempt = 0; attempt < 500 && metrics.filter((metric) => metric === 'content-ready').length === before && error.hidden; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
      const root = window.document.querySelector('.viewer-root')?.shadowRoot;
      assert.ok(root, `${format} should use the Office renderer, not fallback`);
      assert.equal(error.hidden, true, `${format}: ${window.document.querySelector('#error-message').textContent}`);
      assert.ok(metrics.filter((metric) => metric === 'content-ready').length > before, `${format} should complete or progressively show content`);
      if (format === 'docx') {
        assert.ok(root.querySelector('.docx'), 'Word document markup should be present');
        assert.ok(root.querySelector('.docx table'), 'Word tables should be present');
        assert.ok(root.querySelector('style')?.textContent, 'Word formatting stylesheet should be present');
        if (useBundle) {
          // Happy DOM cannot reproduce Word's visual layout; actual headings and
          // scrolling are also checked in a Chromium/Electron window.
          for (let attempt = 0; attempt < 300 && !window.document.querySelector('.word-outline'); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
          const outline = window.document.querySelector('.word-outline');
          assert.ok(outline, 'the packaged Word renderer mounts its navigation');
          assert.equal(outline.hidden, false, 'the Word navigation is visible on opening');
          const toggle = window.document.querySelector('.window-actions .word-outline-toggle');
          toggle.click(); assert.equal(outline.hidden, true);
          toggle.click(); assert.equal(outline.hidden, false);
        }
      } else if (format === 'xlsx') {
        for (let attempt = 0; attempt < 200 && (!/701\s*行，16\s*列/.test(root.textContent) ||
          !canvasCalls.some((call) => call.method === 'fillText') || !canvasCalls.some((call) => call.method === 'fillRect')); attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.ok(root.querySelector('canvas'), 'Excel should render into a canvas');
        assert.match(root.textContent, /701\s*行，16\s*列/, 'Excel should parse the sample sheet dimensions');
        assert.ok(canvasCalls.some((call) => call.method === 'fillText'), 'Excel should issue canvas text drawing commands');
        assert.ok(canvasCalls.some((call) => call.method === 'fillRect'), 'Excel should issue canvas fill commands');
      } else {
        for (let attempt = 0; attempt < 500 && root.querySelector('.flyfish-pptx-content')?.dataset.renderState !== 'ready'; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
        const content = root.querySelector('.flyfish-pptx-content');
        assert.equal(content?.dataset.renderState, 'ready', 'PPTX worker should finish');
        assert.match(root.querySelector('#flyfish-pptx-native-style')?.textContent || '', /\.slide div\.block\{position:absolute/, 'the shadow root must contain PPT positioning rules');
        assert.ok(content.querySelector('style')?.textContent, 'PPT generated formatting rules should be present');
        assert.ok(content.querySelector('.slide'), 'PPT slide markup should be present');
        assert.ok(content.querySelector('img[src^="data:image/"]'), 'PPT embedded images should survive sanitization');
        assert.ok(content.querySelector('svg'), 'PPT shapes should survive sanitization');
        for (let attempt = 0; attempt < 150 && !window.document.querySelector('.window-actions .document-pages'); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
        const pageControls = window.document.querySelector('.window-actions .document-pages');
        const pageSetting = window.document.querySelector('#settings-document-pages');
        assert.ok(pageControls, 'PPT page controls belong in the title bar');
        assert.equal(pageControls.nextElementSibling?.id, 'file-info-open', 'page controls are beside the information button');
        assert.equal(pageSetting.checked, true, 'page controls are enabled by default');
        pageSetting.checked = false; pageSetting.dispatchEvent(new window.Event('change', { bubbles: true }));
        assert.equal(pageControls.hidden, true, 'the setting hides page controls immediately');
        assert.equal(window.localStorage.getItem('slowlook.documentPages'), 'false');
        pageSetting.checked = true; pageSetting.dispatchEvent(new window.Event('change', { bubbles: true }));
        assert.equal(window.localStorage.getItem('slowlook.documentPages'), 'true');
        assert.equal(root.querySelector('.flyfish-pptx-content'), content, 'changing the setting does not reload the document');
      }
      if (format === 'docx' || format === 'pptx') {
        const form = root.querySelector('.file-viewer-web-search');
        const input = form?.querySelector('input[type="search"]');
        assert.ok(input, `${format} should show the viewer's search field`);
        assert.ok([...root.querySelectorAll('style')].some((style) => style.textContent.includes('file-viewer-web-search-count::before')), 'the count is labeled as search matches');
        assert.equal(form.querySelector('.file-viewer-web-search-count')?.textContent, '0/0', 'before a search this counts matches, not pages');
        input.value = format === 'docx' ? 'Quarterly' : 'Artemis';
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
        form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
        for (let attempt = 0; attempt < 150 && /\/0$/.test(root.querySelector('.file-viewer-web-search-count')?.textContent || '0/0'); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
        assert.match(root.querySelector('.file-viewer-web-search-count')?.textContent || '', /\/[1-9]\d*$/, `${format} search should find rendered text`);
      }
    }
    const protectedSource = await readFile(new URL('./fixtures/office-sample.xlsx', import.meta.url));
    const protectedBytes = officeCrypto.encrypt(protectedSource, { password: 'test123' });
    const protectedFile = path.join(directory, 'protected.xlsx'); await writeFile(protectedFile, protectedBytes);
    activeFile = { token: 'protected-office', path: protectedFile };
    window.slowLook.contentTask = async (request) => {
      try {
        const input = request.kind === 'office-data' ? Buffer.from(request.data) : protectedBytes;
        const output = await officeCrypto.decrypt(input, { password: request.password });
        return { ok: true, bytes: Uint8Array.from(output).buffer };
      } catch { return { ok: false, code: 'password', message: '密码不正确，请重试。' }; }
    };
    callbacks.start({ name: 'protected.xlsx' });
    callbacks.preview({ url: `${origin}/preview/protected-office/protected.xlsx`, name: 'protected.xlsx', size: protectedBytes.length });
    for (let attempt = 0; attempt < 200 && !window.document.querySelector('.password-card'); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(window.document.querySelector('.password-card'), 'an encrypted Office document should ask for a password');
    assert.equal(loading.hidden, true, 'password form must not be hidden under the loading layer');
    window.document.querySelector('.password-card input').value = 'wrong';
    window.document.querySelector('.password-card').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    for (let attempt = 0; attempt < 200 && !window.document.querySelector('.password-error')?.textContent.includes('密码不正确'); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(window.document.querySelector('.password-error')?.textContent || '', /密码不正确/);
    window.document.querySelector('.password-card input').value = 'test123';
    window.document.querySelector('.password-card').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    for (let attempt = 0; attempt < 500 && !window.document.querySelector('.viewer-root')?.shadowRoot?.querySelector('canvas'); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(window.document.querySelector('.viewer-root')?.shadowRoot?.querySelector('canvas'), 'decrypted XLSX reaches the spreadsheet renderer');

    const docSource = await readFile(new URL('./fixtures/office-sample.docx', import.meta.url));
    const docEncrypted = officeCrypto.encrypt(docSource, { password: 'nested123' });
    const archive = new JSZip(); archive.file('protected.docx', docEncrypted);
    const archiveBytes = await archive.generateAsync({ type: 'nodebuffer' });
    const archivePath = path.join(directory, 'protected-doc.zip'); await writeFile(archivePath, archiveBytes);
    activeFile = { token: 'protected-archive', path: archivePath };
    callbacks.start({ name: 'protected-doc.zip' });
    callbacks.preview({ url: `${origin}/preview/protected-archive/protected-doc.zip`, name: 'protected-doc.zip', size: archiveBytes.length });
    for (let attempt = 0; attempt < 200 && !window.document.querySelector('.zip-file'); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
    window.document.querySelector('.zip-file').click();
    for (let attempt = 0; attempt < 200 && !window.document.querySelector('.zip-content-body .password-card'); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(window.document.querySelector('.zip-content-body .password-card'), 'an encrypted document inside an archive should ask for its own password');
    window.document.querySelector('.zip-content-body .password-card input').value = 'nested123';
    window.document.querySelector('.zip-content-body .password-card').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    for (let attempt = 0; attempt < 500 && !window.document.querySelector('.zip-child-viewer .viewer-root')?.shadowRoot?.querySelector('.docx'); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(window.document.querySelector('.zip-child-viewer .viewer-root')?.shadowRoot?.querySelector('.docx'), 'decrypted DOCX inside ZIP reaches the renderer');
    if (useBundle) {
      for (let attempt = 0; attempt < 300 && !window.document.querySelector('.zip-child-viewer .word-outline'); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
      const outline = window.document.querySelector('.zip-child-viewer .word-outline');
      assert.ok(outline, 'nested encrypted Word mounts its navigation');
      assert.equal(outline.hidden, true, 'nested Word navigation starts collapsed');
      window.document.querySelector('.zip-content-heading .word-outline-toggle').click();
      assert.equal(outline.hidden, false);
    }
    const binaryPath = path.join(directory, 'opaque.bin');
    const binary = Buffer.from([0x00, 0x01, 0x41, 0xff]);
    await writeFile(binaryPath, binary);
    activeFile = { token: 'binary', path: binaryPath };
    callbacks.start({ name: 'opaque.bin' });
    callbacks.preview({ url: `${origin}/preview/binary/opaque.bin`, name: 'opaque.bin', size: binary.length, path: binaryPath });
    for (let attempt = 0; attempt < 200 && !window.document.querySelector('.metadata-card'); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(window.document.querySelector('.metadata-card').textContent, /opaque\.bin/);
    assert.match(window.document.querySelector('.metadata-hex').textContent, /00 01 41 FF/);

    const corrupt = path.join(directory, 'broken.docx');
    await writeFile(corrupt, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]));
    activeFile = { token: 'corrupt', path: corrupt };
    callbacks.start({ name: 'broken.docx' });
    callbacks.preview({ url: `${origin}/preview/corrupt/broken.docx`, name: 'broken.docx', size: 8, path: corrupt });
    for (let attempt = 0; attempt < 300 && !window.document.querySelector('.metadata-card'); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(window.document.querySelector('.metadata-card')?.textContent || '', /broken\.docx/, `a damaged supported format should fall back to file information (loading=${loading.hidden}, error=${error.hidden}, viewer=${window.document.querySelector('.viewer-root')?.shadowRoot?.textContent?.slice(-300)})`);
    assert.equal(loading.hidden, true);

    callbacks.start({ name: 'shortcut.lnk' });
    callbacks.preview({ url: `${origin}/preview/link/shortcut.lnk`, name: 'shortcut.lnk', size: 10, shortcut: { target: 'C:\\Target Folder\\file.txt' } });
    assert.match(window.document.querySelector('.metadata-card').textContent, /Target Folder/);

    callbacks.start({ name: '示例文件夹' });
    callbacks.directory({ id: 'root-folder', name: '示例文件夹', path: 'D:\\示例文件夹', shortcutPath: 'D:\\示例.lnk' });
    for (let attempt = 0; attempt < 100 && !window.document.querySelector('.folder-expand'); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(window.document.querySelector('.folder-summary').textContent, /1 个文件夹 · 5 个文件/);
    assert.match(window.document.querySelector('.folder-heading').textContent, /快捷方式 → D:/);
    const folderButton = window.document.querySelector('.folder-expand');
    folderButton.click();
    for (let attempt = 0; attempt < 100 && !window.document.querySelector('.folder-children')?.textContent.includes('nested.md'); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(folderButton.getAttribute('aria-expanded'), 'true');
    assert.match(window.document.querySelector('.folder-children').textContent, /nested\.md/);
    window.document.querySelector('[data-folder-file="folder-note"]').click();
    for (let attempt = 0; attempt < 300 && !window.document.querySelector('.folder-child-viewer .viewer-root')?.shadowRoot?.textContent.includes('SlowLook preview regression test'); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(window.document.querySelector('.folder-child-viewer .viewer-root')?.shadowRoot?.textContent || '', /SlowLook preview regression test/, 'folder files render through the normal viewer using a scoped URL');
    window.document.querySelector('[data-folder-file="folder-html"]').click();
    for (let attempt = 0; attempt < 100 && !window.document.querySelector('.folder-detail .html-preview iframe'); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(window.document.querySelector('.folder-detail .html-preview iframe')?.getAttribute('sandbox') || '', /allow-scripts/, 'folder HTML opens directly in the isolated viewer');
    window.document.querySelector('[data-folder-file="folder-note"]').click();
    for (let attempt = 0; attempt < 150 && !window.document.querySelector('.folder-child-viewer .viewer-root')?.shadowRoot?.textContent.includes('SlowLook preview regression test'); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
    window.document.querySelector('#settings-open').click();
    lineSetting.checked = false; lineSetting.dispatchEvent(new window.Event('change', { bubbles: true }));
    for (let attempt = 0; attempt < 150 && window.document.querySelector('.folder-child-viewer .viewer-root')?.shadowRoot?.querySelector('.code-viewer')?.dataset.lineNumbers !== 'false'; attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(window.document.querySelector('.folder-child-viewer .viewer-root').shadowRoot.querySelector('.code-viewer').dataset.lineNumbers, 'false', 'folder document settings update without reopening the file');
    lineSetting.checked = true; lineSetting.dispatchEvent(new window.Event('change', { bubbles: true }));
    const folderPreviewSetting = window.document.querySelector('#settings-folder-preview');
    folderPreviewSetting.checked = false; folderPreviewSetting.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(window.document.querySelector('.folder-detail').hidden, true, 'folder file preview can be disabled immediately');
    folderPreviewSetting.checked = true; folderPreviewSetting.dispatchEvent(new window.Event('change', { bubbles: true }));
    const hideMacMetadataSetting = window.document.querySelector('#settings-hide-mac-metadata');
    const metadataRow = window.document.querySelector('[data-folder-file="folder-mac-metadata"]').closest('li');
    assert.equal(hideMacMetadataSetting.checked, true, 'macOS metadata is hidden by default');
    assert.equal(metadataRow.hidden, true);
    hideMacMetadataSetting.checked = false; hideMacMetadataSetting.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(window.localStorage.getItem('slowlook.hideMacMetadata'), 'false', 'the setting persists');
    assert.equal(metadataRow.hidden, false, 'the current folder updates without reopening');
    window.localStorage.setItem('slowlook.hideMacMetadata', 'true');
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'slowlook.hideMacMetadata', newValue: 'true' }));
    assert.equal(hideMacMetadataSetting.checked, true, 'changes from another preview window synchronize');
    assert.equal(metadataRow.hidden, true);
    window.document.querySelector('#settings-close').click();
    window.HTMLMediaElement.prototype.pause = function () {};
    window.HTMLMediaElement.prototype.load = function () {};
    window.document.querySelector('[data-folder-file="folder-audio"]').click();
    for (let attempt = 0; attempt < 100 && !window.document.querySelector('.folder-child-viewer .audio-card'); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
    const folderAudio = window.document.querySelector('.folder-child-viewer audio');
    const folderWaveform = window.document.querySelector('.folder-child-viewer .audio-waveform-seek');
    assert.ok(folderAudio && folderWaveform, 'folder audio keeps the seekable waveform layout');
    assert.equal(folderAudio.autoplay, true);
    window.document.querySelector('[data-folder-file="folder-protected"]').click();
    for (let attempt = 0; attempt < 200 && !window.document.querySelector('.folder-detail-body .password-card'); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(window.document.querySelector('.folder-detail-body .password-card'), 'encrypted Office in a folder asks for a password');
    window.document.querySelector('.folder-detail-body .password-card input').value = 'test123';
    window.document.querySelector('.folder-detail-body .password-card').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    for (let attempt = 0; attempt < 500 && !window.document.querySelector('.folder-child-viewer .viewer-root')?.shadowRoot?.querySelector('canvas'); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(window.document.querySelector('.folder-child-viewer .viewer-root')?.shadowRoot?.querySelector('canvas'), 'encrypted folder Office reaches its renderer');
    const navBeforeFolder = navigations.length;
    folderButton.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    assert.equal(navigations.length, navBeforeFolder, 'folder navigation should not alter the file manager selection');
    callbacks.clear();
    assert.equal(window.document.querySelector('#open-default').disabled, true, 'closing a preview disables opening the previous file');
    assert.equal(window.document.querySelector('#open-feedback').hidden, true);

    const latest = path.join(directory, 'latest.txt');
    await writeFile(latest, 'latest selection wins', 'utf8');
    const beforeSwitch = metrics.filter((metric) => metric === 'content-ready').length;
    callbacks.start({ name: 'outdated.txt' });
    callbacks.preview({ url: `${origin}/preview/outdated/outdated.txt`, name: 'outdated.txt', size: 1 });
    activeFile = { token: 'latest', path: latest };
    callbacks.start({ name: 'latest.txt' });
    callbacks.preview({ url: `${origin}/preview/latest/latest.txt`, name: 'latest.txt', size: 21 });
    for (let attempt = 0; attempt < 300 && metrics.filter((metric) => metric === 'content-ready').length === beforeSwitch && error.hidden; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(error.hidden, true, window.document.querySelector('#error-message').textContent);
    assert.equal(loading.hidden, true, 'loading overlay remained visible after a rapid switch');
    assert.match(window.document.querySelector('.viewer-root').shadowRoot.textContent, /latest selection wins/);

    callbacks.start({ name: 'latest.txt' });
    callbacks.preview({ url: `${origin}/preview/latest/latest.txt`, name: 'latest.txt', size: 21 });
    callbacks.clear();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(window.document.querySelector('#welcome').hidden, false, 'closing during loading should keep the window clear');
    assert.equal(loading.hidden, true, 'closing during loading should hide the loading overlay');

    let playCount = 0;
    let pauseCount = 0;
    window.HTMLMediaElement.prototype.play = function () { playCount += 1; return Promise.resolve(); };
    window.HTMLMediaElement.prototype.pause = function () { pauseCount += 1; };
    window.HTMLMediaElement.prototype.load = function () {};
    callbacks.start({ name: 'movie.mp4' });
    callbacks.preview({ url: `${origin}/preview/movie/movie.mp4`, name: 'movie.mp4', size: 100 });
    const video = window.document.querySelector('video');
    assert.ok(video, 'common video should use the streaming browser player');
    assert.equal(video.autoplay, true);
    video.dispatchEvent(new window.Event('loadedmetadata'));
    assert.equal(playCount, 1, 'media should start automatically by default');
    assert.equal(loading.hidden, true);
    callbacks.clear();
    assert.equal(pauseCount, 1, 'closing preview should stop playback');

    window.document.querySelector('#settings-open').click();
    const autoplaySetting = window.document.querySelector('#settings-autoplay');
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'slowlook.autoplay', newValue: 'false' }));
    assert.equal(autoplaySetting.checked, false, 'settings changed in another preview apply to this window');
    window.document.querySelector('#settings-close').click();
    callbacks.start({ name: 'sound.mp3' });
    callbacks.preview({ url: `${origin}/preview/audio/sound.mp3`, name: 'sound.mp3', size: 100 });
    const audio = window.document.querySelector('audio');
    assert.ok(audio, 'common audio should use the streaming browser player');
    assert.ok(window.document.querySelector('.audio-card'), 'audio should retain a dedicated preview layout');
    assert.equal(audio.autoplay, false);
    audio.dispatchEvent(new window.Event('loadedmetadata'));
    assert.equal(playCount, 1, 'turning autoplay off should keep new media paused');
    assert.ok(window.document.querySelector('.audio-waveform-seek'), 'audio exposes a seekable waveform');
    callbacks.clear();

    const tiff = Buffer.alloc(32);
    tiff.write('II');
    tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4); tiff.writeUInt16LE(1, 8);
    tiff.writeUInt16LE(0x10f, 10); tiff.writeUInt16LE(2, 12); tiff.writeUInt32LE(6, 14); tiff.writeUInt32LE(26, 18);
    tiff.write('Canon\0', 26);
    const jpeg = Buffer.concat([Buffer.from([255, 216, 255, 225, 0, 40]), Buffer.from('Exif\0\0'), tiff, Buffer.from([255, 217])]);
    const photo = path.join(directory, 'photo.jpg');
    await writeFile(photo, jpeg);
    activeFile = { token: 'photo', path: photo };
    callbacks.start({ name: 'photo.jpg' });
    callbacks.preview({ url: `${origin}/preview/photo/photo.jpg`, name: 'photo.jpg', size: jpeg.length, path: photo });
    const photoImage = window.document.querySelector('.browser-image-view img');
    Object.defineProperties(photoImage, { naturalWidth: { value: 1200 }, naturalHeight: { value: 800 } });
    photoImage.dispatchEvent(new window.Event('load'));
    assert.match(window.document.querySelector('#file-size').textContent, /1200 × 800 px/);
    window.document.querySelector('#file-info-open').click();
    for (let attempt = 0; attempt < 200 && !window.document.querySelector('#file-info-content').textContent.includes('Canon'); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.match(window.document.querySelector('#file-info-content').textContent, /Canon/, 'EXIF information should be read from the bounded image header');
    assert.match(window.document.querySelector('#file-info-content').textContent, /图像尺寸1200 × 800 px/);
    callbacks.clear();

    const large = path.join(directory, '大文件.log');
    const largeBytes = Buffer.alloc(17 * 1024 * 1024, 'a\n');
    Buffer.from('开始预览\n').copy(largeBytes, 0);
    Buffer.from('\n结束预览').copy(largeBytes, largeBytes.length - Buffer.byteLength('\n结束预览'));
    await writeFile(large, largeBytes);
    callbacks.start({ name: '示例文件夹' });
    callbacks.directory({ id: 'root-folder', name: '示例文件夹', path: 'D:\\示例文件夹' });
    for (let attempt = 0; attempt < 100 && !window.document.querySelector('[data-folder-file="folder-large"]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
    window.document.querySelector('[data-folder-file="folder-large"]').click();
    for (let attempt = 0; attempt < 200 && !window.document.querySelector('.folder-text-fragment pre'); attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(window.document.querySelector('.folder-text-fragment pre')?.textContent.startsWith('开始预览'));
    assert.ok(window.document.querySelector('.folder-text-fragment pre').textContent.length <= 1024 * 1024, 'large folder text is limited to the first MiB');
    assert.match(window.document.querySelector('.folder-text-fragment p').textContent, /仅显示开头/);
    callbacks.clear();
    activeFile = { token: 'large', path: large };
    const readyBeforeLarge = metrics.filter((metric) => metric === 'content-ready').length;
    callbacks.start({ name: '大文件.log' });
    callbacks.preview({ url: `${origin}/preview/large/${encodeURIComponent('大文件.log')}`, name: '大文件.log', size: largeBytes.length });
    for (let attempt = 0; attempt < 300 && metrics.filter((metric) => metric === 'content-ready').length === readyBeforeLarge && error.hidden; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(error.hidden, true, window.document.querySelector('#error-message').textContent);
    assert.equal(loading.hidden, true);
    const largeText = window.document.querySelector('#large-text-content');
    assert.ok(largeText.textContent.startsWith('开始预览'));
    assert.ok(largeText.textContent.length <= 1024 * 1024, 'large text preview should read a bounded chunk');
    assert.match(window.document.querySelector('#large-text-label').textContent, /仅显示开头/);
    const numbers = window.document.querySelector('.large-text-gutter-numbers');
    assert.ok(numbers.textContent.split('\n').length < 50, 'only visible line numbers should be in the DOM');
    const scroller = window.document.querySelector('.large-text-scroll');
    scroller.scrollTop = 2100;
    scroller.dispatchEvent(new window.Event('scroll'));
    assert.ok(Number(numbers.textContent.split('\n')[0]) > 80, 'line numbers follow the scrolled text');
    const tailButton = [...window.document.querySelectorAll('.large-text-toolbar button')].find((button) => button.textContent === '文件末尾');
    tailButton.click();
    for (let attempt = 0; attempt < 300 && loading.hidden === false; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(largeText.textContent.endsWith('结束预览'));
    assert.match(window.document.querySelector('#large-text-label').textContent, /仅显示末尾/);
    assert.match(window.document.querySelector('#large-text-label').textContent, /行号从片段开始/);
    assert.ok([...window.document.querySelectorAll('.large-text-toolbar button')].some((button) => button.textContent === '完整加载'));
    callbacks.clear();

    // A synthetic size exercises the 5 GiB guard without allocating a 5 GiB test file.
    activeFile = { token: 'large', path: large };
    callbacks.start({ name: '大文件.log' });
    callbacks.preview({ url: `${origin}/preview/large/${encodeURIComponent('大文件.log')}`, name: '大文件.log', size: 5 * 1024 ** 3 });
    for (let attempt = 0; attempt < 200 && loading.hidden === false; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    const fullButton = [...window.document.querySelectorAll('.large-text-toolbar button')].find((button) => button.textContent === '完整加载');
    assert.equal(fullButton.hidden, true, 'very large text files should not offer an unbounded full load');
    callbacks.clear();

    // Optional local regression: the file is read in place and never copied to fixtures.
    if (process.env.SLOWLOOK_TEST_LARGE_ZIP) {
      const userZip = process.env.SLOWLOOK_TEST_LARGE_ZIP;
      const size = (await stat(userZip)).size;
      activeFile = { token: 'user-zip', path: userZip };
      callbacks.start({ name: 'large.xlsx' });
      callbacks.preview({ url: `${origin}/preview/user-zip/large.xlsx`, name: 'large.xlsx', size });
      for (let attempt = 0; attempt < 300 && !window.document.querySelector('.zip-folder'); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
      assert.ok(window.document.querySelector('.zip-folder'), 'large Office packages should show a bounded structure view first');
      assert.match(window.document.querySelector('.zip-full-preview')?.textContent || '', /完整预览/);
      callbacks.start({ name: 'large.zip' });
      callbacks.preview({ url: `${origin}/preview/user-zip/large.zip`, name: 'large.zip', size });
      for (let attempt = 0; attempt < 300 && !window.document.querySelector('.zip-folder'); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
      assert.ok(window.document.querySelector('.zip-folder'), 'large ZIP should display its directory');
      const filter = window.document.querySelector('.zip-controls input');
      filter.value = '.docx'; filter.dispatchEvent(new window.Event('input', { bubbles: true }));
      const firstDoc = window.document.querySelector('.zip-file');
      assert.ok(firstDoc, 'large ZIP should expose a DOCX item');
      firstDoc.click();
      for (let attempt = 0; attempt < 500 && !window.document.querySelector('.zip-child-viewer .viewer-root')?.shadowRoot?.querySelector('.docx'); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
      assert.ok(window.document.querySelector('.zip-child-viewer .viewer-root')?.shadowRoot?.querySelector('.docx'),
        `a selected DOCX inside the large ZIP should render: ${window.document.querySelector('.zip-content-body .zip-empty')?.textContent || 'no result'}`);
      callbacks.clear();
    }
  } finally {
    await window.happyDOM.close();
    if (originalNodeName) Object.defineProperty(window.Node.prototype, 'nodeName', originalNodeName);
    for (const [name, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}

test('source renderer handles loading, errors and switching with local files', () => verifyTextPreview(false));
test('built renderer handles loading, errors and switching with local files', {
  skip: !existsSync(new URL('../build/dist/index.html', import.meta.url)),
}, () => verifyTextPreview(true));
test('portable renderer handles loading, errors and switching with local files', {
  skip: !portableDist ? 'set SLOWLOOK_PORTABLE_DIST to test a portable build' : false,
}, () => {
  assert.ok(existsSync(path.join(portableDist, 'index.html')), 'configured portable renderer is missing');
  return verifyTextPreview(true, portableDist);
});
