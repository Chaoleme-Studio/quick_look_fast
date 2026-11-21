import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { mountPageNavigation } from '../src/preview/document/page-navigation.ts';

const tick = () => new Promise(resolve => setTimeout(resolve, 35));

function makeViewer(window, kind, count) {
  const container = window.document.createElement('div');
  const host = window.document.createElement('div'); host.className = 'viewer-root';
  container.append(host); window.document.body.append(container);
  const root = host.attachShadow({ mode: 'open' });
  const scroll = window.document.createElement('div'); scroll.style.overflowY = 'auto';
  scroll.getBoundingClientRect = () => ({ top: 0, bottom: 500, height: 500 });
  scroll.scrollTo = ({ top }) => { scroll.scrollTop = top; scroll.dispatchEvent(new window.Event('scroll')); };
  const content = window.document.createElement('div');
  if (kind === 'presentation') { content.className = 'flyfish-pptx-content'; content.dataset.renderState = 'ready'; }
  else content.className = 'docx-wrapper';
  for (let index = 0; index < count; index++) {
    const page = window.document.createElement('div');
    page.className = kind === 'presentation' ? 'flyfish-pptx-slide-slot' : 'docx-page-frame';
    page.getBoundingClientRect = () => ({ top: index * 500 - scroll.scrollTop, bottom: (index + 1) * 500 - scroll.scrollTop, height: 500 });
    content.append(page);
  }
  scroll.append(content); root.append(scroll);
  return { container, host, root, content, scroll };
}

test('PPT page controls follow scrolling, jump, keyboard focus and slideshow lifecycle', async () => {
  const window = new Window();
  try {
    const { container, host, root, content, scroll } = makeViewer(window, 'presentation', 3);
    const dispose = mountPageNavigation(container, host, 'slides.pptx');
    await tick();
    const nav = container.querySelector('.document-pages');
    const input = nav.querySelector('input');
    const previous = nav.querySelector('.document-pages-previous');
    const next = nav.querySelector('.document-pages-next');
    assert.equal(nav.hidden, false);
    assert.equal(input.value, '1');
    assert.match(nav.textContent, /\/ 3 页/);
    assert.equal(previous.disabled, true);
    next.click(); await tick();
    assert.equal(scroll.scrollTop, 500);
    assert.equal(input.value, '2');
    input.value = '3'; input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await tick();
    assert.equal(scroll.scrollTop, 1000);
    assert.equal(input.value, '3');
    assert.equal(next.disabled, true);
    scroll.scrollTop = 0; scroll.dispatchEvent(new window.Event('scroll')); await tick();
    assert.equal(input.value, '1', 'manual scrolling updates the current page');
    input.value = 'wrong'; input.dispatchEvent(new window.Event('blur')); assert.equal(input.value, '1');
    let leaked = false; window.document.addEventListener('keydown', () => { leaked = true; }, { once: true });
    next.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    await tick(); assert.equal(input.value, '2'); assert.equal(leaked, false, 'page-control arrows do not navigate files');
    const presentation = window.document.createElement('div'); presentation.className = 'flyfish-pptx-presentation'; root.append(presentation);
    await tick(); assert.equal(nav.hidden, true);
    presentation.remove(); await tick(); assert.equal(nav.hidden, false);
    content.dataset.renderState = 'loading'; await tick(); assert.equal(nav.hidden, true);
    dispose(); assert.equal(container.querySelector('.document-pages'), null);
    assert.equal(container.classList.contains('has-document-pages'), false);
  } finally { await window.happyDOM.close(); }
});

test('Word controls wait for paginated frames and update when pagination changes', async () => {
  const window = new Window();
  try {
    const { container, host, content } = makeViewer(window, 'word', 2);
    content.dataset.docxPaginating = 'true';
    const dispose = mountPageNavigation(container, host, 'report.docx');
    await tick();
    const nav = container.querySelector('.document-pages');
    assert.equal(nav.hidden, true);
    content.dataset.docxPaginating = 'false'; await tick();
    assert.equal(nav.hidden, false);
    assert.match(nav.textContent, /\/ 2 页/);
    content.lastElementChild.remove(); await tick();
    assert.match(nav.textContent, /\/ 1 页/);
    dispose();
    assert.equal(container.children.length, 1);
    const noPages = mountPageNavigation(container, host, 'image.png');
    assert.equal(container.querySelector('.document-pages'), null);
    noPages();
  } finally { await window.happyDOM.close(); }
});
