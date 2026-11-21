const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nextPreviewWindowGeometry } = require('../build/dist-electron/platform/preview-window-geometry.js');

test('new previews preserve size and offset within a multi-monitor work area', () => {
  const area = { x: -1440, y: 50, width: 1440, height: 900 };
  const previous = { x: -900, y: 390, width: 900, height: 560 };
  const next = nextPreviewWindowGeometry(area, previous);
  assert.deepEqual(next, { x: -936, y: 354, width: 900, height: 560, minWidth: 640, minHeight: 480 });
  assert.ok(next.x >= area.x && next.x + next.width <= area.x + area.width);
  assert.ok(next.y >= area.y && next.y + next.height <= area.y + area.height);
});

test('an oversized preview is reduced to fit the target display', () => {
  const next = nextPreviewWindowGeometry({ x: 0, y: 0, width: 600, height: 400 }, { x: 1200, y: 800, width: 1200, height: 900 });
  assert.deepEqual(next, { x: 0, y: 0, width: 600, height: 400, minWidth: 600, minHeight: 400 });
});
