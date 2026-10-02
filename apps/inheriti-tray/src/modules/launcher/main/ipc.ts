import { ipcMain, shell } from 'electron';
import type { BrowserWindow } from 'electron';
import type { TraySession } from './state.js';
import { trayMessages as messages } from '../../../messages.js';
import { registerQuickPlanIpc } from '../../quick-plan/main/ipc.js';
import { registerInboxIpc } from '../../inbox/main/ipc.js';

export function registerTrayIpc(session: TraySession, currentWindow: () => BrowserWindow | undefined, publish: () => void, appUrl?: string, notify?: (body: string) => void, publishInbox?: () => void): void {
  const trusted = (event: Electron.IpcMainInvokeEvent) => {
    const window = currentWindow();
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error(messages.untrustedRenderer);
  };
  ipcMain.handle('tray:state', (event) => { trusted(event); return session.state(); });
  ipcMain.handle('tray:select-custodian-device', (event, value: unknown) => {
    trusted(event);
    session.selectCustodianDevice(value);
    return session.state();
  });
  ipcMain.handle('tray:submit-safekey-pro-pin', (event, value: unknown) => {
    trusted(event);
    session.submitSafeKeyProPin(value);
    return session.state();
  });
  ipcMain.handle('tray:sign-in', (event) => { trusted(event); void session.signIn(publish, (url) => shell.openExternal(url)); return session.state(); });
  ipcMain.handle('tray:select', async (event, id: unknown) => {
    trusted(event);
    if (typeof id !== 'string') throw new Error(messages.invalidOrganization);
    await session.select(id);
    publish();
    publishInbox?.();
    return session.state();
  });
  ipcMain.handle('tray:sign-out', async (event) => { trusted(event); await session.signOut(); publish(); publishInbox?.(); return session.state(); });
  registerInboxIpc(session, trusted, publishInbox);
  registerQuickPlanIpc(session, trusted, publish, notify);
  ipcMain.handle('tray:open-app', (event, planId?: unknown) => {
    trusted(event);
    if (!appUrl) throw new Error(messages.appUrlNotConfigured);
    if (planId === undefined) return shell.openExternal(appUrl);
    const state = session.state();
    const created = state.creation?.status === 'ready' && state.creation.planId === planId;
    const edited = state.edit?.status === 'updated' && state.edit.planId === planId;
    if (typeof planId !== 'string' || (!created && !edited)) throw new Error(messages.invalidPlan);
    return shell.openExternal(new URL(`/organization/plans/backup/${encodeURIComponent(planId)}`, appUrl).toString());
  });
  ipcMain.handle('tray:open-safekey-desktop-tool', (event) => {
    trusted(event);
    return shell.openExternal('https://safekey.be/tools/safekey-desktop/');
  });
}
