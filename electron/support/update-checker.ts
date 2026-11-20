const LATEST_RELEASE_API = 'https://api.github.com/repos/Chaoleme-Studio/quick_look_fast/releases/latest';
const MAX_RESPONSE_BYTES = 256 * 1024;

export type UpdateResult =
  | { state: 'available' | 'up-to-date'; currentVersion: string; latestVersion: string }
  | { state: 'error'; currentVersion: string; message: string };

interface Version { parts: number[]; pre: string[] }
function parseVersion(input: string): Version | undefined {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(input);
  if (!match) return undefined;
  const parts = match.slice(1, 4).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) return undefined;
  const pre = match[4] ? match[4].split('.') : [];
  if (pre.some((part) => !part || (/^\d+$/.test(part) && ((part.length > 1 && part.startsWith('0')) || !Number.isSafeInteger(Number(part)))))) return undefined;
  return { parts, pre };
}

export function compareVersions(left: string, right: string): number | undefined {
  const a = parseVersion(left), b = parseVersion(right);
  if (!a || !b) return undefined;
  for (let i = 0; i < 3; i++) if (a.parts[i] !== b.parts[i]) return a.parts[i] > b.parts[i] ? 1 : -1;
  if (!a.pre.length || !b.pre.length) return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    if (a.pre[i] === undefined) return -1;
    if (b.pre[i] === undefined) return 1;
    if (a.pre[i] === b.pre[i]) continue;
    const aNumeric = /^\d+$/.test(a.pre[i]), bNumeric = /^\d+$/.test(b.pre[i]);
    if (aNumeric && bNumeric) return Number(a.pre[i]) > Number(b.pre[i]) ? 1 : -1;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a.pre[i] > b.pre[i] ? 1 : -1;
  }
  return 0;
}

export async function checkForUpdates(currentVersion: string, fetcher: typeof fetch = fetch): Promise<UpdateResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetcher(LATEST_RELEASE_API, {
      signal: controller.signal,
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'QuickLook-Fast', 'X-GitHub-Api-Version': '2026-03-10' },
    });
    if (response.status === 404) throw new Error('暂时没有可用的正式版本。');
    if (response.status === 403 || response.status === 429) throw new Error('GitHub 请求受限，请稍后重试。');
    if (!response.ok) throw new Error(`GitHub 返回 HTTP ${response.status}。`);
    if (!response.body) throw new Error('未收到版本信息。');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error('版本信息过大。'); }
      chunks.push(value);
    }
    const payload: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const tag = payload && typeof payload === 'object' && 'tag_name' in payload ? (payload as { tag_name: unknown }).tag_name : undefined;
    if (typeof tag !== 'string' || tag.length > 80) throw new Error('版本信息格式不正确。');
    const order = compareVersions(tag, currentVersion);
    if (order === undefined) throw new Error('版本号格式不正确。');
    return { state: order > 0 ? 'available' : 'up-to-date', currentVersion, latestVersion: tag.replace(/^v/, '') };
  } catch (error) {
    return { state: 'error', currentVersion, message: error instanceof Error && error.name !== 'AbortError' && /^GitHub |^暂时|^未收到|^版本/.test(error.message)
      ? error.message : '无法连接 GitHub，请检查网络后重试。' };
  } finally { clearTimeout(timer); }
}
