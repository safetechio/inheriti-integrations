import { app, ipcMain, shell } from 'electron';
import type { BrowserWindow } from 'electron';
import type { TraySession } from './state.js';
import { trayMessages as messages } from '../../../messages.js';
import { registerQuickPlanIpc } from '../../quick-plan/main/ipc.js';
import { registerInboxIpc } from '../../inbox/main/ipc.js';
import type { GoUpdateProgress } from './update.js';

export function registerTrayIpc(session: TraySession, currentWindow: () => BrowserWindow | undefined, publish: () => void, appUrl?: string, notify?: (body: string) => void, publishInbox?: () => void, refreshBadge?: () => void, updateProgress?: () => GoUpdateProgress): void {
  const trusted = (event: Electron.IpcMainInvokeEvent) => {
    const window = currentWindow();
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error(messages.untrustedRenderer);
  };
  ipcMain.handle('tray:state', (event) => { trusted(event); return session.state(); });
  ipcMain.handle('tray:version', (event) => { trusted(event); return app.getVersion(); });
  ipcMain.handle('tray:update-progress', (event) => { trusted(event); return updateProgress?.() ?? null; });
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
  ipcMain.handle('tray:add-account', async (event) => {
    trusted(event);
    const addition = session.addAccount(publish, (url) => shell.openExternal(url));
    publish();
    try { await addition; }
    finally { publish(); publishInbox?.(); }
    return session.state();
  });
  ipcMain.handle('tray:cancel-account-authorization', async (event) => {
    trusted(event);
    await session.cancelAccountAuthorization();
    publish();
    return session.state();
  });
  ipcMain.handle('tray:activate-account', async (event, subject: unknown) => {
    trusted(event);
    if (typeof subject !== 'string' || !subject || subject.length > 500) throw new Error('invalid_account');
    const activation = session.activateAccount(subject);
    publish();
    try { await activation; }
    finally { publish(); publishInbox?.(); }
    return session.state();
  });
  ipcMain.handle('tray:restore', (event) => {
    trusted(event);
    if (session.state().status !== 'session-unavailable') return session.state();
    void session.restore().then(publish, publish);
    publish();
    return session.state();
  });
  ipcMain.handle('tray:select', async (event, id: unknown) => {
    trusted(event);
    if (typeof id !== 'string') throw new Error(messages.invalidOrganization);
    await session.select(id);
    publish();
    publishInbox?.();
    return session.state();
  });
  ipcMain.handle('tray:sign-out', async (event) => { trusted(event); await session.signOut(); publish(); publishInbox?.(); return session.state(); });
  registerInboxIpc(session, trusted, publishInbox, publish, refreshBadge);
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
