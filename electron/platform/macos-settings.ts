import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type FinderMode = 'system' | 'shortcut' | 'space';
export interface MacSettings {
  showDock: boolean;
  showMenuBar: boolean;
  finderMode: FinderMode;
  finderNavigation: boolean;
}

export const defaultMacSettings: MacSettings = { showDock: false, showMenuBar: true, finderMode: 'space', finderNavigation: true };

export function isFinderMode(value: unknown): value is FinderMode {
  return value === 'system' || value === 'shortcut' || value === 'space';
}

export function readMacSettings(directory: string): MacSettings | undefined {
  try {
    const value = JSON.parse(readFileSync(path.join(directory, 'mac-settings.json'), 'utf8')) as Partial<MacSettings> | null;
    return {
      showDock: typeof value?.showDock === 'boolean' ? value.showDock : defaultMacSettings.showDock,
      showMenuBar: typeof value?.showMenuBar === 'boolean' ? value.showMenuBar : defaultMacSettings.showMenuBar,
      finderMode: isFinderMode(value?.finderMode) ? value.finderMode : defaultMacSettings.finderMode,
      finderNavigation: typeof value?.finderNavigation === 'boolean' ? value.finderNavigation : defaultMacSettings.finderNavigation,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    console.error('无法读取 macOS 设置', error);
    return { ...defaultMacSettings };
  }
}

export function writeMacSettings(directory: string, value: MacSettings): void {
  mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, 'mac-settings.json');
  const temporary = `${filename}.tmp`;
  writeFileSync(temporary, JSON.stringify(value) + '\n', { mode: 0o600 });
  renameSync(temporary, filename);
}
