import { createSidebarToggle } from '../../ui/sidebar-toggle.ts';

export interface FolderEntry {
  name: string;
  kind: 'directory' | 'file' | 'link' | 'other';
  id?: string;
}
export interface FolderPage { entries: FolderEntry[]; nextOffset: number | null; truncated: boolean }
export interface FolderPreview { name: string; path: string; id: string; shortcutPath?: string; modifiedAt?: string }
export interface FolderFile { url: string; name: string; size: number; modifiedAt?: string; createdAt?: string }
export interface FolderOptions { thumbnails: boolean; inlinePreview: boolean }
export interface FolderView { dispose(): void; setOptions(options: FolderOptions): void }
interface FolderNode { id: string; list: HTMLUListElement; footer: HTMLElement; next: number | null; loaded: boolean; loading: boolean }

const imageExtension = /\.(?:png|jpe?g|gif|webp|bmp|avif)$/i;
function fileKind(name: string): { label: string; kind: string } {
  const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const groups: Record<string, string[]> = {
    image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'avif', 'tif', 'tiff', 'psd'],
    document: ['doc', 'docx', 'rtf', 'odt', 'pdf', 'ofd', 'epub'],
    spreadsheet: ['xls', 'xlsx', 'csv', 'ods'],
    presentation: ['ppt', 'pptx', 'odp'],
    archive: ['zip', 'rar', '7z', 'tar', 'gz', 'iso'],
    media: ['mp3', 'wav', 'flac', 'm4a', 'mp4', 'mov', 'mkv', 'avi', 'webm'],
    code: ['js', 'ts', 'tsx', 'jsx', 'json', 'py', 'rs', 'cs', 'java', 'html', 'css', 'xml', 'sql', 'sh', 'yml', 'yaml'],
    text: ['txt', 'md', 'markdown', 'log', 'srt', 'vtt', 'lrc'],
  };
  const kind = Object.entries(groups).find(([, values]) => values.includes(extension))?.[0] || 'other';
  return { label: (extension || 'FILE').slice(0, 4).toUpperCase(), kind };
}

/** An expanded directory and every opened file stay scoped to this view. */
export function mountFolderPreview(
  target: HTMLElement, folder: FolderPreview,
  read: (id: string, offset: number) => Promise<FolderPage>,
  onReady: () => void,
  callbacks: {
    open(id: string, purpose: 'thumbnail' | 'preview'): Promise<FolderFile>;
    render(file: FolderFile, target: HTMLElement, signal: AbortSignal): Promise<(() => void) | undefined>;
    release(): void;
  },
  initial: FolderOptions,
): FolderView {
  let disposed = false, total = 0, folders = 0, files = 0;
  let options = initial;
  let operation: AbortController | undefined;
  let cleanupEntry: (() => void) | undefined;
  let selected: FolderEntry | undefined;
  const root = document.createElement('section'); root.className = 'folder-browser';
  const tree = document.createElement('div'); tree.className = 'folder-view';
  const header = document.createElement('header'); header.className = 'folder-heading';
  const icon = document.createElement('div'); icon.className = 'folder-icon'; icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<svg viewBox="0 0 32 32"><path d="M3 8.5h9l3 3h14v13.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
  const description = document.createElement('div');
  const title = document.createElement('h2'); title.textContent = folder.name;
  const folderPath = document.createElement('p');
  folderPath.textContent = folder.shortcutPath ? `快捷方式 → ${folder.path}` : folder.path;
  folderPath.title = folder.shortcutPath ? `${folder.shortcutPath} → ${folder.path}` : folder.path;
  description.append(title, folderPath); header.append(icon, description);
  const summary = document.createElement('p'); summary.className = 'folder-summary'; summary.textContent = '正在读取文件夹…';
  const list = document.createElement('ul'); list.className = 'folder-list';
  const footer = document.createElement('div'); footer.className = 'folder-footer';
  tree.append(header, summary, list, footer);
  const detail = document.createElement('section'); detail.className = 'folder-detail'; detail.setAttribute('aria-label', '文件预览');
  const detailHeader = document.createElement('div'); detailHeader.className = 'folder-detail-heading';
  const detailTitle = document.createElement('span'); detailTitle.className = 'preview-detail-title'; detailTitle.textContent = '文件预览';
  const sidebarToggle = createSidebarToggle(root, tree); detailHeader.append(sidebarToggle.button, detailTitle);
  const body = document.createElement('div'); body.className = 'folder-detail-body';
  const placeholder = document.createElement('p'); placeholder.className = 'folder-detail-empty'; placeholder.textContent = '选择左侧文件，在这里预览';
  body.append(placeholder); detail.append(detailHeader, body); root.append(tree, detail); target.replaceChildren(root);

  const candidates = new Map<HTMLElement, { entry: FolderEntry; image: HTMLImageElement; glyph: HTMLElement }>();
  const queue: HTMLElement[] = [];
  const queued = new Set<HTMLElement>();
  const visible = new Set<HTMLElement>();
  const loaded = new Set<HTMLElement>();
  const active = new Map<HTMLElement, () => void>();
  let inflight = 0;
  let updatingVisibility = false;
  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => {
    updatingVisibility = true;
    for (const record of entries) {
      const element = record.target as HTMLElement;
      if (!record.isIntersecting) {
        visible.delete(element);
        const index = queue.indexOf(element); if (index >= 0) queue.splice(index, 1);
        active.get(element)?.(); queued.delete(element);
        const candidate = candidates.get(element);
        if (candidate && loaded.delete(element)) {
          candidate.image.onload = null; candidate.image.onerror = null; candidate.image.removeAttribute('src');
          candidate.image.hidden = true; candidate.glyph.hidden = false;
        }
        continue;
      }
      visible.add(element);
      if (!options.thumbnails || queued.has(element)) continue;
      queued.add(element); queue.push(element);
    }
    updatingVisibility = false; pump();
  }, { root: tree, rootMargin: '120px' }) : undefined;
  function pump(): void {
    if (updatingVisibility) return;
    while (!disposed && options.thumbnails && inflight < 4 && queue.length) {
      const element = queue.shift()!;
      const candidate = candidates.get(element);
      if (!candidate || !candidate.entry.id || !visible.has(element)) { queued.delete(element); continue; }
      // A cancelled image may still have a queued DOM event. A fresh element
      // makes that old event unable to complete a later request for this row.
      const previousImage = candidate.image;
      const image = previousImage.cloneNode(false) as HTMLImageElement;
      image.removeAttribute('src'); image.hidden = true;
      previousImage.replaceWith(image); candidate.image = image;
      inflight += 1;
      let finished = false;
      let timer: ReturnType<typeof setTimeout>;
      const finish = (): void => {
        if (finished) return; finished = true; clearTimeout(timer);
        active.delete(element); inflight -= 1; pump();
      };
      const cancel = (): void => { queued.delete(element); image.onload = null; image.onerror = null; image.removeAttribute('src'); image.hidden = true; candidate.glyph.hidden = false; finish(); };
      active.set(element, cancel);
      timer = setTimeout(cancel, 10000);
      void callbacks.open(candidate.entry.id, 'thumbnail').then((file) => {
        if (disposed || !options.thumbnails || finished) { finish(); return; }
        image.onload = () => {
          if (finished || active.get(element) !== cancel || !visible.has(element)) return;
          if (!disposed && options.thumbnails) { image.hidden = false; candidate.glyph.hidden = true; }
          loaded.add(element); finish();
        };
        image.onerror = () => {
          if (finished || active.get(element) !== cancel) return;
          image.hidden = true; candidate.glyph.hidden = false; queued.delete(element); finish();
        };
        image.src = file.url;
      }).catch(finish);
    }
  }
  const addThumbnail = (holder: HTMLElement, entry: FolderEntry, glyph: HTMLElement): void => {
    if (!entry.id || !imageExtension.test(entry.name)) return;
    const image = document.createElement('img'); image.className = 'folder-thumbnail'; image.alt = ''; image.hidden = true; image.decoding = 'async';
    holder.append(image); candidates.set(holder, { entry, image, glyph });
    if (options.thumbnails) observer?.observe(holder);
  };
  function clearSelection(): void {
    operation?.abort(); operation = undefined;
    cleanupEntry?.(); cleanupEntry = undefined;
    callbacks.release();
  }
  const choose = async (entry: FolderEntry): Promise<void> => {
    if (!entry.id || !options.inlinePreview || disposed) return;
    clearSelection(); selected = entry;
    tree.querySelector('[aria-current="true"]')?.removeAttribute('aria-current');
    [...tree.querySelectorAll<HTMLElement>('[data-folder-file]')].find((el) => el.dataset.folderFile === entry.id)?.setAttribute('aria-current', 'true');
    const current = new AbortController(); operation = current;
    detailTitle.textContent = entry.name;
    const status = document.createElement('p'); status.className = 'folder-detail-empty'; status.textContent = '正在准备预览…'; body.replaceChildren(status);
    try {
      const file = await callbacks.open(entry.id, 'preview');
      if (disposed || current.signal.aborted) return;
      const mount = document.createElement('div'); mount.className = 'folder-child-viewer'; body.replaceChildren(mount);
      const cleanup = await callbacks.render(file, mount, current.signal);
      if (disposed || current.signal.aborted) cleanup?.(); else cleanupEntry = cleanup;
    } catch (error) {
      if (!disposed && !current.signal.aborted) {
        status.textContent = error instanceof Error ? error.message : '无法预览此文件。';
        body.replaceChildren(status);
      }
    }
  };

  const load = async (node: FolderNode, isRoot: boolean): Promise<void> => {
    if (node.loading || (node.loaded && node.next === null) || disposed) return;
    node.loading = true; node.footer.textContent = '正在读取…';
    try {
      const page = await read(node.id, node.next ?? 0);
      if (disposed) return;
      node.loaded = true; node.next = page.nextOffset;
      for (const entry of page.entries) {
        const item = document.createElement('li'); item.className = `folder-item folder-${entry.kind}`;
        if (entry.kind === 'directory' && entry.id) {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'folder-row folder-expand'; button.setAttribute('aria-expanded', 'false');
          const arrow = document.createElement('span'); arrow.className = 'folder-chevron'; arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '›';
          const glyph = document.createElement('span'); glyph.className = 'folder-glyph folder-directory-glyph'; glyph.textContent = '▰'; glyph.setAttribute('aria-hidden', 'true');
          const name = document.createElement('span'); name.className = 'folder-name'; name.textContent = entry.name;
          button.append(arrow, glyph, name);
          const children = document.createElement('div'); children.className = 'folder-children'; children.hidden = true;
          const childList = document.createElement('ul'); childList.className = 'folder-list';
          const childFooter = document.createElement('div'); childFooter.className = 'folder-footer'; children.append(childList, childFooter);
          const child: FolderNode = { id: entry.id, list: childList, footer: childFooter, next: 0, loaded: false, loading: false };
          button.addEventListener('click', () => {
            const expanding = children.hidden; children.hidden = !expanding; button.setAttribute('aria-expanded', String(expanding));
            if (expanding && !child.loaded) void load(child, false);
          });
          item.append(button, children);
        } else {
          const row = document.createElement(entry.kind === 'file' && entry.id ? 'button' : 'div');
          if (row instanceof HTMLButtonElement) { row.type = 'button'; row.disabled = !options.inlinePreview; row.dataset.folderFile = entry.id; row.addEventListener('click', () => { void choose(entry); }); }
          row.className = 'folder-row folder-file-row';
          const holder = document.createElement('span'); holder.className = 'folder-file-icon'; holder.setAttribute('aria-hidden', 'true');
          const glyph = document.createElement('span');
          const type = fileKind(entry.name); glyph.className = `folder-type folder-type-${type.kind}`; glyph.textContent = entry.kind === 'link' ? '↗' : type.label;
          holder.append(glyph); if (entry.kind === 'file') addThumbnail(holder, entry, glyph);
          const name = document.createElement('span'); name.className = 'folder-name'; name.textContent = entry.name; name.title = entry.name;
          row.append(holder, name);
          if (entry.kind === 'link' || (entry.kind === 'directory' && !entry.id) || (entry.kind === 'file' && !entry.id)) {
            const note = document.createElement('span'); note.className = 'folder-item-note'; note.textContent = entry.kind === 'link' ? '链接，不展开' : '已达上限'; row.append(note);
          }
          item.append(row);
        }
        node.list.append(item);
        if (isRoot) { total += 1; if (entry.kind === 'directory') folders += 1; else if (entry.kind === 'file') files += 1; }
      }
      if (isRoot) summary.textContent = `已读取 ${total} 项 · ${folders} 个文件夹 · ${files} 个文件${page.nextOffset !== null || page.truncated ? '（部分内容）' : ''} · 未计算大小`;
      node.footer.replaceChildren();
      if (!node.list.children.length) node.footer.textContent = '此文件夹为空';
      else if (page.truncated) node.footer.textContent = '已显示前 2000 项';
      else if (page.nextOffset !== null) {
        const more = document.createElement('button'); more.type = 'button'; more.className = 'folder-more'; more.textContent = '加载更多';
        more.addEventListener('click', () => { void load(node, isRoot); }); node.footer.append(more);
      }
    } catch (error) {
      if (disposed) return;
      node.footer.textContent = error instanceof Error ? `无法读取：${error.message}` : '无法读取文件夹';
      if (isRoot) summary.textContent = '未能读取文件夹内容';
    } finally { node.loading = false; if (isRoot && !disposed) onReady(); }
  };
  function setOptions(next: FolderOptions): void {
    const wasInline = options.inlinePreview;
    const hadThumbnails = options.thumbnails;
    options = next;
    root.classList.toggle('has-file-preview', options.inlinePreview);
    detail.hidden = !options.inlinePreview;
    tree.querySelectorAll<HTMLButtonElement>('button[data-folder-file]').forEach((button) => { button.disabled = !options.inlinePreview; });
    if (wasInline && !options.inlinePreview) { sidebarToggle.setExpanded(true); clearSelection(); detailTitle.textContent = '文件预览'; body.replaceChildren(placeholder); }
    else if (!wasInline && options.inlinePreview && selected) void choose(selected);
    if (hadThumbnails && !options.thumbnails) {
      observer?.disconnect(); queue.length = 0; queued.clear(); visible.clear(); loaded.clear(); for (const cancel of [...active.values()]) cancel();
      for (const { image, glyph } of candidates.values()) { image.removeAttribute('src'); image.hidden = true; glyph.hidden = false; }
    } else if (!hadThumbnails && options.thumbnails) for (const element of candidates.keys()) observer?.observe(element);
  }
  root.classList.toggle('has-file-preview', options.inlinePreview); detail.hidden = !options.inlinePreview;
  void load({ id: folder.id, list, footer, next: 0, loaded: false, loading: false }, true);
  return { setOptions, dispose() { if (disposed) return; disposed = true; clearSelection(); observer?.disconnect(); queue.length = 0; visible.clear(); loaded.clear(); for (const cancel of [...active.values()]) cancel(); for (const { image } of candidates.values()) { image.onload = null; image.onerror = null; image.removeAttribute('src'); } candidates.clear(); } };
}
