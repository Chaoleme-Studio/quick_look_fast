import { randomBytes } from 'node:crypto';
import { lstat, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';

const PAGE_SIZE = 200;
const MAX_ENTRIES_PER_DIRECTORY = 2000;
const MAX_DIRECTORIES = 5000;
const MAX_DEPTH = 32;
const MAX_FILES = 20000;

export interface DirectoryEntry {
  name: string;
  kind: 'directory' | 'file' | 'link' | 'other';
  id?: string;
}

export interface DirectoryPage {
  entries: DirectoryEntry[];
  nextOffset: number | null;
  truncated: boolean;
}

interface Node { path: string; depth: number }
export interface DirectoryFile { path: string; name: string; size: number; modifiedAt: string; createdAt: string }

/** The renderer receives opaque IDs, never permission to request arbitrary paths. */
export class DirectoryService {
  private revision = 0;
  private nodes = new Map<string, Node>();
  private ids = new Map<string, string>();
  private files = new Map<string, string>();
  private fileIds = new Map<string, string>();
  private rootPath = '';

  open(rootPath: string): string {
    this.clear();
    this.rootPath = path.resolve(rootPath);
    return this.addDirectory(this.rootPath, 0)!;
  }

  clear(): void {
    this.revision += 1;
    this.nodes.clear();
    this.ids.clear();
    this.files.clear();
    this.fileIds.clear();
    this.rootPath = '';
  }

  private addFile(filePath: string): string | undefined {
    const key = process.platform === 'win32' ? filePath.toLowerCase() : filePath;
    const existing = this.fileIds.get(key);
    if (existing) return existing;
    if (this.files.size >= MAX_FILES) return undefined;
    const id = randomBytes(18).toString('hex');
    this.files.set(id, filePath);
    this.fileIds.set(key, id);
    return id;
  }

  private async validateDirectory(directoryPath: string, root: string, revision: number): Promise<void> {
    const relative = path.relative(root, directoryPath);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('文件夹不在当前预览中');
    let current = root;
    for (const part of ['', ...relative.split(path.sep).filter(Boolean)]) {
      if (part) current = path.join(current, part);
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('链接或非文件夹不能展开');
    }
    const [rootReal, directoryReal] = await Promise.all([realpath(root), realpath(directoryPath)]);
    const actual = path.relative(rootReal, directoryReal);
    if (actual === '..' || actual.startsWith(`..${path.sep}`) || path.isAbsolute(actual)) throw new Error('文件夹位置已改变');
    if (revision !== this.revision || root !== this.rootPath) throw new Error('目录预览已关闭');
  }

  /** Resolve only a file already returned by this directory's listing. */
  async file(id: unknown): Promise<DirectoryFile> {
    if (typeof id !== 'string') throw new Error('无效的文件请求');
    const filePath = this.files.get(id);
    const root = this.rootPath;
    const revision = this.revision;
    if (!filePath || !root) throw new Error('文件夹预览已失效');
    const relative = path.relative(root, filePath);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('文件不在当前文件夹中');
    await this.validateDirectory(path.dirname(filePath), root, revision);
    const [rootReal, fileReal, info] = await Promise.all([realpath(root), realpath(filePath), lstat(filePath)]);
    const realRelative = path.relative(rootReal, fileReal);
    if (!realRelative || realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative) || info.isSymbolicLink() || !info.isFile()) throw new Error('文件位置已改变');
    if (revision !== this.revision || this.files.get(id) !== filePath) throw new Error('文件夹预览已关闭');
    return { path: filePath, name: path.basename(filePath), size: info.size, modifiedAt: info.mtime.toISOString(), createdAt: info.birthtime.toISOString() };
  }

  private addDirectory(directoryPath: string, depth: number): string | undefined {
    const key = process.platform === 'win32' ? directoryPath.toLowerCase() : directoryPath;
    const existing = this.ids.get(key);
    if (existing) return existing;
    if (depth > MAX_DEPTH || this.nodes.size >= MAX_DIRECTORIES) return undefined;
    const id = randomBytes(18).toString('hex');
    this.nodes.set(id, { path: directoryPath, depth });
    this.ids.set(key, id);
    return id;
  }

  async read(id: unknown, offset: unknown): Promise<DirectoryPage> {
    if (typeof id !== 'string' || typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset >= MAX_ENTRIES_PER_DIRECTORY) {
      throw new Error('无效的目录请求');
    }
    const node = this.nodes.get(id);
    if (!node) throw new Error('目录预览已失效');
    const revision = this.revision;
    const root = this.rootPath;
    if (!root) throw new Error('目录预览已失效');
    await this.validateDirectory(node.path, root, revision);
    const dir = await opendir(node.path);
    const entries: DirectoryEntry[] = [];
    let index = 0;
    let hasMore = false;
    try {
      await this.validateDirectory(node.path, root, revision);
      while (index < offset + PAGE_SIZE + 1) {
        if (revision !== this.revision) throw new Error('目录预览已关闭');
        const item = await dir.read();
        if (revision !== this.revision) throw new Error('目录预览已关闭');
        if (!item) break;
        if (index >= offset) {
          if (entries.length === PAGE_SIZE) { hasMore = true; break; }
          const kind = item.isSymbolicLink() ? 'link' : item.isDirectory() ? 'directory' : item.isFile() ? 'file' : 'other';
          const childPath = path.join(node.path, item.name);
          const childId = kind === 'directory' ? this.addDirectory(childPath, node.depth + 1) : kind === 'file' ? this.addFile(childPath) : undefined;
          entries.push({ name: item.name, kind, id: childId });
        }
        index += 1;
      }
      await this.validateDirectory(node.path, root, revision);
    } finally {
      await dir.close();
    }
    const next = offset + entries.length;
    return { entries, nextOffset: hasMore && next < MAX_ENTRIES_PER_DIRECTORY ? next : null, truncated: hasMore && next >= MAX_ENTRIES_PER_DIRECTORY };
  }
}
