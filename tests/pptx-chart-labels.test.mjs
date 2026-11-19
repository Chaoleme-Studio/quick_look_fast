import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { patchChartConfig } = require('../scripts/flyfish-pptx-chart-fix.cjs');

test('PPTX chart categories preserve explicit line breaks without changing other charts', async () => {
  const source = await readFile(new URL('../node_modules/@file-viewer/pptx/dist/chart-config.js', import.meta.url), 'utf8');
  const fixed = patchChartConfig(source);
  const { createPptxCartesianChart } = await import(`data:text/javascript;base64,${Buffer.from(fixed).toString('base64')}`);
  const chart = (labels, labelRotation) => createPptxCartesianChart({
    groups: [{ chartType: 'barChart', axisIds: ['x', 'y'], options: {}, series: [{ key: 'a', values: labels.map((_, x) => ({ x, y: x + 1 })), xlabels: labels }] }],
    axes: [{ id: 'x', kind: 'category', labelRotation }, { id: 'y', kind: 'value' }],
  }, { bar: () => 'bar' });
  assert.equal(chart(['7月\n97,672笔', '8月\n55,933笔']).axis.x.tick.multiline, true);
  assert.equal(chart(['7月\n97,672笔']).axis.x.tick.rotate, 0);
  assert.equal(chart(['7月\n97,672笔'], 45).axis.x.tick.rotate, 45);
  assert.equal(chart(['January', 'February']).axis.x.tick.multiline, false);
});
