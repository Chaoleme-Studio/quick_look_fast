import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RENDERER_DEFINITIONS } from '@file-viewer/core';
import { signatureRendererDefinition } from '@file-viewer/renderer-signature';
import { selectExtraRenderers } from '../src/preview/extra-renderers.ts';
import { FORCE_INSPECTION_EXTENSIONS } from '../src/preview/file-inspection.ts';

test('format inventory distinguishes the upstream catalog from configured renderers and metadata fallbacks', () => {
  const extras = new Set(['@file-viewer/renderer-design', '@file-viewer/renderer-binary', '@file-viewer/renderer-signature']);
  const upstream = new Set(DEFAULT_RENDERER_DEFINITIONS.flatMap((definition) => definition.extensions));
  const configured = new Set(DEFAULT_RENDERER_DEFINITIONS
    .filter((definition) => definition.presets?.includes('all') || extras.has(definition.packageName))
    .flatMap((definition) => definition.extensions));
  assert.equal(upstream.size, 275, 'recalculate the documented upstream catalog when upgrading Flyfish');
  assert.equal(configured.size, 272, 'recalculate the documented configured routes when upgrading Flyfish');
  assert.equal(configured.size - FORCE_INSPECTION_EXTENSIONS.filter((extension) => configured.has(extension)).length, 266);
  assert.ok(!configured.has('dcm') && !configured.has('dicom') && !configured.has('bpmn'));
  for (const extension of signatureRendererDefinition.extensions) {
    assert.ok(selectExtraRenderers(`file.${extension}`, DEFAULT_RENDERER_DEFINITIONS).has('signature'));
  }
});
