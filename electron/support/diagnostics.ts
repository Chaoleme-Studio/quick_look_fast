import { appendFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** A bounded local log with process status only; never include file paths or contents. */
export function recordDiagnostic(userData: string, event: string, details: { reason?: string; exitCode?: number; processType?: string } = {}): void {
  try {
    const clean = (value: string | undefined): string | undefined => value && /^[\w -]{1,80}$/.test(value) ? value : undefined;
    const record = { time: new Date().toISOString(), event: clean(event) || 'unknown', reason: clean(details.reason),
      processType: clean(details.processType), exitCode: Number.isSafeInteger(details.exitCode) ? details.exitCode : undefined };
    const directory = path.join(userData, 'logs'); mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'diagnostics.log');
    const line = `${JSON.stringify(record)}\n`;
    let size = 0; try { size = statSync(file).size; } catch { /* first record */ }
    if (size > 256 * 1024) writeFileSync(file, line, 'utf8');
    else appendFileSync(file, line, 'utf8');
  } catch { /* Diagnostics must never interrupt preview. */ }
}
