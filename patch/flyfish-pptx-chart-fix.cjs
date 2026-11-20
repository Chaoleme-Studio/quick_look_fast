'use strict';

// Billboard places each data label independently. In a column/line chart,
// an Office label below the line can otherwise cover the column's value.
function separateOverlappingLabels(nodes, byId, labelProperties) {
  const bars = nodes.filter(node => byId.get(node.__data__?.id)?.group.chartType === 'barChart' && node.textContent?.trim());
  if (!bars.length) return;
  for (const line of nodes) {
    const data = line.__data__, row = byId.get(data?.id);
    if (!line.isConnected || row?.group.chartType !== 'lineChart' || labelProperties(data.id, data.index).position !== 'b' || !line.textContent?.trim()) continue;
    const rawY = line.getAttribute('y');
    if (rawY === null || line.hasAttribute('transform')) continue;
    const y = Number(rawY), rect = line.getBoundingClientRect(), chart = line.ownerSVGElement?.getBoundingClientRect();
    if (!Number.isFinite(y) || !rect.width || !rect.height || !chart) continue;
    for (const bar of bars) {
      if (bar.__data__?.index !== data.index) continue;
      const other = bar.getBoundingClientRect();
      if (!(rect.left < other.right + 2 && rect.right + 2 > other.left && rect.top < other.bottom + 2 && rect.bottom + 2 > other.top)) continue;
      const scale = Math.abs(line.getScreenCTM()?.d || 1);
      let delta = other.bottom + 3 - rect.top;
      if (rect.bottom + delta > chart.bottom - 2) delta = other.top - 3 - rect.bottom;
      if (rect.top + delta < chart.top + 2) continue;
      line.setAttribute('y', String(y + delta / scale));
      break;
    }
  }
}

// In Flyfish 3.3.4, horizontal categories force multiline:false. Billboard
// then puts a literal newline in one SVG tspan instead of creating lines.
// Only change categories that already contain explicit line breaks and do
// not override an explicit Office rotation.
function patchChartConfig(source) {
  const before = `: { multiline: false, culling: false, rotate: (_d = category === null || category === void 0 ? void 0 : category.labelRotation) !== null && _d !== void 0 ? _d : 60, autorotate: (category === null || category === void 0 ? void 0 : category.labelRotation) === undefined } },`;
  const after = `: categories.some(label => /[\\r\\n]/.test(label || ''))
                    ? { multiline: true, culling: false, rotate: (_d = category === null || category === void 0 ? void 0 : category.labelRotation) !== null && _d !== void 0 ? _d : 0, autorotate: false }
                    : { multiline: false, culling: false, rotate: (_d = category === null || category === void 0 ? void 0 : category.labelRotation) !== null && _d !== void 0 ? _d : 60, autorotate: (category === null || category === void 0 ? void 0 : category.labelRotation) === undefined } },`;
  if (source.split(before).length !== 2) throw new Error('Flyfish PPTX chart code changed; reassess multiline axis labels.');
  source = source.replace(before, after);

  // PowerPoint's normal category order starts at the bottom for horizontal
  // bars; Billboard's rotated category axis starts at the top by default.
  const rotatedCategory = `x: { ...axisOptions(category), type: 'category', categories, tick: model.groups.some(group => group.barDirection === 'bar')`;
  const fixedCategory = `x: { ...axisOptions(category), ...(model.groups.some(group => group.barDirection === 'bar') ? { inverted: !(category === null || category === void 0 ? void 0 : category.reversed) } : {}), type: 'category', categories, tick: model.groups.some(group => group.barDirection === 'bar')`;
  if (source.split(rotatedCategory).length !== 2) throw new Error('Flyfish PPTX chart axis code changed; reassess horizontal category order.');
  source = source.replace(rotatedCategory, fixedCategory);

  // Keep an explicit bound exact without removing the automatic padding on
  // the opposite end. Otherwise the largest bar and its value are clipped.
  const originalPadding = `...(axis.min !== undefined || axis.max !== undefined ? { padding: { top: 0, bottom: 0 } } : {}),`;
  const fixedPadding = `...(axis.min !== undefined || axis.max !== undefined ? { padding: { ...(axis.max !== undefined ? { top: 0 } : {}), ...(axis.min !== undefined ? { bottom: 0 } : {}) } } : {}),`;
  if (source.split(originalPadding).length !== 2) throw new Error('Flyfish PPTX axis padding changed; reassess clipped data labels.');
  source = source.replace(originalPadding, fixedPadding);

  const tickFormat = `...(axis.numberFormat ? { tick: { format: (value) => formatPptxChartNumber(value, axis.numberFormat.code) } } : {}),`;
  const readableTicks = `...(axis.kind === 'value' || axis.numberFormat ? { tick: { ...(axis.kind === 'value' ? { culling: { max: 7 } } : {}), ...(axis.numberFormat ? { format: (value) => formatPptxChartNumber(value, axis.numberFormat.code) } : {}) } } : {}),`;
  if (source.split(tickFormat).length !== 2) throw new Error('Flyfish PPTX axis tick configuration changed; reassess tick density.');
  source = source.replace(tickFormat, readableTicks);

  const returnChart = `    return {\n        data: {\n            columns, types, type: types[(_c = rows[0]) === null || _c === void 0 ? void 0 : _c.id], axes: dataAxes,`;
  const labelHelpers = `    const labelProperties = (id, position) => {
        const row = byId.get(id);
        if (!row) return {};
        const group = row.group.options.labels || {};
        const series = row.group.options.series?.[row.index]?.labels || {};
        const point = { ...group.points?.[indices[position]], ...series.points?.[indices[position]] };
        return { ...group, ...series, ...point, font: { ...group.font, ...series.font, ...point.font } };
    };
    const labelColor = (fallback, point) => labelProperties(point.id, point.index).font?.color || fallback;
    const separateLabels = ${separateOverlappingLabels.toString()};
    let labelFrame = 0, labelTimer = 0;
    const scheduleLabelLayout = (texts) => {
        const nodes = texts?.nodes?.(), view = nodes?.[0]?.ownerDocument?.defaultView;
        if (!nodes || !view?.requestAnimationFrame) return;
        if (!labelFrame) labelFrame = view.requestAnimationFrame(() => { labelFrame = 0; separateLabels(nodes, byId, labelProperties); });
        view.clearTimeout(labelTimer);
        labelTimer = view.setTimeout(() => separateLabels(nodes, byId, labelProperties), 450);
    };
    const labelPosition = function(axis, value, id, position, texts) {
        const row = byId.get(id), options = labelProperties(id, position);
        if (!row) return 0;
        if (axis === 'y' && row.group.chartType === 'lineChart' && options.position === 'b') {
            if (rows.filter(item => item.group.chartType === 'barChart').length === 1) scheduleLabelLayout(texts);
            return 18;
        }
        if (axis !== 'x' || row.group.barDirection !== 'bar' || options.position !== 'inEnd' || !Number.isFinite(value)) return 0;
        const node = texts?.nodes?.().find(item => item.__data__?.id === id && item.__data__?.index === position);
        let width = 0;
        try { width = node?.getComputedTextLength?.() || node?.getBBox?.().width || 0; } catch { /* Approximate below. */ }
        if (!(width > 0)) width = String(labelFormat(value, id, position)).length * (options.font?.sizePt || 10) * 0.8;
        const inverted = (dataAxes[id] === 'y2' ? secondary : primary)?.reversed;
        return (value < 0 ? 1 : -1) * (inverted ? -1 : 1) * (width + 8);
    };
    const labelBackgrounds = Object.fromEntries(rows.flatMap(row => {
        const color = labelProperties(row.id, 0).backgroundColor;
        return typeof color === 'string' && /^#[\\da-f]{6}(?:[\\da-f]{2})?$/i.test(color) ? [[row.id, color]] : [];
    }));
`;
  if (source.split(returnChart).length !== 2) throw new Error('Flyfish PPTX chart result changed; reassess data-label layout.');
  source = source.replace(returnChart, labelHelpers + returnChart);
  const originalLabels = `...(hasLabels ? { labels: { format: labelFormat } } : {}),`;
  const fixedLabels = `...(hasLabels ? { labels: { format: labelFormat, colors: labelColor, position: labelPosition, ...(Object.keys(labelBackgrounds).length ? { backgroundColors: labelBackgrounds } : {}) } } : {}),`;
  if (source.split(originalLabels).length !== 2) throw new Error('Flyfish PPTX data-label options changed; reassess data-label layout.');
  return source.replace(originalLabels, fixedLabels);
}
module.exports = { patchChartConfig, separateOverlappingLabels };
