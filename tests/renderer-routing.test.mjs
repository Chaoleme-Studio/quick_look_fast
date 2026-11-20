import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RENDERER_DEFINITIONS } from '@file-viewer/core';
import { signatureRendererDefinition } from '@file-viewer/renderer-signature';
import { selectExtraRenderers } from '../src/preview/extra-renderers.ts';

test('loads specialist renderers only for their registered file types', () => {
  for (const definition of DEFAULT_RENDERER_DEFINITIONS) {
    const expected = definition.packageName === '@file-viewer/renderer-design' ? 'design' :
      definition.packageName === '@file-viewer/renderer-binary' ? 'binary' : undefined;
    if (!expected) continue;
    for (const extension of [...definition.extensions, ...(definition.enhancesExtensions || [])]) {
      assert.ok(selectExtraRenderers(`example.${extension.toUpperCase()}`, DEFAULT_RENDERER_DEFINITIONS).has(expected), `${definition.id}: ${extension}`);
    }
  }
  for (const extension of signatureRendererDefinition.extensions) {
    assert.ok(selectExtraRenderers(`example.${extension}`, DEFAULT_RENDERER_DEFINITIONS).has('signature'), `signature: ${extension}`);
  }
  for (const filename of ['example.txt', 'example.pdf', 'example.docx', 'movie.mp4']) {
    assert.equal(selectExtraRenderers(filename, DEFAULT_RENDERER_DEFINITIONS).size, 0, filename);
  }
});
