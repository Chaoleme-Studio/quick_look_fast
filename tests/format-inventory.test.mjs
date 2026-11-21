import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('published format list includes every configured content route and local media extension', () => {
  const extras = new Set(['@file-viewer/renderer-design', '@file-viewer/renderer-binary', '@file-viewer/renderer-signature']);
  const expected = new Set(DEFAULT_RENDERER_DEFINITIONS
    .filter(definition => definition.presets?.includes('all') || extras.has(definition.packageName))
    .flatMap(definition => definition.extensions)
    .filter(extension => !FORCE_INSPECTION_EXTENSIONS.includes(extension)));
  for (const extension of ['m4v', 'mov', 'ogv']) expected.add(extension);
  const document = readFileSync(new URL('../docs/formats.md', import.meta.url), 'utf8');
  const section = document.split('<!-- formats:content:start -->')[1]?.split('<!-- formats:content:end -->')[0];
  assert.ok(section, 'format table markers must exist');
  const listed = new Set([...section.matchAll(/`\.([a-z0-9]+)`/g)].map(match => match[1]));
  assert.deepEqual([...listed].sort(), [...expected].sort(), 'format table must match configured routes');
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const readmeSection = readme.split('<!-- formats:content:start -->')[1]?.split('<!-- formats:content:end -->')[0];
  assert.equal(readmeSection?.replace(/\r\n/g, '\n'), section.replace(/\r\n/g, '\n'), 'README and format guide must contain the same table');
});
