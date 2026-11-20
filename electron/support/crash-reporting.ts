import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { App, CrashReporter } from 'electron';

/** Native dumps can contain document data, so collecting them is opt-in. */
export function enableLocalCrashReports(app: Pick<App, 'getPath' | 'setPath'>,
  reporter: Pick<CrashReporter, 'start'>, args: readonly string[]): boolean {
  if (!args.includes('--diagnostics')) return false;
  const directory = path.join(app.getPath('userData'), 'crash-dumps');
  mkdirSync(directory, { recursive: true });
  app.setPath('crashDumps', directory);
  reporter.start({ uploadToServer: false, productName: 'QuickLook Fast' });
  return true;
}
