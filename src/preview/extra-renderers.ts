import type { RendererDefinition } from '@file-viewer/core';

// These formats belong to the standalone signature plugin, which is not part
// of the shared core catalog. A regression test keeps the list in sync.
const signatureExtensions = new Set([
  'p7m', 'p7s', 'p7b', 'p7c', 'pkcs7', 'cms', 'cmsc', 'tsq', 'tsr', 'tst', 'tsd',
  'asics', 'scs', 'asice', 'sce', 'ers', 'asc', 'sig', 'pgp', 'gpg', 'jws',
]);

export function selectExtraRenderers(filename: string, definitions: readonly RendererDefinition[]): Set<'binary' | 'design' | 'signature'> {
  const dot = filename.lastIndexOf('.');
  const extension = dot < 0 ? '' : filename.slice(dot + 1).toLowerCase();
  const result = new Set<'binary' | 'design' | 'signature'>();
  if (signatureExtensions.has(extension)) result.add('signature');
  for (const definition of definitions) {
    if (!definition.extensions.includes(extension) && !definition.enhancesExtensions?.includes(extension)) continue;
    if (definition.packageName === '@file-viewer/renderer-binary') result.add('binary');
    if (definition.packageName === '@file-viewer/renderer-design') result.add('design');
  }
  return result;
}
