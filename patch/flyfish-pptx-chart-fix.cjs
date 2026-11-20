'use strict';

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
  return source.replace(before, after);
}
module.exports = { patchChartConfig };
