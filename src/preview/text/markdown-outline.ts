/** Tracks headings inside Flyfish's shadow root and follows the document scroll. */
export class MarkdownOutline {
  private observer?: MutationObserver;
  private timer?: number;
  private scroller?: HTMLElement;
  private headings: HTMLElement[] = [];
  private buttons: HTMLButtonElement[] = [];
  private active = -1;
  private readonly viewer: HTMLElement;
  private readonly preview: HTMLElement;
  private readonly outline: HTMLElement;
  private readonly list: HTMLElement;

  constructor(
    viewer: HTMLElement,
    preview: HTMLElement,
    outline: HTMLElement,
    list: HTMLElement,
  ) { this.viewer = viewer; this.preview = preview; this.outline = outline; this.list = list; }

  mount(): void {
    const shadow = this.viewer.querySelector<HTMLElement>('.viewer-root')?.shadowRoot;
    if (!shadow) return;
    this.refresh(shadow);
    this.observer = new MutationObserver(() => {
      if (this.timer === undefined) this.timer = window.setTimeout(() => { this.timer = undefined; this.refresh(shadow); }, 50);
    });
    this.observer.observe(shadow, { childList: true, subtree: true, characterData: true });
    window.addEventListener('resize', this.updateActive);
  }

  destroy(): void {
    this.observer?.disconnect();
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.scroller?.removeEventListener('scroll', this.updateActive);
    window.removeEventListener('resize', this.updateActive);
    this.outline.hidden = true;
    this.preview.classList.remove('has-toc');
    this.list.replaceChildren();
    this.headings = [];
    this.buttons = [];
  }

  private refresh(shadow: ShadowRoot): void {
    const nextScroller = shadow.querySelector<HTMLElement>('.markdown-viewer') || undefined;
    if (nextScroller !== this.scroller) {
      this.scroller?.removeEventListener('scroll', this.updateActive);
      this.scroller = nextScroller;
      this.scroller?.addEventListener('scroll', this.updateActive, { passive: true });
    }
    this.headings = Array.from(shadow.querySelectorAll<HTMLElement>('.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6'));
    this.buttons = this.headings.map((heading, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `toc-item toc-level-${heading.tagName.slice(1)}`;
      button.textContent = heading.textContent?.trim().slice(0, 120) || '未命名章节';
      button.addEventListener('click', () => {
        this.setActive(index);
        heading.scrollIntoView({ block: 'start' });
      });
      return button;
    });
    this.list.replaceChildren(...this.buttons);
    this.outline.hidden = this.buttons.length === 0;
    this.preview.classList.toggle('has-toc', this.buttons.length > 0);
    this.active = -1;
    this.updateActive();
  }

  private updateActive = (): void => {
    if (!this.scroller || !this.headings.length) return;
    const top = this.scroller.getBoundingClientRect().top + Math.min(120, Math.max(40, this.scroller.clientHeight * 0.2));
    let current = 0;
    for (let index = 0; index < this.headings.length; index += 1) {
      if (this.headings[index].getBoundingClientRect().top <= top) current = index;
      else break;
    }
    if (this.scroller.scrollHeight > this.scroller.clientHeight &&
        this.scroller.scrollTop + this.scroller.clientHeight >= this.scroller.scrollHeight - 2) current = this.headings.length - 1;
    this.setActive(current);
  };

  private setActive(index: number): void {
    if (index === this.active) return;
    this.buttons[this.active]?.removeAttribute('aria-current');
    this.buttons[index]?.setAttribute('aria-current', 'location');
    this.active = index;
  }
}
