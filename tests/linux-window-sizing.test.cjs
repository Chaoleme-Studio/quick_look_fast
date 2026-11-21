const { test } = require('node:test');
const assert = require('node:assert/strict');
const { linuxPreviewWindowGeometry } = require('../build/dist-electron/platform/linux/window-sizing.js');

test('Linux previews start within a small work area with room for native resize borders', () => {
  const area = { x: 0, y: 0, width: 1024, height: 720 };
  const options = linuxPreviewWindowGeometry(area);
  assert.deepEqual(options, { width: 839, height: 590, minWidth: 629, minHeight: 442 });
  assert.ok(options.width < area.width && options.height < area.height);
});

test('larger and very small displays retain sensible window and minimum dimensions', () => {
  const large = linuxPreviewWindowGeometry({ x: 0, y: 0, width: 1920, height: 1080 });
  assert.deepEqual(large, { width: 1080, height: 760, minWidth: 640, minHeight: 480 });
  const tiny = linuxPreviewWindowGeometry({ x: 0, y: 0, width: 640, height: 400 });
  assert.deepEqual(tiny, { width: 524, height: 328, minWidth: 393, minHeight: 246 });
  assert.ok(tiny.minWidth <= tiny.width * 0.75 && tiny.minHeight <= tiny.height * 0.75,
    'small-screen previews can shrink in both directions');
  const small = linuxPreviewWindowGeometry({ x: 0, y: 0, width: 800, height: 600 });
  assert.ok(small.minWidth <= small.width * 0.75 && small.minHeight <= small.height * 0.75,
    'an 800×600 display also retains room to shrink');
});

test('a second pinned preview preserves a usable custom size and stays inside the X11 display', () => {
  const area = { x: 1024, y: 50, width: 1024, height: 720 };
  const previous = { x: 1600, y: 400, width: 700, height: 500 };
  const result = linuxPreviewWindowGeometry(area, previous);
  assert.equal(result.width, 700);
  assert.equal(result.height, 500);
  assert.ok(result.x >= area.x + 32 && result.x + result.width <= area.x + area.width - 32);
  assert.ok(result.y >= area.y + 32 && result.y + result.height <= area.y + area.height - 32);

  const oversized = linuxPreviewWindowGeometry(area, { x: 0, y: 0, width: 5000, height: 5000 });
  assert.equal(oversized.width, 960);
  assert.equal(oversized.height, 656);
  assert.equal(oversized.x, area.x + 32);
  assert.equal(oversized.y, area.y + 32);
});

test('Wayland placement is left to the compositor', () => {
  const result = linuxPreviewWindowGeometry({ x: 0, y: 0, width: 1024, height: 720 },
    { x: 0, y: 0, width: 700, height: 500 }, false);
  assert.equal(result.width, 700);
  assert.equal(result.height, 500);
  assert.equal('x' in result, false);
  assert.equal('y' in result, false);
});
