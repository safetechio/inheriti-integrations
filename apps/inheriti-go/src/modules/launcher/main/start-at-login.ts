import { app } from 'electron';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const backgroundFlag = '--inheriti-go-background';

export function isBackgroundLaunch(argv = process.argv): boolean {
  return process.platform === 'darwin' && argv === process.argv
    ? app.getLoginItemSettings().wasOpenedAtLogin
    : argv.includes(backgroundFlag);
}

export function ensureStartAtLogin(deployment: string, iconSource?: string): void {
  if (!app.isPackaged) return;
  if (process.platform === 'linux') {
    const appImage = process.env.APPIMAGE;
    if (!appImage?.startsWith('/') || /[\r\n]/u.test(appImage) || !existsSync(appImage) || !process.env.HOME) return;
    if (!/^[a-z0-9-]+$/u.test(deployment)) return;
    const directory = join(process.env.XDG_CONFIG_HOME || join(process.env.HOME, '.config'), 'autostart');
    mkdirSync(directory, { recursive: true });
    const desktopName = `inheriti-go-${deployment}`;
    const data = process.env.XDG_DATA_HOME || join(process.env.HOME, '.local', 'share');
    const applications = join(data, 'applications');
    const icons = join(data, 'icons', 'hicolor', '256x256', 'apps');
    mkdirSync(applications, { recursive: true });
    mkdirSync(icons, { recursive: true });
    if (iconSource) copyFileSync(iconSource, join(icons, `${desktopName}.png`));
    const icon = iconSource ? `Icon=${join(icons, `${desktopName}.png`)}\n` : '';
    const executable = appImage.replace(/[\\"$`]/gu, '\\$&').replace(/%/gu, '%%');
    const localOverrides = deployment === 'local' && process.env.INHERITI_API_URL && process.env.INHERITI_OIDC_ISSUER
      ? ['INHERITI_API_URL', 'INHERITI_OIDC_ISSUER', 'INHERITI_APP_URL']
        .filter((name) => process.env[name])
        .map((name) => {
          const value = process.env[name]!;
          if (/[\r\n]/u.test(value)) throw new Error(`Invalid ${name} for desktop launcher`);
          return `"${name}=${value.replace(/[\\"$`]/gu, '\\$&').replace(/%/gu, '%%')}"`;
        })
      : [];
    const command = `${localOverrides.length ? `env ${localOverrides.join(' ')} ` : ''}"${executable}"`;
    const x11 = '--ozone-platform=x11';
    writeFileSync(join(applications, `${desktopName}.desktop`),
      `[Desktop Entry]\nType=Application\nName=${app.getName()}\nExec=${command} ${x11}\n${icon}StartupWMClass=${desktopName}\nTerminal=false\n`,
      { mode: 0o600 });
    writeFileSync(join(directory, `inheriti-go-${deployment}.desktop`),
      `[Desktop Entry]\nType=Application\nName=${app.getName()}\nExec=${command} ${x11} ${backgroundFlag}\n${icon}StartupWMClass=${desktopName}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`,
      { mode: 0o600 });
    return;
  }
  if (process.platform === 'darwin' || process.platform === 'win32') {
    app.setLoginItemSettings({ openAtLogin: true, args: [backgroundFlag] });
  }
}
