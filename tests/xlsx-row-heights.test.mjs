import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import JSZip from 'jszip';
import { Window } from 'happy-dom';

const require = createRequire(import.meta.url);
const { patchSpreadsheet, patchAutoRowHeight } = require('../patch/flyfish-xlsx-row-fix.cjs');
const workerPath = fileURLToPath(new URL('../build/dist/file-viewer/vendor/xlsx/sheet.worker.js', import.meta.url));

async function spreadsheetStructure(bytes) {
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    globalThis.self = globalThis;
    globalThis.postMessage = value => parentPort.postMessage(value);
    require(workerData);
    parentPort.on('message', value => globalThis.onmessage({ data: value }));
  `, { eval: true, workerData: workerPath });
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Spreadsheet Worker timed out')), 15000);
      worker.on('error', (error) => { clearTimeout(timer); reject(error); });
      worker.on('message', (message) => {
        if (message.type === 'parseError') { clearTimeout(timer); reject(new Error(message.payload.message)); }
        if (message.type === 'sheets') {
          assert.ok(message.payload.sheets.length);
          worker.postMessage({ type: 'parseSheet', payload: { sheet: message.payload.sheets[0].id, startRow: 0, pageSize: 100, includeLayout: true } });
        }
        if (message.type === 'parseSheet') { clearTimeout(timer); resolve(message.payload.sheetData); }
      });
      worker.postMessage({ type: 'parseWorkbook', payload: { workbook: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), filename: 'fixture.xlsx', fileType: 'xlsx' } });
    });
  } finally { await worker.terminate(); }
}

test('XLSX worker distinguishes stored automatic heights from manually fixed heights', async () => {
  const zip = await JSZip.loadAsync(await readFile(new URL('./fixtures/office-sample.xlsx', import.meta.url)));
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <dimension ref="A1:K37"/><sheetFormatPr defaultRowHeight="18"/>
    <sheetData><row r="1" ht="13.9"><c r="A1" t="inlineStr"><is><t>Heading</t></is></c></row>
    <row r="2" ht="45" customHeight="1"><c r="A2" t="inlineStr"><is><t>Fixed</t></is></c></row>
    <row r="21" ht="13.9"><c r="A21" t="inlineStr"><is><t>Heading</t></is></c></row>
    <row r="37" ht="13.9"><c r="A37" t="inlineStr"><is><t>Heading</t></is></c></row></sheetData>
    <mergeCells count="4"><mergeCell ref="A1:K1"/><mergeCell ref="A2:K2"/><mergeCell ref="A21:K21"/><mergeCell ref="A37:K37"/></mergeCells></worksheet>`);
  const { structure } = await spreadsheetStructure(await zip.generateAsync({ type: 'nodebuffer' }));
  assert.equal(structure.rowSizing.autoHeightDisabled, undefined);
  assert.ok(structure.rowSizing.fixedRows.includes(1), 'row 2 has an explicitly fixed height');
  for (const row of [0, 20, 36]) assert.ok(!structure.rowSizing.fixedRows.includes(row), `row ${row + 1} is automatic`);
  assert.ok(structure.rowHeights[1] > structure.rowHeights[0]);
});

test('automatic row measurement uses the merged width and respects fixed rows', async () => {
  const source = await readFile(new URL('../node_modules/@file-viewer/renderer-spreadsheet/dist/spreadsheet/autoRowHeight.js', import.meta.url), 'utf8');
  const patched = patchAutoRowHeight(source)
    .replace("import { displayCellKey, getDataKey } from './state.js';", 'const displayCellKey=(row,col)=>`${row}-${col}`, getDataKey=(col)=>`c${col}`;')
    .replace("import { createAutoHeightProbe, getDisplayColumns } from './view.js';", `
      const getDisplayColumns=(columns)=>columns;
      const createAutoHeightProbe=(doc,value,style,width)=>{ globalThis.__quickLookTestWidths.push(width); const el=doc.createElement('div'); el.getBoundingClientRect=()=>({height:42}); return el; };
    `);
  const { createAutoRowHeight } = await import(`data:text/javascript;base64,${Buffer.from(patched).toString('base64')}`);
  const window = new Window();
  const widths = []; globalThis.__quickLookTestWidths = widths;
  const state = {
    autoHeightDisabled: false, fixedHeightRows: new Set([1]), rowHeightOverrides: new Map(),
    sourceRowHeights: new Map([[0, 18], [1, 60], [2, 18]]), defaults: { rowHeight: 18 },
    columns: [{ key: 'c0', width: 40 }, { key: 'c1', width: 60 }, { key: 'c2', width: 20, hide: true }],
    cellCache: new Map([[ '0-1', { wrapText: true, font: '22pt sans-serif' } ], [ '1-1', { wrapText: true } ], [ '2-1', { wrapText: true } ]]),
    rows: [{ c0: 'Heading' }, { c0: 'Fixed' }, { c0: 'Multirow' }],
    mergeStartMap: new Map([[ '0-1', { rowspan: 1, colspan: 3 } ], [ '2-1', { rowspan: 2, colspan: 3 } ]]),
    mergeCoveredMap: new Map(), autoHeightCells: new Map([[0, new Set([0])], [1, new Set([0])], [2, new Set([0])]]), autoRowHeights: new Map(),
  };
  try {
    const changes = await new Promise((resolve) => {
      const host = window.document.createElement('div'); window.document.body.append(host);
      const auto = createAutoRowHeight({ host, getState: () => state, getZoom: () => 1, getFirstVisibleRow: () => 0,
        commit(result) { auto.destroy(); resolve(result); } });
      auto.enqueue(new Set([0, 1, 2]));
    });
    assert.deepEqual(widths, [100], 'the probe spans visible merged columns and skips multi-row merges');
    assert.equal(changes.get(0), 42);
    assert.equal(changes.has(1), false, 'manual row height remains unchanged');
  } finally { delete globalThis.__quickLookTestWidths; await window.happyDOM.close(); }
});

test('spreadsheet row initialization keeps stored heights as a baseline when metadata is available', async () => {
  const source = await readFile(new URL('../node_modules/@file-viewer/renderer-spreadsheet/dist/spreadsheet.js', import.meta.url), 'utf8');
  const patched = patchSpreadsheet(source);
  assert.equal(patchSpreadsheet(patched), patched, 'the patch is idempotent');
  const match = patched.match(/const applyStructureRowHeights = \(rowHeights, keepStoredHeightsFixed\) => \{[\s\S]*?\n    \};/);
  assert.ok(match);
  const state = { rows: [{}, {}], fixedHeightRows: new Set([1]), defaults: { rowHeight: 18 }, sourceRowHeights: new Map(), rowHeightOverrides: new Map(), rowHeightCache: new Map() };
  const initialize = new Function('virtualState', 'normalizeRowHeight', 'applyRowHeight', `${match[0]}; return applyStructureRowHeights;`)(state, (height) => height, (row, height) => { row.height = height; });
  initialize([18, 60], false);
  assert.deepEqual([...state.fixedHeightRows], [1]);
  assert.deepEqual([...state.sourceRowHeights.values()], [18, 60]);
  initialize([18, 60], true);
  assert.ok(state.fixedHeightRows.has(0), 'unverified metadata preserves the safe legacy behavior');
});

test('provided workbook row sizing metadata', { skip: !process.env.QUICKLOOK_TEST_XLSX }, async () => {
  const sheet = await spreadsheetStructure(await readFile(process.env.QUICKLOOK_TEST_XLSX));
  const { structure } = sheet;
  assert.ok(structure.rowSizing.fixedRows.includes(1));
  for (const row of [0, 20, 36]) {
    assert.ok(!structure.rowSizing.fixedRows.includes(row));
    assert.match(sheet.cell[`${row}-0`].className, /htWrap/, `row ${row + 1} is eligible for wrapped-text measurement`);
    assert.ok(structure.merge.some((merge) => merge.row === row && merge.col === 0 && merge.rowspan === 1 && merge.colspan === 11));
  }
});
