const LATEST_RELEASE_API = 'https://api.github.com/repos/Chaoleme-Studio/quick_look_fast/releases/latest';
const LATEST_RELEASE_PAGE = 'https://github.com/Chaoleme-Studio/quick_look_fast/releases/latest';
const RELEASE_DOWNLOADS = 'https://github.com/Chaoleme-Studio/quick_look_fast/releases/download';
const MAX_RESPONSE_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 7_000;
const UPDATE_ERROR = '检查更新失败，请稍后重试。';
type RequestFactory = typeof import('electron').net.request;

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

function releaseTag(location: string): string | undefined {
  if (location.length > 2048) return undefined;
  try {
    const url = new URL(location, LATEST_RELEASE_PAGE);
    if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash) return undefined;
    const match = /^\/Chaoleme-Studio\/quick_look_fast\/releases\/tag\/([^/]+)$/.exec(url.pathname);
    if (!match) return undefined;
    const tag = decodeURIComponent(match[1]);
    const version = tag.length <= 80 ? parseVersion(tag) : undefined;
    return version && !version.pre.length ? tag : undefined;
  } catch { return undefined; }
}

/** Bound both connection and body reading, even if a network adapter ignores abort. */
function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, REQUEST_TIMEOUT_MS);
    Promise.resolve().then(() => operation(controller.signal)).then(
      (result) => { clearTimeout(timer); resolve(result); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/** Read the official latest-release redirect without ever following it. */
function readReleaseRedirect(factory: RequestFactory, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = factory({
      url: LATEST_RELEASE_PAGE, method: 'HEAD', partition: 'quicklook-fast-update',
      credentials: 'omit', cache: 'no-store', redirect: 'manual',
      headers: { 'User-Agent': 'QuickLook-Fast' },
    });
    let settled = false;
    const finish = (tag?: string): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      if (tag) resolve(tag); else reject(new Error('invalid release redirect'));
      request.abort();
    };
    const abort = (): void => finish();
    request.on('redirect', (status, method, location) => {
      const tag = [301, 302, 303, 307, 308].includes(status) && method === 'HEAD' ? releaseTag(location) : undefined;
      // No call to followRedirect: a compromised or invalid target is never contacted.
      finish(tag);
    });
    request.on('response', (response) => { response.on('error', () => undefined); finish(); });
    request.on('error', () => finish());
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) finish(); else request.end();
  });
}

async function readReleaseApi(fetcher: typeof fetch, signal: AbortSignal): Promise<string> {
  const response = await fetcher(LATEST_RELEASE_API, {
    signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'QuickLook-Fast', 'X-GitHub-Api-Version': '2026-03-10' },
  });
  if (!response.ok || !response.body) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error('release API unavailable');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) { void reader.cancel().catch(() => undefined); throw new Error('release response too large'); }
    chunks.push(value);
  }
  const payload: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!payload || typeof payload !== 'object') throw new Error('invalid release response');
  const release = payload as { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown };
  const tag = typeof release.html_url === 'string' ? releaseTag(release.html_url) : undefined;
  if (!tag || tag !== release.tag_name || release.draft !== false || release.prerelease !== false) throw new Error('invalid release response');
  return tag;
}

class InvalidManifestError extends Error {}

/** Read a release's manifest when present; older releases predate this file. */
async function readReleaseManifest(fetcher: typeof fetch, signal: AbortSignal, tag: string): Promise<string | undefined> {
  const response = await fetcher(`${RELEASE_DOWNLOADS}/${encodeURIComponent(tag)}/update.json`, {
    signal, redirect: 'follow', credentials: 'omit', cache: 'no-store',
    headers: { Accept: 'application/json', 'User-Agent': 'QuickLook-Fast' },
  });
  if (!response.ok || !response.body) {
    void response.body?.cancel().catch(() => undefined);
    return undefined;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) { void reader.cancel().catch(() => undefined); throw new InvalidManifestError(); }
    chunks.push(value);
  }
  let payload: unknown;
  try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new InvalidManifestError(); }
  if (!payload || typeof payload !== 'object') throw new InvalidManifestError();
  const manifest = payload as { schema?: unknown; version?: unknown; notesUrl?: unknown; assets?: unknown };
  if (manifest.schema !== 1 || manifest.version !== tag.replace(/^v/, '') ||
      typeof manifest.notesUrl !== 'string' || releaseTag(manifest.notesUrl) !== tag ||
      !manifest.assets || typeof manifest.assets !== 'object' || Array.isArray(manifest.assets) ||
      !Object.keys(manifest.assets).length) throw new InvalidManifestError();
  for (const [target, value] of Object.entries(manifest.assets)) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(target) || !value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidManifestError();
    const asset = value as { name?: unknown; url?: unknown; size?: unknown; sha256?: unknown };
    if (typeof asset.name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(asset.name) ||
        asset.url !== `${RELEASE_DOWNLOADS}/${encodeURIComponent(tag)}/${asset.name}` ||
        typeof asset.size !== 'number' || !Number.isSafeInteger(asset.size) || asset.size <= 0 ||
        typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new InvalidManifestError();
  }
  return tag;
}

export async function checkForUpdates(currentVersion: string, fetcher: typeof fetch = fetch, requestFactory?: RequestFactory): Promise<UpdateResult> {
  try {
    if (!parseVersion(currentVersion)) throw new Error('invalid current version');
    let tag: string;
    try {
      tag = await withTimeout(async (signal) => {
        const factory = requestFactory ?? (await import('electron')).net.request;
        return readReleaseRedirect(factory, signal);
      });
    } catch { tag = await withTimeout((signal) => readReleaseApi(fetcher, signal)); }
    // Read the release manifest when it exists. A missing or unreachable file
    // is expected for older releases; a present but invalid one is an error.
    try { tag = await withTimeout((signal) => readReleaseManifest(fetcher, signal, tag)) ?? tag; }
    catch (error) { if (error instanceof InvalidManifestError) throw error; }
    const order = compareVersions(tag, currentVersion);
    if (order === undefined) throw new Error('invalid version');
    return { state: order > 0 ? 'available' : 'up-to-date', currentVersion, latestVersion: tag.replace(/^v/, '') };
  } catch { return { state: 'error', currentVersion, message: UPDATE_ERROR }; }
}
