import { readZipDirectory, type ZipDirectory, type ZipEntry, type ZipNameEncoding } from './zip-directory.ts';
import { extractZipEntry } from './zip-extraction.ts';
import { requestPassword } from './password-prompt.ts';

interface ZipSource { name: string; url: string; size: number }
interface Tree { name: string; folders: Map<string, Tree>; files: ZipEntry[] }
type RenderEntry = (name: string, data: Blob, target: HTMLElement, signal: AbortSignal) => Promise<(() => void) | undefined>;
interface ArchiveDirectory { entries: ZipEntry[]; zip?: ZipDirectory }
export interface ContentResponse {
  ok: boolean; code?: string; message?: string; bytes?: ArrayBuffer;
  entries?: Array<{ name: string; directory: boolean; encrypted: boolean; size: number; compressedSize: number }>;
}
export type ContentRequest = { url: string; kind: 'rar-list' | 'rar-entry' | 'office' | 'office-data'; password?: string; headerPassword?: string; index?: number; data?: ArrayBuffer };
type ContentTask = (request: ContentRequest, signal: AbortSignal) => Promise<ContentResponse>;
interface ArchiveBackend {
  label: string;
  list(encoding: ZipNameEncoding, password: string, signal: AbortSignal): Promise<ArchiveDirectory>;
  read(directory: ArchiveDirectory, entry: ZipEntry, password: string, headerPassword: string, signal: AbortSignal): Promise<Blob>;
  close?(directory: ArchiveDirectory): void;
}

class ArchivePasswordError extends Error {}
function contentError(result: ContentResponse): Error {
  return result.code === 'password' ? new ArchivePasswordError(result.message || '请输入密码。') : new Error(result.message || '无法读取压缩包。');
}

function treeOf(entries: ZipEntry[]): { root: Tree; skipped: number; safeEntries: ZipEntry[] } {
  const root: Tree = { name: '', folders: new Map(), files: [] };
  let skipped = 0;
  const safeEntries: ZipEntry[] = [];
  for (const entry of entries) {
    const parts = entry.name.split('/').filter(Boolean);
    if (!parts.length || parts.length > 64 || entry.name.startsWith('/') || /^[A-Za-z]:/.test(entry.name) || parts.some((part) => part === '.' || part === '..')) { skipped += 1; continue; }
    safeEntries.push(entry);
    const folders = entry.directory ? parts : parts.slice(0, -1);
    let node = root;
    for (const name of folders) {
      let child = node.folders.get(name);
      if (!child) { child = { name, folders: new Map(), files: [] }; node.folders.set(name, child); }
      node = child;
    }
    if (!entry.directory) node.files.push(entry);
  }
  return { root, skipped, safeEntries };
}

/** All ZIPs use the same range-based directory and selected-entry reader. */
export function mountZipPreview(target: HTMLElement, file: ZipSource, onReady: () => void, renderEntry: RenderEntry,
  options: { label?: string; fullPreview?: () => void } = {}): () => void {
  return mountArchive(target, file, onReady, renderEntry, {
    label: options.label || 'ZIP ARCHIVE',
    async list(encoding, _password, signal) { const zip = await readZipDirectory(file.url, file.size, signal, encoding); return { entries: zip.entries, zip }; },
    async read(directory, entry, password, _headerPassword, signal) {
      try { return await extractZipEntry(file.url, file.size, directory.zip!, entry, signal, password); }
      catch (error) { if (entry.flags & 1 && error instanceof Error && /密码/.test(error.message)) throw new ArchivePasswordError(error.message); throw error; }
    },
    close(directory) { void directory.zip?.reader.close(); },
  }, true, options.fullPreview);
}

/** RAR input is seekable file IO in an isolated WASM worker, never a full-file buffer. */
export function mountRarPreview(target: HTMLElement, file: ZipSource, onReady: () => void, renderEntry: RenderEntry, task: ContentTask): () => void {
  return mountArchive(target, file, onReady, renderEntry, {
    label: 'RAR ARCHIVE',
    async list(_encoding, password, signal) {
      const result = await task({ url: file.url, kind: 'rar-list', headerPassword: password || undefined }, signal);
      if (!result.ok || !result.entries) throw contentError(result);
      return { entries: result.entries.map((entry, index) => ({ name: entry.name, directory: entry.directory,
        flags: entry.encrypted ? 1 : 0, method: 0, crc: 0, compressedSize: entry.compressedSize, size: entry.size, localOffset: index })) };
    },
    async read(_directory, entry, password, headerPassword, signal) {
      const result = await task({ url: file.url, kind: 'rar-entry', index: entry.localOffset,
        password: password || undefined, headerPassword: headerPassword || undefined }, signal);
      if (!result.ok || !result.bytes) throw contentError(result);
      return new Blob([result.bytes]);
    },
  }, false);
}

function mountArchive(target: HTMLElement, file: ZipSource, onReady: () => void, renderEntry: RenderEntry, backend: ArchiveBackend, showEncoding: boolean, fullPreview?: () => void): () => void {
  const root = document.createElement('section');
  root.className = 'zip-view';
  const sidebar = document.createElement('aside'); sidebar.className = 'zip-sidebar';
  const heading = document.createElement('div'); heading.className = 'zip-heading';
  const eyebrow = document.createElement('span'); eyebrow.textContent = backend.label;
  const title = document.createElement('strong'); title.textContent = file.name; title.title = file.name;
  const summary = document.createElement('p'); summary.textContent = '正在读取目录…'; summary.setAttribute('role', 'status');
  heading.append(eyebrow, title, summary);
  if (fullPreview) {
    const note = document.createElement('p'); note.textContent = '文件较大，先展示内部结构。完整预览可能占用大量内存。';
    const open = document.createElement('button'); open.type = 'button'; open.className = 'zip-full-preview'; open.textContent = '完整预览文档';
    open.addEventListener('click', () => { open.disabled = true; fullPreview(); }, { once: true }); heading.append(note, open);
  }
  const controls = document.createElement('div'); controls.className = 'zip-controls';
  const search = document.createElement('input'); search.type = 'search'; search.placeholder = '筛选包内文件'; search.setAttribute('aria-label', '筛选包内文件');
  const encoding = document.createElement('select'); encoding.setAttribute('aria-label', '文件名编码');
  for (const [value, label] of [['auto', '编码：自动'], ['utf-8', 'UTF-8'], ['gb18030', 'GBK / GB18030'], ['cp437', 'CP437']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = label; encoding.append(option);
  }
  controls.append(search, encoding);
  encoding.hidden = !showEncoding;
  const list = document.createElement('div'); list.className = 'zip-tree';
  sidebar.append(heading, controls, list);
  const content = document.createElement('section'); content.className = 'zip-content';
  const contentHeader = document.createElement('div'); contentHeader.className = 'zip-content-heading';
  contentHeader.textContent = '选择一个文件进行预览';
  const contentBody = document.createElement('div'); contentBody.className = 'zip-content-body';
  const placeholder = document.createElement('p'); placeholder.className = 'zip-empty'; placeholder.textContent = '展开左侧文件夹，选择要查看的文件';
  contentBody.append(placeholder); content.append(contentHeader, contentBody);
  root.append(sidebar, content); target.replaceChildren(root);

  let disposed = false;
  let directory: ArchiveDirectory | undefined;
  let readAbort: AbortController | undefined;
  let entryAbort: AbortController | undefined;
  let cleanupEntry: (() => void) | undefined;
  let selected = 0;
  let currentTree: Tree | undefined;
  let safeEntries: ZipEntry[] = [];
  let readyCalled = false;
  let headerPassword = '';
  let entryPassword = '';
  const finishReady = (): void => { if (!readyCalled && !disposed) { readyCalled = true; onReady(); } };
  const clearEntry = (): void => {
    selected += 1; entryAbort?.abort(); entryAbort = undefined; cleanupEntry?.(); cleanupEntry = undefined;
  };

  const choose = async (entry: ZipEntry): Promise<void> => {
    if (!directory || disposed) return;
    clearEntry();
    const version = selected;
    const operation = new AbortController(); entryAbort = operation;
    contentHeader.textContent = entry.name;
    const status = document.createElement('p'); status.className = 'zip-empty'; status.textContent = '正在读取包内文件…';
    contentBody.replaceChildren(status);
    try {
      let password = entryPassword || headerPassword;
      let previousError = '';
      let blob: Blob;
      while (true) {
        if ((entry.flags & 1) && !password) {
          const given = await requestPassword(contentBody, entry.name, operation.signal, previousError);
          if (given === null) { if (!operation.signal.aborted) { status.textContent = '已取消预览。'; contentBody.replaceChildren(status); } return; }
          password = given;
        }
        contentBody.replaceChildren(status); status.textContent = '正在读取包内文件…';
        try { blob = await backend.read(directory, entry, password, headerPassword, operation.signal); break; }
        catch (error) {
          if (!(error instanceof ArchivePasswordError) || operation.signal.aborted) throw error;
          previousError = error.message; password = ''; entryPassword = '';
        }
      }
      if (entry.flags & 1) entryPassword = password;
      if (disposed || version !== selected) return;
      const mount = document.createElement('div'); mount.className = 'zip-child-viewer'; contentBody.replaceChildren(mount);
      const cleanup = await renderEntry(entry.name.split('/').pop() || entry.name, blob, mount, operation.signal);
      if (disposed || version !== selected) cleanup?.(); else cleanupEntry = cleanup;
    } catch (error) {
      if (!disposed && version === selected && !operation.signal.aborted) {
        status.textContent = error instanceof Error ? error.message : '无法预览包内文件。';
        contentBody.replaceChildren(status);
      }
    }
  };

  function fileButton(entry: ZipEntry, indent = 0): HTMLButtonElement {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'zip-row zip-file';
    button.style.paddingLeft = `${12 + indent * 14}px`;
    const icon = document.createElement('span'); icon.className = 'zip-glyph'; icon.textContent = '▤'; icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span'); label.className = 'zip-row-name'; label.textContent = search.value.trim() ? entry.name : entry.name.split('/').pop() || entry.name; label.title = entry.name;
    button.append(icon, label);
    if (entry.flags & 1) { const note = document.createElement('small'); note.textContent = '加密'; button.append(note); }
    button.addEventListener('click', () => {
      list.querySelector('[aria-current="true"]')?.removeAttribute('aria-current'); button.setAttribute('aria-current', 'true');
      void choose(entry);
    });
    return button;
  }

  function renderTree(node: Tree, parent: HTMLElement, depth: number): void {
    const folders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    const entries: Array<{ folder: Tree } | { file: ZipEntry }> = [
      ...folders.map((folder) => ({ folder })), ...node.files.map((file) => ({ file })),
    ];
    const more = document.createElement('button'); more.type = 'button'; more.className = 'zip-more';
    let shown = 0;
    const appendMore = (): void => {
      more.remove();
      for (const entry of entries.slice(shown, shown + 200)) {
        if ('file' in entry) { parent.append(fileButton(entry.file, depth)); continue; }
        const folder = entry.folder;
        const button = document.createElement('button'); button.type = 'button'; button.className = 'zip-row zip-folder';
        button.style.paddingLeft = `${12 + depth * 14}px`; button.setAttribute('aria-expanded', 'false');
        const icon = document.createElement('span'); icon.className = 'zip-glyph'; icon.textContent = '▸'; icon.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span'); label.className = 'zip-row-name'; label.textContent = folder.name; label.title = folder.name;
        button.append(icon, label);
        const children = document.createElement('div'); children.hidden = true;
        let built = false;
        button.addEventListener('click', () => {
          children.hidden = !children.hidden; button.setAttribute('aria-expanded', String(!children.hidden)); icon.textContent = children.hidden ? '▸' : '▾';
          if (!children.hidden && !built) { built = true; renderTree(folder, children, depth + 1); }
        });
        parent.append(button, children);
      }
      shown = Math.min(entries.length, shown + 200);
      if (shown < entries.length) { more.textContent = `加载更多（${shown} / ${entries.length}）`; parent.append(more); }
    };
    more.addEventListener('click', appendMore); appendMore();
  }

  const renderList = (): void => {
    list.replaceChildren();
    if (!directory || !currentTree) return;
    const query = search.value.trim().toLocaleLowerCase();
    if (!query) { renderTree(currentTree, list, 0); return; }
    const results = safeEntries.filter((entry) => !entry.directory && entry.name.toLocaleLowerCase().includes(query));
    let shown = 0;
    const more = document.createElement('button'); more.type = 'button'; more.className = 'zip-more';
    const appendMore = (): void => {
      more.remove();
      for (const entry of results.slice(shown, shown + 200)) list.append(fileButton(entry));
      shown = Math.min(results.length, shown + 200);
      if (shown < results.length) { more.textContent = `加载更多（${shown} / ${results.length}）`; list.append(more); }
      else if (!results.length) list.textContent = '没有匹配的文件';
    };
    more.addEventListener('click', appendMore); appendMore();
  };
  search.addEventListener('input', renderList);

  const load = async (): Promise<void> => {
    readAbort?.abort(); clearEntry();
    if (directory) backend.close?.(directory);
    directory = undefined;
    const operation = new AbortController(); readAbort = operation;
    contentHeader.textContent = '选择一个文件进行预览'; contentBody.replaceChildren(placeholder);
    summary.textContent = '正在读取目录…'; list.replaceChildren();
    try {
      let result: ArchiveDirectory;
      let previousError = '';
      while (true) {
        try { result = await backend.list(encoding.value as ZipNameEncoding, headerPassword, operation.signal); break; }
        catch (error) {
          if (!(error instanceof ArchivePasswordError) || operation.signal.aborted) throw error;
          finishReady(); summary.textContent = '此压缩包的目录已加密';
          const given = await requestPassword(contentBody, file.name, operation.signal, previousError || error.message);
          if (given === null) {
            if (!operation.signal.aborted) { summary.textContent = '已取消打开加密目录。'; placeholder.textContent = '关闭预览后可重新打开并输入密码'; contentBody.replaceChildren(placeholder); }
            return;
          }
          headerPassword = given; previousError = error.message;
        }
      }
      if (disposed || operation.signal.aborted) { backend.close?.(result); return; }
      directory = result;
      contentBody.replaceChildren(placeholder);
      const tree = treeOf(result.entries); currentTree = tree.root; safeEntries = tree.safeEntries;
      summary.textContent = `${result.entries.length} 项 · 按需读取${tree.skipped ? ` · 跳过 ${tree.skipped} 个异常路径` : ''}`;
      renderList();
      if (!result.entries.length) list.textContent = '压缩包为空';
    } catch (error) {
      if (!disposed && !operation.signal.aborted) { directory = undefined; summary.textContent = error instanceof Error ? error.message : '无法读取压缩包目录。'; }
    } finally { if (readAbort === operation && !operation.signal.aborted) finishReady(); }
  };
  encoding.addEventListener('change', () => { void load(); });
  void load();
  return () => { disposed = true; readAbort?.abort(); clearEntry(); if (directory) backend.close?.(directory); headerPassword = ''; entryPassword = ''; };
}
