interface WordOutlineOptions {
  host: HTMLElement;
  before?: HTMLElement;
  titlebar?: boolean;
  initiallyExpanded?: boolean;
}

interface OutlineEntry {
  heading: HTMLElement;
  button: HTMLButtonElement;
}

let nextOutlineId = 0;

/** Show the Word headings resolved by the document renderer, without changing the document. */
export function mountWordOutline(container: HTMLElement, viewer: HTMLElement, filename: string, options: WordOutlineOptions): (() => void) | undefined {
  const root = viewer.shadowRoot;
  const view = viewer.ownerDocument.defaultView;
  if (!/\.(?:docx|docm|dotx|dotm)$/i.test(filename) || !root || !view) return undefined;

  const doc = viewer.ownerDocument;
  const sidebar = doc.createElement('nav');
  sidebar.className = 'word-outline';
  sidebar.id = `word-outline-${++nextOutlineId}`;
  sidebar.setAttribute('aria-label', 'Word 文档导航');
  sidebar.innerHTML = '<div class="word-outline-heading"><strong>文档导航</strong><span>标题</span></div><div class="word-outline-list"></div>';
  const list = sidebar.querySelector<HTMLElement>('.word-outline-list')!;
  const toggle = doc.createElement('button');
  toggle.type = 'button';
  toggle.className = `${options.titlebar ? 'icon-action' : 'preview-sidebar-toggle'} word-outline-toggle`;
  toggle.setAttribute('aria-controls', sidebar.id);
  toggle.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M7 3.5v13"/></svg>';
  if (options.before?.parentElement === options.host) options.host.insertBefore(toggle, options.before);
  else options.host.append(toggle);
  container.prepend(sidebar);

  let disposed = false;
  let frame = 0;
  let refreshNeeded = true;
  let scroller: HTMLElement | undefined;
  let entries: OutlineEntry[] = [];
  let active: HTMLButtonElement | undefined;

  function setExpanded(expanded: boolean): void {
    sidebar.hidden = !expanded;
    container.classList.toggle('has-word-outline', expanded);
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', expanded ? '收起文档导航' : '展开文档导航');
    toggle.title = expanded ? '收起文档导航' : '展开文档导航';
    if (expanded && active) reveal(active);
  }

  function schedule(refresh = false): void {
    refreshNeeded ||= refresh;
    if (disposed || frame) return;
    frame = view!.requestAnimationFrame(() => {
      frame = 0;
      if (disposed) return;
      if (refreshNeeded) { refreshNeeded = false; refreshEntries(); }
      syncPosition();
    });
  }

  function findScroller(heading: HTMLElement): HTMLElement | undefined {
    for (let node = heading.parentElement; node; node = node.parentElement) {
      if (/^(auto|scroll|overlay)$/.test(view!.getComputedStyle(node).overflowY)) return node;
    }
    return undefined;
  }

  function reveal(button: HTMLButtonElement): void {
    if (sidebar.hidden) return;
    const bounds = list.getBoundingClientRect();
    const item = button.getBoundingClientRect();
    if (item.top < bounds.top) list.scrollTop -= bounds.top - item.top;
    else if (item.bottom > bounds.bottom) list.scrollTop += item.bottom - bounds.bottom;
  }

  function setActive(button?: HTMLButtonElement): void {
    if (active === button) return;
    active?.removeAttribute('aria-current');
    active = button;
    active?.setAttribute('aria-current', 'location');
    if (active) reveal(active);
  }

  function syncPosition(): void {
    if (!scroller || !entries.length) { setActive(); return; }
    const marker = scroller.getBoundingClientRect().top + Math.min(scroller.clientHeight / 3, 120);
    let first = 0;
    let last = entries.length - 1;
    while (first < last) {
      const middle = Math.ceil((first + last) / 2);
      if (entries[middle].heading.getBoundingClientRect().top <= marker) first = middle;
      else last = middle - 1;
    }
    let current = entries[first];
    if (scroller.scrollHeight > scroller.clientHeight && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) current = entries[entries.length - 1];
    setActive(current.button);
  }

  function jump(heading: HTMLElement, button: HTMLButtonElement): void {
    if (!scroller || !heading.isConnected) return;
    const top = scroller.scrollTop + heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16;
    scroller.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
    setActive(button);
    schedule();
  }

  function refreshEntries(): void {
    const wrapper = root!.querySelector<HTMLElement>('.docx-wrapper');
    if (wrapper?.dataset.docxPaginating === 'true' || wrapper?.dataset.docxPaginationScheduled === 'true') return;
    const seen = new Set<string>();
    const headings = Array.from(wrapper?.querySelectorAll<HTMLElement>('[data-quicklook-outline-level]') ?? []).filter(heading => {
      const id = heading.id;
      if (!id || seen.has(id) || !heading.textContent?.trim()) return false;
      seen.add(id);
      return true;
    });
    const nextScroller = headings[0] && findScroller(headings[0]);
    if (scroller !== nextScroller) {
      scroller?.removeEventListener('scroll', onScroll);
      scroller = nextScroller;
      scroller?.addEventListener('scroll', onScroll, { passive: true });
    }
    const unchanged = headings.length === entries.length && headings.every((heading, index) =>
      entries[index].heading === heading && entries[index].button.textContent === heading.textContent?.trim().replace(/\s+/g, ' '));
    const emptyMessage = wrapper ? '未检测到标题。使用 Word 的标题样式后，章节会显示在这里。' : '正在读取文档标题…';
    if (unchanged && (headings.length || list.firstElementChild?.textContent === emptyMessage)) return;
    setActive();
    entries = [];
    list.replaceChildren();
    if (!headings.length) {
      const empty = doc.createElement('p');
      empty.className = 'word-outline-empty';
      empty.textContent = emptyMessage;
      list.append(empty);
      return;
    }
    const minLevel = headings.reduce((minimum, heading) => Math.min(minimum, Number(heading.dataset.quicklookOutlineLevel) || 1), 9);
    for (const heading of headings) {
      const button = doc.createElement('button');
      const text = heading.textContent!.trim().replace(/\s+/g, ' ');
      const level = Number(heading.dataset.quicklookOutlineLevel) || 1;
      button.type = 'button';
      button.className = 'word-outline-item';
      button.style.setProperty('--outline-depth', String(Math.min(Math.max(level - minLevel, 0), 5)));
      button.textContent = text;
      button.title = text;
      button.addEventListener('click', () => jump(heading, button));
      list.append(button);
      entries.push({ heading, button });
    }
  }

  function onScroll(): void { schedule(); }
  toggle.addEventListener('click', () => setExpanded(sidebar.hidden));
  sidebar.addEventListener('keydown', event => { if (event.key.startsWith('Arrow')) event.stopPropagation(); });
  const observer = new view.MutationObserver(() => schedule(true));
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-docx-paginating', 'data-docx-pagination-scheduled'] });
  setExpanded(options.initiallyExpanded !== false);
  schedule(true);
  return () => {
    disposed = true;
    observer.disconnect();
    if (frame) view.cancelAnimationFrame(frame);
    scroller?.removeEventListener('scroll', onScroll);
    container.classList.remove('has-word-outline');
    sidebar.remove();
    toggle.remove();
  };
}
