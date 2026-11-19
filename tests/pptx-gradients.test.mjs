import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const require = createRequire(import.meta.url);
const worker = new URL('../dist/file-viewer/vendor/pptx/pptx.worker.js', import.meta.url);
const fixture = new URL('./fixtures/blank-presentation.pptx', import.meta.url);

test('PPTX preserves nonuniform gradient stops and arrowhead dimensions', { skip: !existsSync(worker) }, async () => {
  const zip = await JSZip.loadAsync(readFileSync(fixture));
  const gradient = `<a:gradFill><a:gsLst>
    <a:gs pos="0"><a:srgbClr val="8F1720"/></a:gs><a:gs pos="363"><a:srgbClr val="8F1720"/></a:gs>
    <a:gs pos="363"><a:srgbClr val="FFF5F4"/></a:gs><a:gs pos="100000"><a:srgbClr val="FFF5F4"/></a:gs>
    </a:gsLst><a:lin ang="0" scaled="1"/></a:gradFill>`;
  const shape = (id, name, geom, fill, adjust = '') => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="190500"/></a:xfrm>
    <a:prstGeom prst="${geom}"><a:avLst>${adjust}</a:avLst></a:prstGeom>${fill}</p:spPr>
    <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr>${gradient}</a:rPr><a:t>sample</a:t></a:r></a:p></p:txBody></p:sp>`;
  const slide = `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
    ${shape(2, 'Gradient block', 'rect', gradient)}
    ${shape(3, 'Right arrow', 'rightArrow', gradient)}
    ${shape(4, 'Left arrow', 'leftArrow', gradient)}
    ${shape(5, 'Adjusted arrow', 'rightArrow', gradient, '<a:gd name="adj2" fmla="val 25000"/>')}
    </p:spTree></p:cSld></p:sld>`;
  zip.file('ppt/slides/slide1.xml', slide);
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  const saved = { self: globalThis.self, postMessage: globalThis.postMessage, log: console.log };
  let output = ''; let css = ''; let timer;
  try {
    const complete = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('PPTX worker timed out')), 10000);
      globalThis.self = globalThis;
      globalThis.postMessage = (message) => {
        if (message.type === 'slide' && message.slide_num === 1) output = message.data;
        if (message.type === 'globalCSS') css += message.data;
        if (message.type === 'ERROR' || message.type === 'slide-error') reject(new Error('PPTX worker failed'));
        if (message.type === 'ExecutionTime') resolve();
      };
    });
    console.log = () => {};
    const workerPath = require.resolve(fileURLToPath(worker)); delete require.cache[workerPath]; require(workerPath);
    globalThis.self.onmessage({ data: { type: 'processPPTX', data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), IE11: false,
      options: { slidesScale: '', slideMode: false, slideType: 'divs2slidesjs', revealjsPath: '', keyBoardShortCut: false,
        mediaProcess: true, jsZipV2: false, themeProcess: true, incSlide: { width: 0, height: 0 }, slideModeConfig: {}, revealjsConfig: {} } } });
    await complete;
  } finally {
    clearTimeout(timer); console.log = saved.log;
    if (saved.self === undefined) delete globalThis.self; else globalThis.self = saved.self;
    if (saved.postMessage === undefined) delete globalThis.postMessage; else globalThis.postMessage = saved.postMessage;
  }
  const shapeSvg = (id) => [...output.matchAll(/<svg\b[^>]*>[\s\S]*?<\/svg>/g)].map((match) => match[0]).find((svg) => svg.includes(`_id='${id}'`));
  const stopPositions = [...shapeSvg(2).matchAll(/<stop offset="([^"]+)"/g)].map((match) => Number(match[1]));
  assert.deepEqual(stopPositions, [0, 0.00363, 0.00363, 1]);
  const direction = /<linearGradient\b[^>]*x1="([^"]+)"[^>]*x2="([^"]+)"/.exec(shapeSvg(2));
  assert.ok(direction && parseFloat(direction[1]) < parseFloat(direction[2]), 'zero-degree gradient begins at the left edge');
  const points = (id) => /<polygon points='([^']+)'/.exec(shapeSvg(id))[1].split(',').map((pair) => pair.trim().split(/\s+/).map(Number));
  const right = points(3); const left = points(4); const adjusted = points(5);
  assert.ok(Math.abs(right[0][0] - right[1][0] - 10) < 0.01, 'default arrowhead is half the 20px height');
  assert.ok(Math.abs(left[1][0] - 10) < 0.01, 'left arrow uses the same default');
  assert.ok(Math.abs(adjusted[0][0] - adjusted[1][0] - 5) < 0.01, 'a single explicit adjustment is respected');
  assert.match(css + output, /0\.363%/, 'text gradients also preserve their stop positions');
});
