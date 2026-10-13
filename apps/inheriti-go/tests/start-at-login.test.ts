import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({ packaged: false, openedAtLogin: false, setLoginItemSettings: vi.fn() }));
vi.mock('electron', () => ({ app: { get isPackaged() { return electron.packaged; }, getName: () => 'Inheriti Go DEV',
  getLoginItemSettings: () => ({ wasOpenedAtLogin: electron.openedAtLogin }), setLoginItemSettings: electron.setLoginItemSettings } }));

import { ensureStartAtLogin, isBackgroundLaunch } from '../src/modules/launcher/main/start-at-login.js';

const prior = { config: process.env.XDG_CONFIG_HOME, data: process.env.XDG_DATA_HOME, appImage: process.env.APPIMAGE };
let directory: string | undefined;
afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
  process.env.XDG_CONFIG_HOME = prior.config;
  process.env.XDG_DATA_HOME = prior.data;
  process.env.APPIMAGE = prior.appImage;
  electron.packaged = false;
  electron.openedAtLogin = false;
  electron.setLoginItemSettings.mockClear();
});

it('registers packaged AppImages for background login, never the development executable', () => {
  directory = mkdtempSync(join(tmpdir(), 'go-autostart-'));
  process.env.XDG_CONFIG_HOME = directory;
  process.env.XDG_DATA_HOME = join(directory, 'data');
  process.env.APPIMAGE = join(directory, 'Inheriti Go DEV.AppImage');
  writeFileSync(process.env.APPIMAGE, 'test installer');
  ensureStartAtLogin('dev');
  expect(readdirSync(process.env.XDG_CONFIG_HOME)).toEqual(['Inheriti Go DEV.AppImage']);
  electron.packaged = true;
  ensureStartAtLogin('local');
  expect(readdirSync(join(process.env.XDG_CONFIG_HOME, 'autostart'))).toContain('inheriti-go-local.desktop');
  const icon = join(directory, 'icon.png');
  writeFileSync(icon, 'icon');
  ensureStartAtLogin('dev', icon);
  const autostart = join(process.env.XDG_CONFIG_HOME, 'autostart');
  const desktop = readFileSync(join(autostart, 'inheriti-go-dev.desktop'), 'utf8');
  expect(desktop).toContain(`Exec="${process.env.APPIMAGE}" --ozone-platform=x11 --inheriti-go-background`);
  expect(desktop).not.toContain(process.execPath);
  expect(desktop).toContain('StartupWMClass=Inheriti Go DEV');
  expect(desktop).toContain(`Icon=${join(directory, 'data', 'icons', 'hicolor', '256x256', 'apps', 'inheriti-go-dev.png')}`);
  const launcher = readFileSync(join(directory, 'data', 'applications', 'inheriti-go-dev.desktop'), 'utf8');
  expect(launcher).toContain(`Exec="${process.env.APPIMAGE}" --ozone-platform=x11`);
  expect(readFileSync(join(directory, 'data', 'icons', 'hicolor', '256x256', 'apps', 'inheriti-go-dev.png'), 'utf8')).toBe('icon');
  expect(isBackgroundLaunch(['app', '--inheriti-go-background'])).toBe(true);
  expect(isBackgroundLaunch(['app'])).toBe(false);
});

it('does not leave an autostart entry for a missing AppImage', () => {
  directory = mkdtempSync(join(tmpdir(), 'go-autostart-'));
  process.env.XDG_CONFIG_HOME = directory;
  process.env.XDG_DATA_HOME = join(directory, 'data');
  process.env.APPIMAGE = join(directory, 'missing.AppImage');
  electron.packaged = true;
  ensureStartAtLogin('dev');
  expect(readdirSync(directory)).toEqual([]);
});
