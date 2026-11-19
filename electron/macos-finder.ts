import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Finder owns both regular Finder windows and desktop icons. A dedicated shortcut
// invokes this only on request; other applications' Space key is never captured.
export const FINDER_SELECTION_SCRIPT = `
tell application "System Events"
  set activeBundle to bundle identifier of first application process whose frontmost is true
end tell
if activeBundle is not "com.apple.finder" then return ""
tell application "Finder"
  set selectedItems to selection
  if (count of selectedItems) is 0 then return ""
  return POSIX path of ((item 1 of selectedItems) as alias)
end tell
`;

export function parseFinderSelection(output: string): string | undefined {
  // osascript adds one newline; retain newlines that are actually in the filename.
  const selection = output.replace(/\r?\n$/, '');
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
