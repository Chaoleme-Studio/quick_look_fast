import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const require = createRequire(import.meta.url);
const worker = new URL('../build/dist/file-viewer/vendor/pptx/pptx.worker.js', import.meta.url);
const fixture = new URL('./fixtures/blank-presentation.pptx', import.meta.url);

test('PPTX worker keeps text insets bounded in groups with unusual coordinate scales', { skip: !existsSync(worker) }, async () => {
  assert.match(readFileSync(worker, 'utf8'), /function __slowLookPptxInset\(/, 'the built worker must include the compatibility fix');
  const zip = await JSZip.loadAsync(readFileSync(fixture));
  const p = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const groupedSlide = `<p:sld xmlns:p="${p}" xmlns:a="${a}"><p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
    <p:grpSp><p:nvGrpSpPr><p:cNvPr id="2" name="Synthetic group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="5143500"/><a:chOff x="0" y="0"/><a:chExt cx="14400" cy="8100"/></a:xfrm></p:grpSpPr>
      <p:sp><p:nvSpPr><p:cNvPr id="3" name="Text"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="1000" y="1000"/><a:ext cx="10000" cy="3000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1200"/><a:t>Synthetic 123</a:t></a:r></a:p></p:txBody>
      </p:sp>
    </p:grpSp>
  </p:spTree></p:cSld></p:sld>`;
  zip.file('ppt/slides/slide1.xml', groupedSlide);
  zip.file('ppt/slides/slide2.xml', groupedSlide
    .replace('cx="14400" cy="8100"', 'cx="4572000" cy="2571750"')
    .replace('cx="10000" cy="3000"', 'cx="1000000" cy="500000"')
    .replace('<a:xfrm><a:off x="1000"', '<a:xfrm rot="5400000"><a:off x="1000"')
    .replace('Synthetic 123', 'Normal group'));
  zip.file('ppt/slides/slide3.xml', groupedSlide.replace('<a:bodyPr/>', '<a:bodyPr vert="eaVert"/>').replace('Synthetic 123', '竖排目录'));
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  const saved = { self: globalThis.self, postMessage: globalThis.postMessage, log: console.log };
  let slide;
  let normalSlide;
  let verticalSlide;
  const messages = [];
  let timer;
  try {
    const complete = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('PPTX worker timed out')), 10000);
      globalThis.self = globalThis;
      globalThis.postMessage = (message) => {
        messages.push({ type: message.type, data: message.type === 'globalCSS' ? message.data : undefined });
        if (message.type === 'slide' && message.slide_num === 1) slide = message.data;
        if (message.type === 'slide' && message.slide_num === 2) normalSlide = message.data;
        if (message.type === 'slide' && message.slide_num === 3) verticalSlide = message.data;
        if (message.type === 'ERROR' || message.type === 'slide-error') reject(new Error(message.data?.message || 'PPTX worker failed'));
        if (message.type === 'ExecutionTime') resolve();
      };
    });
    console.log = () => {};
    const workerPath = require.resolve(fileURLToPath(worker));
    delete require.cache[workerPath];
    require(workerPath);
    globalThis.self.onmessage({ data: { type: 'processPPTX', data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), IE11: false,
      options: { slidesScale: '', slideMode: false, slideType: 'divs2slidesjs', revealjsPath: '', keyBoardShortCut: false,
        mediaProcess: true, jsZipV2: false, themeProcess: true, incSlide: { width: 0, height: 0 }, slideModeConfig: {}, revealjsConfig: {} } } });
    await complete;
  } finally {
    clearTimeout(timer);
    console.log = saved.log;
    if (saved.self === undefined) delete globalThis.self; else globalThis.self = saved.self;
    if (saved.postMessage === undefined) delete globalThis.postMessage; else globalThis.postMessage = saved.postMessage;
  }
  assert.ok(slide?.includes('Synthetic 123'), 'the grouped text should be emitted');
  assert.match(slide, /padding:4\.8px 9\.6px 4\.8px 9\.6px/, 'standard DrawingML margins should be expressed in pixels');
  assert.doesNotMatch(slide, /padding:3048px 6096px/, 'group coordinates must not inflate text margins');
  const paragraphWidths = [...slide.matchAll(/<div style='[^']*width:([\d.]+)px;[^']*' class='slide-prgrph\b/g)].map((match) => Number(match[1]));
  assert.ok(paragraphWidths.length > 0 && paragraphWidths.every((width) => width > 0), 'grouped text paragraphs must retain a nonzero usable width');
  assert.doesNotMatch(slide, /data-office-paragraph='[^']*' style='[^']*width:0px;/, 'the text content must not collapse to zero width');
  assert.ok(normalSlide?.includes('Normal group'), 'the ordinary scaled group should still render');
  assert.match(normalSlide, /padding:9\.6px 19\.2px 9\.6px 19\.2px/, 'normal group scaling should not be discarded');
  assert.match(normalSlide, /transform: rotate\(90deg\)/, 'ordinary rotated shapes must retain their rotation');
  assert.ok(verticalSlide?.includes('竖排目录'), 'the vertical text should be retained');
  assert.match(verticalSlide, /writing-mode:vertical-rl;text-orientation:upright;[^']*transform: rotate\(0deg\)/, 'East Asian vertical text should keep upright glyphs');
  const firstSlide = messages.findIndex((message) => message.type === 'slide');
  const firstStyle = messages.findIndex((message) => message.type === 'globalCSS');
  assert.ok(firstStyle >= 0 && firstStyle < firstSlide, 'the first slide should receive its generated styles before it is shown');
  assert.match(messages[firstStyle].data, /\._css_\d+\s*\{/, 'early CSS should include text formatting rules');
  const styles = messages.filter((message) => message.type === 'globalCSS').map((message) => message.data);
  assert.ok(styles.length >= 2, 'the complete upstream stylesheet is retained as a fallback');
  assert.equal(styles.slice(0, -1).join(''), styles.at(-1), 'incremental styles must reproduce the complete stylesheet');
});
