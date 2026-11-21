'use strict';

// Expose the heading levels already resolved by Flyfish for its TOC fields.
// The visible document and its pagination remain entirely under its control.
function patchDocxOutline(source) {
  const indexBefore = 'paragraph.props = { ...(paragraph.props ?? {}), anchorId: id };';
  const indexAfter = 'paragraph.props = { ...(paragraph.props ?? {}), anchorId: id, quicklookOutlineLevel: level + 1 };';
  const renderBefore = 'result.setAttribute("id", elem.props.anchorId);';
  const renderAfter = 'result.setAttribute("id", elem.props.anchorId);\n                if (elem.props.quicklookOutlineLevel) result.dataset.quicklookOutlineLevel = String(elem.props.quicklookOutlineLevel);';
  for (const [before, after] of [[indexBefore, indexAfter], [renderBefore, renderAfter]]) {
    if (source.includes(after)) continue;
    if (source.split(before).length !== 2) throw new Error('Flyfish DOCX heading rendering changed; reassess the outline patch.');
    source = source.replace(before, after);
  }
  return '/* QuickLook Fast exposes Flyfish heading levels for its document navigation; see THIRD_PARTY.md. */\n' + source;
}

module.exports = { patchDocxOutline };
