import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const require = createRequire(import.meta.url);
const worker = new URL('../build/dist/file-viewer/vendor/pptx/pptx.worker.js', import.meta.url);
const fixture = new URL('./fixtures/blank-presentation.pptx', import.meta.url);

test('PPTX chart worker retains signed axis identifiers, cached newlines and line colors', { skip: !existsSync(worker) }, async () => {
  const zip = await JSZip.loadAsync(readFileSync(fixture));
  const slide = await zip.file('ppt/slides/slide1.xml').async('string');
  const graphic = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="Synthetic chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
    <p:xfrm><a:off x="0" y="0"/><a:ext cx="4572000" cy="2743200"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
    <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rIdChart"/></a:graphicData></a:graphic></p:graphicFrame>`;
  zip.file('ppt/slides/slide1.xml', slide.replace('</p:spTree>', `${graphic}</p:spTree>`));
  const relsPath = 'ppt/slides/_rels/slide1.xml.rels';
  const relationships = await zip.file(relsPath).async('string');
  zip.file(relsPath, relationships.replace('</Relationships>', '<Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>'));
  const series = (color, line = false) => `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>Series</c:v></c:tx>
    <c:spPr>${line ? `<a:ln><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln>` : `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`}</c:spPr>
    ${line ? '<c:dLbls><c:spPr><a:solidFill><a:srgbClr val="EEEEEE"/></a:solidFill></c:spPr><c:showVal val="1"/></c:dLbls>' : ''}
    <c:cat><c:strLit><c:ptCount val="3"/><c:pt idx="0"><c:v>First&#10;Second</c:v></c:pt><c:pt idx="1"><c:v>Other</c:v></c:pt><c:pt idx="2"><c:v>Literal&amp;#10;</c:v></c:pt></c:strLit></c:cat>
    <c:val><c:numLit><c:ptCount val="3"/><c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt><c:pt idx="2"><c:v>3</c:v></c:pt></c:numLit></c:val></c:ser>`;
  zip.file('ppt/charts/chart1.xml', `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
    <c:chart><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/>${series('8F1720')}<c:axId val="-12"/><c:axId val="-13"/></c:barChart>
    <c:lineChart>${series('123456', true)}<c:axId val="4294967284"/><c:axId val="-13"/></c:lineChart>
    <c:catAx><c:axId val="-12"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:crossAx val="-13"/>
      <c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1000"/></a:pPr></a:p></c:txPr></c:catAx>
    <c:valAx><c:axId val="-13"/><c:scaling><c:orientation val="minMax"/><c:min val="0"/></c:scaling><c:axPos val="l"/><c:crossAx val="-12"/></c:valAx>
    </c:plotArea></c:chart></c:chartSpace>`);
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  const saved = { self: globalThis.self, postMessage: globalThis.postMessage, log: console.log };
  let charts; let timer;
  try {
    const complete = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('PPTX worker timed out')), 10000);
      globalThis.self = globalThis;
      globalThis.postMessage = message => {
        if (message.type === 'ERROR' || message.type === 'slide-error') reject(new Error('PPTX worker failed'));
        if (message.type === 'ExecutionTime' || message.type === 'Done') { charts = message.charts; resolve(); }
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
  const model = charts.MsgQueue[0].data.chartModel;
  assert.deepEqual(model.groups.map(group => group.axisIds), [['4294967284', '4294967283'], ['4294967284', '4294967283']]);
  assert.equal(model.axes.length, 2);
  assert.equal(model.axes.find(axis => axis.kind === 'category').font.sizePt, 10);
  assert.equal(model.groups[0].series[0].xlabels[0], 'First\nSecond');
  assert.equal(model.groups[0].series[0].xlabels[2], 'Literal&#10;', 'an escaped literal entity must remain text');
  assert.equal(model.groups[0].options.series[0].color, '#8F1720');
  assert.equal(model.groups[1].options.series[0].color, '#123456');
  assert.equal(model.groups[1].options.series[0].labels.backgroundColor, '#EEEEEE');
});
