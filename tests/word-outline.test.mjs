import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { mountWordOutline } from '../src/preview/document/word-outline.ts';

const tick = () => new Promise(resolve => setTimeout(resolve, 40));

test('Word navigation follows document headings, jumps, collapses and cleans up', async () => {
  const window = new Window();
  try {
    const { document } = window;
    const container = document.createElement('main');
    const viewer = document.createElement('div'); viewer.className = 'viewer-root';
    container.append(viewer); document.body.append(container);
    const header = document.createElement('header');
    const pages = document.createElement('nav'); header.append(pages); document.body.prepend(header);
    const root = viewer.attachShadow({ mode: 'open' });
    const scroller = document.createElement('div'); scroller.style.overflowY = 'auto';
    Object.defineProperty(scroller, 'clientHeight', { value: 500 });
    scroller.getBoundingClientRect = () => ({ top: 0, bottom: 500, height: 500 });
    scroller.scrollTo = ({ top }) => { scroller.scrollTop = top; scroller.dispatchEvent(new window.Event('scroll')); };
    const wrapper = document.createElement('div'); wrapper.className = 'docx-wrapper';
    function heading(id, level, text, y) {
      const element = document.createElement('p'); element.id = id;
      element.dataset.quicklookOutlineLevel = String(level); element.textContent = text;
      element.getBoundingClientRect = () => ({ top: y - scroller.scrollTop });
      return element;
    }
    const first = heading('heading-1', 1, '第一章', 20);
    const second = heading('heading-2', 2, '第二节', 520);
    wrapper.append(first, second); scroller.append(wrapper); root.append(scroller);
    const dispose = mountWordOutline(container, viewer, 'report.docx', { host: header, before: pages, titlebar: true });
    await tick();
    const sidebar = container.querySelector('.word-outline');
    const toggle = header.querySelector('.word-outline-toggle');
    let items = sidebar.querySelectorAll('.word-outline-item');
    assert.equal(toggle.nextElementSibling, pages);
    assert.equal(sidebar.hidden, false);
    assert.equal(container.classList.contains('has-word-outline'), true);
    assert.deepEqual([...items].map(item => item.textContent), ['第一章', '第二节']);
    assert.equal(items[1].style.getPropertyValue('--outline-depth'), '1');
    assert.equal(items[0].getAttribute('aria-current'), 'location');
    items[1].click(); await tick();
    assert.equal(scroller.scrollTop, 504);
    assert.equal(items[1].getAttribute('aria-current'), 'location');
    toggle.click();
    assert.equal(sidebar.hidden, true);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(container.classList.contains('has-word-outline'), false);
    assert.equal(scroller.scrollTop, 504, 'collapsing does not reload the document');
    toggle.click();
    assert.equal(sidebar.hidden, false);
    wrapper.append(heading('heading-3', 1, '第三章', 1020)); await tick();
    items = sidebar.querySelectorAll('.word-outline-item');
    assert.equal(items.length, 3, 'outline follows pagination and renderer updates');
    dispose();
    assert.equal(header.querySelector('.word-outline-toggle'), null);
    assert.equal(container.querySelector('.word-outline'), null);
    assert.equal(container.classList.contains('has-word-outline'), false);
  } finally { await window.happyDOM.close(); }
});

test('Word navigation explains missing headings and supports a collapsed nested preview', async () => {
  const window = new Window();
  try {
    const container = window.document.createElement('div');
    const viewer = window.document.createElement('div'); container.append(viewer); window.document.body.append(container);
    const root = viewer.attachShadow({ mode: 'open' });
    const header = window.document.createElement('header'); window.document.body.prepend(header);
    const dispose = mountWordOutline(container, viewer, 'document.docx', { host: header, initiallyExpanded: false });
    await tick();
    assert.match(container.querySelector('.word-outline-empty').textContent, /正在读取/);
    const wrapper = window.document.createElement('div'); wrapper.className = 'docx-wrapper'; root.append(wrapper);
    await tick();
    assert.match(container.querySelector('.word-outline-empty').textContent, /未检测到标题/);
    assert.equal(container.querySelector('.word-outline').hidden, true);
    header.querySelector('button').click();
    assert.equal(container.querySelector('.word-outline').hidden, false);
    dispose();
    assert.equal(mountWordOutline(container, viewer, 'image.png', { host: header }), undefined);
  } finally { await window.happyDOM.close(); }
});
