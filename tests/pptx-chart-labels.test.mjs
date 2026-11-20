import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { patchChartConfig, separateOverlappingLabels } = require('../patch/flyfish-pptx-chart-fix.cjs');

test('PPTX chart categories preserve explicit line breaks without changing other charts', async () => {
  const source = await readFile(new URL('../node_modules/@file-viewer/pptx/dist/chart-config.js', import.meta.url), 'utf8');
  const fixed = patchChartConfig(source);
  const { createPptxCartesianChart } = await import(`data:text/javascript;base64,${Buffer.from(fixed).toString('base64')}`);
  const chart = (labels, labelRotation, barDirection = 'col', reversed = false) => createPptxCartesianChart({
    groups: [{ chartType: 'barChart', barDirection, axisIds: ['x', 'y'], options: {}, series: [{ key: 'a', values: labels.map((_, x) => ({ x, y: x + 1 })), xlabels: labels }] }],
    axes: [{ id: 'x', kind: 'category', labelRotation, reversed }, { id: 'y', kind: 'value' }],
  }, { bar: () => 'bar' });
  assert.equal(chart(['7月\n97,672笔', '8月\n55,933笔']).axis.x.tick.multiline, true);
  assert.equal(chart(['7月\n97,672笔']).axis.x.tick.rotate, 0);
  assert.equal(chart(['7月\n97,672笔'], 45).axis.x.tick.rotate, 45);
  assert.equal(chart(['January', 'February']).axis.x.tick.multiline, false);
  assert.equal(chart(['A', 'B'], undefined, 'bar').axis.x.inverted, true, 'normal horizontal categories start at the bottom');
  assert.equal(chart(['A', 'B'], undefined, 'bar', true).axis.x.inverted, false, 'reversed horizontal categories start at the top');
  assert.equal(chart(['A', 'B'], undefined, 'col', true).axis.x.inverted, true, 'vertical charts retain the source axis direction');

  const positioned = createPptxCartesianChart({
    groups: [{ chartType: 'barChart', barDirection: 'bar', axisIds: ['x', 'y'],
      options: { series: [{ labels: { showValue: true, position: 'inEnd', font: { sizePt: 10, color: '#FFFFFF' }, backgroundColor: '#EEEEEE' } }] },
      series: [{ key: 'a', values: [{ x: 0, y: 120 }], xlabels: ['A'] }] }],
    axes: [{ id: 'x', kind: 'category' }, { id: 'y', kind: 'value', min: 0, numberFormat: { code: '#,##0' } }],
  }, { bar: () => 'bar' });
  assert.deepEqual(positioned.axis.y.padding, { bottom: 0 }, 'automatic maximum retains room for labels');
  assert.equal(positioned.axis.y.tick.culling.max, 7, 'crowded automatic ticks are thinned without replacing their values');
  assert.equal(positioned.data.labels.colors('red', { id: 'pptx-series-0-0', index: 0 }), '#FFFFFF');
  assert.equal(positioned.data.labels.backgroundColors['pptx-series-0-0'], '#EEEEEE');
  const nodes = { nodes: () => [{ __data__: { id: 'pptx-series-0-0', index: 0 }, getComputedTextLength: () => 36 }] };
  assert.equal(positioned.data.labels.position('x', 120, 'pptx-series-0-0', 0, nodes), -44, 'inside-end labels move inside the bar');

  const mixed = createPptxCartesianChart({
    groups: [
      { chartType: 'barChart', barDirection: 'col', axisIds: ['x', 'y'], options: { labels: { showValue: true } }, series: [{ key: 'Bar', values: [{ x: 0, y: 120 }], xlabels: ['A'] }] },
      { chartType: 'lineChart', axisIds: ['x2', 'y2'], options: { series: [{ labels: { showValue: true, position: 'b', font: { sizePt: 10 } } }] }, series: [{ key: 'Line', values: [{ x: 0, y: 60 }], xlabels: ['A'] }] },
    ], axes: [{ id: 'x', kind: 'category' }, { id: 'y', kind: 'value' }, { id: 'x2', kind: 'category' }, { id: 'y2', kind: 'value' }],
  }, { bar: () => 'bar', line: () => 'line' });
  assert.equal(mixed.data.labels.position('y', 60, 'pptx-series-1-0', 0, { nodes: () => [] }), 18);
});

test('PPTX combination-chart labels separate only when they actually overlap', () => {
  const rows = new Map([['bar', { group: { chartType: 'barChart' } }], ['line', { group: { chartType: 'lineChart' } }]]);
  const chart = { getBoundingClientRect: () => ({ top: 0, bottom: 300 }) };
  const label = (id, index, top, bottom) => ({
    __data__: { id, index }, textContent: '123', isConnected: true, ownerSVGElement: chart, y: 20,
    getAttribute(name) { return name === 'y' ? String(this.y) : null; }, hasAttribute: () => false,
    setAttribute(name, value) { if (name === 'y') this.y = Number(value); },
    getBoundingClientRect: () => ({ left: 10, right: 50, top, bottom, width: 40, height: bottom - top }),
    getScreenCTM: () => ({ d: 2 }),
  });
  const bar = label('bar', 0, 105, 125), line = label('line', 0, 100, 120);
  const unrelated = label('line', 1, 100, 120);
  separateOverlappingLabels([bar, line, unrelated], rows, () => ({ position: 'b' }));
  assert.equal(line.y, 34, 'a colliding label moves below the bar label using screen scale');
  assert.equal(unrelated.y, 20, 'a label for another category is untouched');
});
