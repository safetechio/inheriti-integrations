import { ipcMain } from 'electron';
import type { TraySession } from '../../launcher/main/state.js';
import { trayMessages as messages } from '../../../messages.js';
import { parseQuickPlanInput } from './quick-plan-input.js';

export function registerQuickPlanIpc(session: TraySession, trusted: (event: Electron.IpcMainInvokeEvent) => void, publish: () => void, notify?: (body: string) => void): void {
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
}
