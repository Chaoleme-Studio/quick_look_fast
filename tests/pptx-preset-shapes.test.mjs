import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const require = createRequire(import.meta.url);
const worker = new URL('../build/dist/file-viewer/vendor/pptx/pptx.worker.js', import.meta.url);
const fixture = new URL('./fixtures/blank-presentation.pptx', import.meta.url);

test('PPTX preset corners, skew and arc strokes keep their Office geometry', { skip: !existsSync(worker) }, async () => {
  const zip = await JSZip.loadAsync(readFileSync(fixture));
  const shape = (id, preset, width, height, adjustment = '', fill = '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>', line = '') =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width * 9525}" cy="${height * 9525}"/></a:xfrm>
      <a:prstGeom prst="${preset}"><a:avLst>${adjustment}</a:avLst></a:prstGeom>${fill}${line}</p:spPr>
      <p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`;
  const adjust = (name, value) => `<a:gd name="${name}" fmla="val ${value}"/>`;
  const gradientLine = `<a:ln w="127000" cap="rnd"><a:gradFill><a:gsLst>
    <a:gs pos="75000"><a:srgbClr val="FF0000"/></a:gs>
    <a:gs pos="0"><a:srgbClr val="FF0000"><a:alpha val="0"/></a:srgbClr></a:gs>
    <a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs>
    </a:gsLst><a:lin ang="0" scaled="1"/></a:gradFill></a:ln>`;
  const solidLine = '<a:ln w="127000" cap="flat"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>';
  const verticalFill = '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs><a:gs pos="100000"><a:srgbClr val="000000"/></a:gs></a:gsLst><a:lin ang="16200000"/></a:gradFill>';
  const slide = `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
    ${shape(200, 'parallelogram', 100, 20)}
    ${shape(201, 'parallelogram', 100, 20, adjust('adj', 50000))}
    ${shape(202, 'parallelogram', 20, 100)}
    ${shape(203, 'roundRect', 100, 20)}
    ${shape(204, 'roundRect', 20, 100)}
    ${shape(205, 'roundRect', 100, 20, adjust('adj', 25000))}
    ${shape(206, 'arc', 80, 60, adjust('adj1', 0) + adjust('adj2', 5400000), '<a:noFill/>', gradientLine)}
    ${shape(207, 'arc', 80, 60, adjust('adj1', 5400000) + adjust('adj2', 0), '<a:noFill/>', solidLine)}
    ${shape(208, 'rect', 100, 20, '', verticalFill)}
    ${shape(209, 'arc', 80, 60, adjust('adj1', 0) + adjust('adj2', 5400000), '<a:noFill/>', gradientLine.replace('ang="0"', 'ang="5400000"'))}
    </p:spTree></p:cSld></p:sld>`;
  zip.file('ppt/slides/slide1.xml', slide);
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  const saved = { self: globalThis.self, postMessage: globalThis.postMessage, log: console.log };
  let output = ''; let timer;
  try {
    const complete = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('PPTX worker timed out')), 10000);
      globalThis.self = globalThis;
      globalThis.postMessage = (message) => {
        if (message.type === 'slide' && message.slide_num === 1) output = message.data;
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
  const svg = id => [...output.matchAll(/<svg\b[^>]*>[\s\S]*?<\/svg>/g)].map(match => match[0]).find(value => value.includes(`_id='${id}'`));
  const points = id => /<polygon points='([^']+)'/.exec(svg(id))[1].split(',').map(pair => pair.trim().split(/\s+/).map(Number));
  const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 0.001, `${label}: expected ${expected}, got ${actual}`);
  close(points(200)[0][0], 5, 'default wide parallelogram skew');
  close(points(201)[0][0], 10, 'adjusted wide parallelogram skew');
  close(points(202)[0][0], 5, 'default tall parallelogram skew');
  const corner = (id, height) => {
    const match = /d='M0,([\d.]+) Q0,[\d.]+ ([\d.]+),/.exec(svg(id));
    assert.ok(match, `shape ${id} has a rounded corner`);
    close(Number(match[2]), height - Number(match[1]), `shape ${id} corner radius is circular`);
    return Number(match[2]);
  };
  close(corner(203, 20), 20 * 0.33334 / 2, 'wide default radius');
  close(corner(204, 100), 20 * 0.33334 / 2, 'tall default radius');
  close(corner(205, 20), 5, 'explicit corner adjustment');
  const arc = svg(206);
  assert.match(arc, /stroke-linecap='round'/);
  assert.match(arc, /stroke='url\(#linGrd_[^']+\)'/);
  assert.deepEqual([...arc.matchAll(/<stop offset="([^"]+)"/g)].map(match => Number(match[1])), [0, 0.75, 1]);
  assert.match(arc, /stop-opacity:0;/);
  assert.match(arc, /d='M80,30 A40,30 0 0,1 40,60'/, 'elliptical quarter arc uses the right centre');
  assert.match(svg(207), /stroke-linecap='butt'/);
  const longArc = /A40,30 0 1,1 ([\d.]+),([\d.]+)/.exec(svg(207));
  assert.ok(longArc, 'sweep greater than 180 degrees uses the large arc');
  close(Number(longArc[1]), 80, 'long arc endpoint x');
  close(Number(longArc[2]), 30, 'long arc endpoint y');
  const direction = id => {
    const match = /<linearGradient\b[^>]*y1="([^"]+)"[^>]*y2="([^"]+)"/.exec(svg(id));
    assert.ok(match, `shape ${id} has a vertical gradient`);
    return [parseFloat(match[1]), parseFloat(match[2])];
  };
  assert.ok(direction(208)[0] > direction(208)[1], '270-degree shape gradient runs from bottom to top');
  assert.ok(direction(209)[0] < direction(209)[1], '90-degree arc gradient runs from top to bottom');
  assert.notEqual(/<linearGradient id="([^"]+)"/.exec(svg(206))[1], /<linearGradient id="([^"]+)"/.exec(svg(209))[1], 'each arc has its own gradient definition');
});
