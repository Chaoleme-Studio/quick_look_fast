/** Hide only the two well-known macOS metadata entries, never arbitrary dotfiles. */
export function isMacMetadataEntry(name: string, directory: boolean): boolean {
  return directory ? name === '__MACOSX' : name === '.DS_Store';
}

/** Archive paths can include implicit folders even without directory entries. */
export function isMacMetadataArchiveEntry(name: string, directory: boolean): boolean {
  const parts = name.split('/').filter(Boolean);
  return parts.some((part, index) => isMacMetadataEntry(part, index < parts.length - 1 || directory));
}
