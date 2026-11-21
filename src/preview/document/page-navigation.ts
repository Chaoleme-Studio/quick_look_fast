type PageKind = 'presentation' | 'word';

function pageKind(filename: string): PageKind | undefined {
  if (/\.(?:pptx|pptm|potx|potm|ppsx|ppsm)$/i.test(filename)) return 'presentation';
  if (/\.(?:docx|docm|dotx|dotm)$/i.test(filename)) return 'word';
  return undefined;
}

/** Add page controls to a Flyfish viewer without changing its own toolbar. */
export function mountPageNavigation(container: HTMLElement, viewer: HTMLElement, filename: string): () => void {
  const kind = pageKind(filename);
  const root = viewer.shadowRoot;
  const view = viewer.ownerDocument.defaultView;
  if (!kind || !root || !view) return () => undefined;

  const nav = viewer.ownerDocument.createElement('nav');
  nav.className = 'document-pages';
  nav.setAttribute('aria-label', '文档翻页');
  nav.hidden = true;
  nav.innerHTML = `<button type="button" class="document-pages-previous" aria-label="上一页" title="上一页">‹</button>
    <span class="document-pages-label">第</span><input class="document-pages-input" type="text" inputmode="numeric" aria-label="跳转到页码" autocomplete="off" spellcheck="false">
    <span class="document-pages-total"></span><button type="button" class="document-pages-next" aria-label="下一页" title="下一页">›</button>`;
  const previous = nav.querySelector<HTMLButtonElement>('.document-pages-previous')!;
  const next = nav.querySelector<HTMLButtonElement>('.document-pages-next')!;
  const input = nav.querySelector<HTMLInputElement>('.document-pages-input')!;
  const total = nav.querySelector<HTMLElement>('.document-pages-total')!;
  if (kind === 'word') nav.title = '页数按当前预览排版计算，可能与 Word 略有差异';
  container.append(nav);

  let pages: HTMLElement[] = [];
  let scroller: HTMLElement | undefined;
  let current = 1;
  let disposed = false;
  let frame = 0;
  let refreshNeeded = true;

  function show(visible: boolean): void {
    nav.hidden = !visible;
    container.classList.toggle('has-document-pages', visible);
  }

  function updateControls(): void {
    current = Math.min(Math.max(current, 1), Math.max(pages.length, 1));
    if (viewer.ownerDocument.activeElement !== input) input.value = String(current);
    input.setAttribute('aria-label', `跳转到页码，共 ${pages.length} 页`);
    total.textContent = `/ ${pages.length} 页`;
    previous.disabled = current <= 1;
    next.disabled = current >= pages.length;
  }

  function findScroller(page: HTMLElement): HTMLElement | undefined {
    for (let node = page.parentElement; node; node = node.parentElement) {
      const overflow = view!.getComputedStyle(node).overflowY;
      if (/^(auto|scroll|overlay)$/.test(overflow)) return node;
    }
    return undefined;
  }

  function syncPosition(): void {
    if (!scroller || !pages.length) return;
    const bounds = scroller.getBoundingClientRect();
    const marker = bounds.top + Math.min(bounds.height / 2, 240);
    let left = 0;
    let right = pages.length - 1;
    while (left < right) {
      const middle = Math.floor((left + right) / 2);
      if (pages[middle].getBoundingClientRect().bottom < marker) left = middle + 1;
      else right = middle;
    }
    current = left + 1;
    updateControls();
  }

  function schedule(refresh = false): void {
    refreshNeeded ||= refresh;
    if (frame || disposed) return;
    frame = view!.requestAnimationFrame(() => {
      frame = 0;
      if (disposed) return;
      if (refreshNeeded) { refreshNeeded = false; refreshPages(); }
      syncPosition();
    });
  }

  function refreshPages(): void {
    if (root!.querySelector('.flyfish-pptx-presentation')) { show(false); return; }
    if (kind === 'presentation') {
      const content = root!.querySelector<HTMLElement>('.flyfish-pptx-content');
      if (!content || content.dataset.renderState !== 'ready') { show(false); return; }
      const slots = content.querySelectorAll<HTMLElement>(':scope > .flyfish-pptx-slide-slot');
      pages = slots.length ? Array.from(slots) : Array.from(content.querySelectorAll<HTMLElement>(':scope > .slide'));
    } else {
      const wrapper = root!.querySelector<HTMLElement>('.docx-wrapper');
      if (!wrapper) { show(false); return; }
      if (wrapper.dataset.docxPaginating === 'true' || wrapper.dataset.docxPaginationScheduled === 'true') return;
      pages = Array.from(wrapper.querySelectorAll<HTMLElement>(':scope > .docx-page-frame'));
    }
    const nextScroller = pages[0] && findScroller(pages[0]);
    if (scroller !== nextScroller) {
      scroller?.removeEventListener('scroll', onScroll);
      scroller = nextScroller;
      scroller?.addEventListener('scroll', onScroll, { passive: true });
    }
    show(Boolean(pages.length && scroller));
    if (pages.length) updateControls();
  }

  function jump(page: number): void {
    if (!scroller || !pages.length || !Number.isFinite(page)) return;
    const target = Math.min(Math.max(Math.trunc(page), 1), pages.length);
    const top = scroller.scrollTop + pages[target - 1].getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    current = target;
    input.value = String(target);
    updateControls();
    scroller.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
    schedule();
  }

  function commitInput(): void {
    const value = input.value.trim();
    if (/^\d+$/.test(value) && Number.isSafeInteger(Number(value))) jump(Number(value));
    else input.value = String(current);
  }

  function onScroll(): void { schedule(); }
  previous.addEventListener('click', () => jump(current - 1));
  next.addEventListener('click', () => jump(current + 1));
  input.addEventListener('blur', commitInput);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); commitInput(); input.blur(); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); input.value = String(current); input.blur(); }
  });
  nav.addEventListener('keydown', event => {
    if (event.key.startsWith('Arrow')) event.stopPropagation();
    if (event.target !== input && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      jump(current + (event.key === 'ArrowLeft' ? -1 : 1));
    }
  });
  const observer = new view.MutationObserver(() => schedule(true));
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-render-state', 'data-docx-paginating', 'data-docx-pagination-scheduled', 'data-docx-paginated'] });
  const resized = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(() => schedule()) : undefined;
  resized?.observe(viewer);
  view.addEventListener('resize', onScroll);
  schedule(true);
  return () => {
    disposed = true;
    if (frame) view.cancelAnimationFrame(frame);
    observer.disconnect();
    resized?.disconnect();
    view.removeEventListener('resize', onScroll);
    scroller?.removeEventListener('scroll', onScroll);
    container.classList.remove('has-document-pages');
    nav.remove();
  };
}
