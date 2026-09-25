import { ipcMain, shell } from 'electron';
import type { BrowserWindow } from 'electron';
import type { TraySession } from './state.js';
import { trayMessages as messages } from '../../../messages.js';
import { parseQuickPlanInput } from '../../quick-plan/main/quick-plan-input.js';

export function registerTrayIpc(session: TraySession, currentWindow: () => BrowserWindow | undefined, publish: () => void, appUrl?: string, notify?: (body: string) => void): void {
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
    return session.state();
  });
  ipcMain.handle('tray:sign-out', async (event) => { trusted(event); await session.signOut(); publish(); return session.state(); });
  ipcMain.handle('tray:create-quick-plan', async (event, input: unknown) => {
    trusted(event);
    await session.createQuickPlan(parseQuickPlanInput(input), publish);
    const state = session.state();
    if (state.creation?.status === 'ready') notify?.(messages.planProtectedNotification);
    return state;
  });
  ipcMain.handle('tray:abandon-creation', (event) => {
    trusted(event);
    session.abandonCreation();
    publish();
    return session.state();
  });
  ipcMain.handle('tray:cancel-key-request', (event) => {
    trusted(event);
    session.cancelKeyRequest();
    return session.state();
  });
  ipcMain.handle('tray:editable-plans', async (event) => {
    trusted(event);
    await session.loadEditablePlans(publish);
    return session.state();
  });
  ipcMain.handle('tray:add-plan-asset', async (event, planId: unknown, input: unknown) => {
    trusted(event);
    if (typeof planId !== 'string' || !planId || planId.length > 200) throw new Error('Invalid plan');
    const asset = parseQuickPlanInput({ title: 'Added asset', asset: input }).asset;
    await session.addPlanAsset(planId, asset, publish);
    const state = session.state();
    if (state.edit.status === 'updated') notify?.(messages.planUpdatedNotification);
    return state;
  });
  ipcMain.handle('tray:list-plan-assets', async (event, planId: unknown) => {
    trusted(event);
    if (typeof planId !== 'string' || !planId || planId.length > 200) throw new Error('Invalid plan');
    await session.listPlanAssets(planId, publish);
    return session.state();
  });
  ipcMain.handle('tray:get-plan-asset', async (event, planId: unknown, assetId: unknown) => {
    trusted(event);
    if (typeof planId !== 'string' || !planId || planId.length > 200 || typeof assetId !== 'string' || !assetId || assetId.length > 200) throw new Error(messages.invalidAsset);
    return session.getPlanAsset(planId, assetId);
  });
  ipcMain.handle('tray:replace-plan-asset', async (event, planId: unknown, assetId: unknown, input: unknown) => {
    trusted(event);
    if (typeof planId !== 'string' || !planId || planId.length > 200 || typeof assetId !== 'string' || !assetId || assetId.length > 200) throw new Error(messages.invalidAsset);
    const asset = parseQuickPlanInput({ title: 'Edited asset', asset: input }).asset;
    await session.replacePlanAsset(planId, assetId, asset, publish);
    const state = session.state();
    if (state.edit.status === 'updated') notify?.(messages.planUpdatedNotification);
    return state;
  });
  ipcMain.handle('tray:discard-plan-edit', async (event) => {
    trusted(event);
    await session.discardPlanEdit();
    publish();
    return session.state();
  });
  ipcMain.handle('tray:cancel-plan-edit', async (event) => {
    trusted(event);
    await session.cancelPlanEdit();
    publish();
    return session.state();
  });
  ipcMain.handle('tray:recover-plan-edit', async (event) => {
    trusted(event);
    await session.recoverPlanEdit(publish);
    const state = session.state();
    if (state.edit.status === 'updated') notify?.(messages.planUpdatedNotification);
    return state;
  });
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
}
