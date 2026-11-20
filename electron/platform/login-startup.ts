import type { App } from 'electron';

export interface StartupState { supported: boolean; enabled: boolean; message?: string }

function options(platform: NodeJS.Platform, executable: string): Electron.LoginItemSettingsOptions {
  return platform === 'win32' ? { path: executable, args: ['--service'] } : {};
}

export function readStartup(app: App, platform: NodeJS.Platform, executable: string, development: boolean): StartupState {
  if (platform !== 'win32' && platform !== 'darwin') return { supported: false, enabled: false, message: '此系统暂不支持在此处设置开机自启。' };
  if (development) return { supported: false, enabled: false, message: '请在打包后的应用中设置开机自启。' };
  try {
    const settings = app.getLoginItemSettings(options(platform, executable));
    const pending = platform === 'darwin' && settings.status === 'requires-approval';
    return { supported: true, enabled: settings.openAtLogin, message: pending ? '请在 macOS 登录项设置中允许 QuickLook Fast。' : undefined };
  } catch {
    return { supported: false, enabled: false, message: '无法读取系统的开机自启设置。' };
  }
}

export function writeStartup(app: App, platform: NodeJS.Platform, executable: string, development: boolean, enabled: boolean): StartupState {
  const before = readStartup(app, platform, executable, development);
  if (!before.supported) return before;
  try {
    app.setLoginItemSettings({ ...options(platform, executable), name: 'QuickLook Fast', openAtLogin: enabled });
    const after = readStartup(app, platform, executable, development);
    if (after.enabled !== enabled && !after.message) after.message = '系统尚未确认此设置，请检查系统登录项。';
    return after;
  } catch {
    return { ...before, message: '未能更改开机自启，请检查系统权限。' };
  }
}
