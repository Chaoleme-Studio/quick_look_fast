import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Finder owns both regular Finder windows and desktop icons. A dedicated shortcut
// invokes this only on request; other applications' Space key is never captured.
export const FINDER_SELECTION_SCRIPT = `
use framework "AppKit"
set activeBundle to bundleIdentifier() of frontmostApplication() of current application's NSWorkspace's sharedWorkspace()
if (activeBundle as text) is not "com.apple.finder" then return ""
tell application id "com.apple.finder"
  set selectedItems to selection
  if (count of selectedItems) is 0 then return ""
  return POSIX path of ((item 1 of selectedItems) as alias)
end tell
`;

export function parseFinderSelection(output: string): string | undefined {
  // osascript adds one newline; retain newlines that are actually in the filename.
  const selection = output.replace(/\n$/, '');
  return selection && path.isAbsolute(selection) ? selection : undefined;
}

export async function selectedFinderFile(): Promise<string | undefined> {
  const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', FINDER_SELECTION_SCRIPT], {
    timeout: 5000,
    maxBuffer: 65536,
    encoding: 'utf8',
  });
  return parseFinderSelection(stdout);
}

export type FinderSpaceBridgeStatus = 'active' | 'accessibility-required' | 'unavailable';
export type FinderNavigationKey = 'ArrowUp' | 'ArrowDown';

export function startFinderSpaceBridge(executable: string, callbacks: {
  onFile(filePath: string, sourceId: string): void;
  onSelection?(filePath: string, sourceId: string): void;
  onStatus(status: FinderSpaceBridgeStatus): void;
}, promptAccessibility = false, interceptSpace = true) {
  const args = [];
  if (promptAccessibility) args.push('--prompt-accessibility');
  if (!interceptSpace) args.push('--navigation-only');
  const bridge = spawn(executable, args, {
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const output = createInterface({ input: bridge.stdout, crlfDelay: Infinity });
  let stopped = false;
  let status: FinderSpaceBridgeStatus | undefined;

  function report(value: FinderSpaceBridgeStatus): void {
    if (stopped || status === value) return;
    status = value;
    callbacks.onStatus(value);
  }

  function send(command: { action: 'track' | 'navigate' | 'forget'; sourceId: string; filePath?: string; key?: FinderNavigationKey; followKeyboard?: boolean }): void {
    if (!stopped && status === 'active' && bridge.stdin.writable) bridge.stdin.write(`${JSON.stringify(command)}\n`);
  }

  output.on('line', (line) => {
    if (stopped || !line) return;
    let message: { file?: unknown; selection?: unknown; sourceId?: unknown; status?: unknown } | null;
    try { message = JSON.parse(line); } catch { return; }
    if (message?.status === 'active' || message?.status === 'accessibility-required' || message?.status === 'unavailable') {
      report(message.status);
    } else if (status === 'active' && typeof message?.sourceId === 'string' && message.sourceId.length > 0) {
      const file = message.file ?? message.selection;
      if (typeof file !== 'string' || !path.isAbsolute(file) || file.includes('\0')) return;
      if (typeof message.file === 'string') callbacks.onFile(file, message.sourceId);
      else callbacks.onSelection?.(file, message.sourceId);
    }
  });
  output.on('error', () => report('unavailable'));
  // Stdin is only a liveness pipe. Child startup and exit are reported separately.
  bridge.stdin.on('error', () => {});
  bridge.on('error', () => report('unavailable'));
  bridge.on('close', (code) => {
    if (code !== 0 || status !== 'accessibility-required') report('unavailable');
  });

  return {
    track(sourceId: string, filePath: string, followKeyboard?: boolean) { send({ action: 'track', sourceId, filePath, ...(followKeyboard === undefined ? {} : { followKeyboard }) }); },
    navigate(sourceId: string, key: FinderNavigationKey) { send({ action: 'navigate', sourceId, key }); },
    forget(sourceId: string) { send({ action: 'forget', sourceId }); },
    stop() {
      stopped = true;
      output.close();
      bridge.stdin.destroy();
      bridge.kill();
    },
  };
}
