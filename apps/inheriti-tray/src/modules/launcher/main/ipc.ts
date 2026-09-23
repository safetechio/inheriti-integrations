import { ipcMain, shell } from 'electron';
import type { BrowserWindow } from 'electron';
import type { TraySession } from './state.js';
import { trayMessages as messages } from '../../../messages.js';
import { parseQuickPlanInput } from '../../quick-plan/main/quick-plan-input.js';

export function registerTrayIpc(session: TraySession, currentWindow: () => BrowserWindow | undefined, publish: () => void, appUrl?: string): void {
  const trusted = (event: Electron.IpcMainInvokeEvent) => {
    const window = currentWindow();
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error(messages.untrustedRenderer);
  };
  ipcMain.handle('tray:state', (event) => { trusted(event); return session.state(); });
  ipcMain.handle('tray:sign-in', (event) => { trusted(event); void session.signIn(publish, (url) => shell.openExternal(url)); return session.state(); });
  ipcMain.handle('tray:select', async (event, id: unknown) => {
    trusted(event);
    if (typeof id !== 'string') throw new Error(messages.invalidOrganization);
    await session.select(id);
    publish();
    return session.state();
  });
  ipcMain.handle('tray:sign-out', async (event) => { trusted(event); await session.signOut(); publish(); return session.state(); });
  ipcMain.handle('tray:create-quick-plan', async (event, input: unknown) => {
    trusted(event);
    await session.createQuickPlan(parseQuickPlanInput(input), publish);
    return session.state();
  });
  ipcMain.handle('tray:abandon-creation', (event) => {
    trusted(event);
    session.abandonCreation();
    publish();
    return session.state();
  });
  ipcMain.handle('tray:open-app', (event) => {
    trusted(event);
    if (!appUrl) throw new Error(messages.appUrlNotConfigured);
    return shell.openExternal(appUrl);
  });
}
