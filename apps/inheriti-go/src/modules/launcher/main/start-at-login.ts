import { app } from 'electron';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const backgroundFlag = '--inheriti-go-background';

export function isBackgroundLaunch(argv = process.argv): boolean {
  return process.platform === 'darwin' && argv === process.argv
    ? app.getLoginItemSettings().wasOpenedAtLogin
    : argv.includes(backgroundFlag);
}

export function ensureStartAtLogin(deployment: string): void {
  if (!app.isPackaged) return;
  if (process.platform === 'linux') {
    const appImage = process.env.APPIMAGE;
    if (!appImage?.startsWith('/') || /[\r\n]/u.test(appImage) || !existsSync(appImage) || !process.env.HOME) return;
    const directory = join(process.env.XDG_CONFIG_HOME || join(process.env.HOME, '.config'), 'autostart');
    mkdirSync(directory, { recursive: true });
    if (!/^[a-z0-9-]+$/u.test(deployment)) return;
    writeFileSync(join(directory, `inheriti-go-${deployment}.desktop`),
      `[Desktop Entry]\nType=Application\nName=${app.getName()}\nExec="${appImage.replace(/[\\"$`]/gu, '\\$&').replace(/%/gu, '%%')}" ${backgroundFlag}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`,
      { mode: 0o600 });
    return;
  }
  if (process.platform === 'darwin' || process.platform === 'win32') {
    app.setLoginItemSettings({ openAtLogin: true, args: [backgroundFlag] });
  }
}
