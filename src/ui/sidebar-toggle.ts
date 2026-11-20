let nextSidebarId = 0;

/** Keep the selected preview mounted while making more room for its contents. */
export function createSidebarToggle(root: HTMLElement, sidebar: HTMLElement): { button: HTMLButtonElement; setExpanded(expanded: boolean): void } {
  sidebar.id = `preview-sidebar-${++nextSidebarId}`;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'preview-sidebar-toggle';
  button.setAttribute('aria-controls', sidebar.id);
  button.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M7 3.5v13"/></svg>';
  function setExpanded(expanded: boolean): void {
    sidebar.hidden = !expanded;
    root.classList.toggle('sidebar-collapsed', !expanded);
    button.setAttribute('aria-expanded', String(expanded));
    button.setAttribute('aria-label', expanded ? '收起目录' : '展开目录');
    button.title = expanded ? '收起目录' : '展开目录';
  }
  button.addEventListener('click', () => setExpanded(sidebar.hidden));
  setExpanded(true);
  return { button, setExpanded };
}
