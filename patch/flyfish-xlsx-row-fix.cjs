'use strict';

// Flyfish 3.3.4 supplies both stored heights and XLSX customHeight metadata.
// A stored automatic height is a baseline, not a manually fixed height.
function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (source.split(before).length !== 2) throw new Error(`Flyfish ${label} changed; reassess the spreadsheet row-height repair.`);
  return source.replace(before, after);
}

function patchSpreadsheet(source) {
  source = replaceOnce(source,
    'const applyStructureRowHeights = (rowHeights) => {',
    'const applyStructureRowHeights = (rowHeights, keepStoredHeightsFixed) => {', 'row height handler');
  source = replaceOnce(source,
    '            virtualState.fixedHeightRows.add(absoluteRow);\n            const sourceHeight =',
    '            if (keepStoredHeightsFixed) virtualState.fixedHeightRows.add(absoluteRow);\n            const sourceHeight =', 'stored row height');
  return replaceOnce(source,
    'applyStructureRowHeights(structure === null || structure === void 0 ? void 0 : structure.rowHeights);',
    'applyStructureRowHeights(structure === null || structure === void 0 ? void 0 : structure.rowHeights, !(structure && structure.rowSizing) || structure.rowSizing.autoHeightDisabled === true);', 'row sizing metadata');
}

function patchAutoRowHeight(source) {
  source = replaceOnce(source,
    'const column = columns.get(getDataKey(col)), width = Number(column === null || column === void 0 ? void 0 : column.width);\n            const key = displayCellKey(job.row, col + 1);',
    `const column = columns.get(getDataKey(col));
            let width = Number(column === null || column === void 0 ? void 0 : column.width);
            const key = displayCellKey(job.row, col + 1);
            const merge = state.mergeStartMap.get(key);
            // Single-row merged headings are measured using their full visible width.
            // Multi-row merges need a different distribution policy and remain unchanged.
            if (merge && merge.rowspan === 1 && merge.colspan > 1 && merge.colspan <= 1024) {
                width = 0;
                for (let offset = 0; offset < merge.colspan; offset++) {
                    const mergedColumn = columns.get(getDataKey(col + offset));
                    if (mergedColumn && !mergedColumn.hide) width += Number(mergedColumn.width) || 0;
                }
            }`, 'automatic row width');
  return replaceOnce(source,
    'state.mergeStartMap.has(key) ||\n                state.mergeCoveredMap.has(key)',
    '(merge && (merge.rowspan !== 1 || merge.colspan > 1024)) ||\n                state.mergeCoveredMap.has(key)', 'merged cell measurement');
}

module.exports = { patchSpreadsheet, patchAutoRowHeight };
