'use strict';

// Flyfish 3.3.4 uses one zoom value for both its public control and the
// spreadsheet geometry. Keep the public value at 100%, while drawing Excel
// workbooks at 70% of the original geometry. Delimited text keeps its size.
function replace(source, before, after, expected, label) {
  const count = source.split(before).length - 1;
  if (count !== expected) throw new Error(`Flyfish ${label} changed; reassess the Excel zoom adjustment (found ${count}, expected ${expected}).`);
  return source.replaceAll(before, after);
}

function patchSpreadsheet(source) {
  const changes = [
    ['    let zoom = 1;', `    let zoom = 1;
    const quickLookExtension = String((context && context.filename) || type || '').split('.').pop().toLowerCase();
    const quickLookBaseScale = /^(?:xlsx|xltx|xlsm|xlsb|xls|xlt|xla|xlam|xltm)$/.test(quickLookExtension) ? 0.7 : 1;
    const quickLookRenderScale = () => zoom * quickLookBaseScale;`, 1, 'zoom initialization'],
    ['Math.round(value * zoom)', 'Math.round(value * quickLookRenderScale())', 2, 'row and image geometry'],
    ['getZoom: () => zoom,', 'getZoom: () => quickLookRenderScale(),', 1, 'automatic row heights'],
    ['contentWidth: content.contentWidth,', 'contentWidth: content.contentWidth * quickLookBaseScale,', 1, 'fit width'],
    ['contentHeight: content.contentHeight,', 'contentHeight: content.contentHeight * quickLookBaseScale,', 1, 'fit height'],
    ['Math.max(getHostHeight(), 240), zoom)', 'Math.max(getHostHeight(), 240), quickLookRenderScale())', 1, 'viewport fill'],
    ['zoomScale: zoom,', 'zoomScale: quickLookRenderScale(),', 2, 'table styles'],
    ['getDisplayColumns(display.columns, zoom)', 'getDisplayColumns(display.columns, quickLookRenderScale())', 1, 'display columns'],
    ['getDisplayColumns(virtualState.columns, zoom)', 'getDisplayColumns(virtualState.columns, quickLookRenderScale())', 1, 'search columns'],
    ['Math.max(zoom, 0.01)', 'Math.max(quickLookRenderScale(), 0.01)', 2, 'row and column resizing'],
    ['Math.max(zoom, 1)', 'Math.max(quickLookRenderScale(), 1)', 1, 'minimum column width'],
    ['content.contentWidth * zoom', 'content.contentWidth * quickLookRenderScale()', 1, 'horizontal scrolling'],
    ['content.contentHeight * zoom', 'content.contentHeight * quickLookRenderScale()', 1, 'vertical scrolling'],
  ];
  for (const [before, after, count, label] of changes) source = replace(source, before, after, count, label);
  return source;
}

function patchView(source) {
  // Rendering can reach 70% of the public minimum (25%). Keep the public zoom
  // limits unchanged; only the internal geometry accepts the smaller value.
  return replace(source,
    'Math.min(SPREADSHEET_MAX_ZOOM, Math.max(SPREADSHEET_MIN_ZOOM, scale))',
    'Math.min(SPREADSHEET_MAX_ZOOM, Math.max(SPREADSHEET_MIN_ZOOM * 0.7, scale))', 1, 'rendering scale clamp');
}

module.exports = { patchSpreadsheet, patchView };
