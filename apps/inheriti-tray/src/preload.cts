import electron = require('electron');
const { contextBridge, ipcRenderer } = electron;
import type { TrayState } from './modules/launcher/main/state.js';
import type { CreateQuickPlanInput } from './modules/quick-plan/main/quick-plan-input.js' with { 'resolution-mode': 'import' };

contextBridge.exposeInMainWorld('inheritiTray', {
  state: (): Promise<TrayState> => ipcRenderer.invoke('tray:state'),
  signIn: (): Promise<TrayState> => ipcRenderer.invoke('tray:sign-in'),
  select: (id: string): Promise<TrayState> => ipcRenderer.invoke('tray:select', id),
  signOut: (): Promise<TrayState> => ipcRenderer.invoke('tray:sign-out'),
  createQuickPlan: (input: CreateQuickPlanInput): Promise<TrayState> => ipcRenderer.invoke('tray:create-quick-plan', input),
  abandonCreation: (): Promise<TrayState> => ipcRenderer.invoke('tray:abandon-creation'),
  cancelKeyRequest: (): Promise<TrayState> => ipcRenderer.invoke('tray:cancel-key-request'),
  editablePlans: (): Promise<TrayState> => ipcRenderer.invoke('tray:editable-plans'),
  addPlanAsset: (planId: string, asset: CreateQuickPlanInput['asset']): Promise<TrayState> => ipcRenderer.invoke('tray:add-plan-asset', planId, asset),
  listPlanAssets: (planId: string): Promise<TrayState> => ipcRenderer.invoke('tray:list-plan-assets', planId),
  getPlanAsset: (planId: string, assetId: string): Promise<unknown> => ipcRenderer.invoke('tray:get-plan-asset', planId, assetId),
  replacePlanAsset: (planId: string, assetId: string, asset: CreateQuickPlanInput['asset']): Promise<TrayState> => ipcRenderer.invoke('tray:replace-plan-asset', planId, assetId, asset),
  discardPlanEdit: (): Promise<TrayState> => ipcRenderer.invoke('tray:discard-plan-edit'),
  cancelPlanEdit: (): Promise<TrayState> => ipcRenderer.invoke('tray:cancel-plan-edit'),
  recoverPlanEdit: (): Promise<TrayState> => ipcRenderer.invoke('tray:recover-plan-edit'),
  openApp: (planId?: string): Promise<void> => ipcRenderer.invoke('tray:open-app', planId),
  onAction: (callback: (action: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, action: string) => callback(action);
    ipcRenderer.on('tray:action', listener);
    return () => ipcRenderer.removeListener('tray:action', listener);
  },
  onStateChanged: (callback: (state: TrayState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: TrayState) => callback(state);
    ipcRenderer.on('tray:state-changed', listener);
    return () => ipcRenderer.removeListener('tray:state-changed', listener);
  },
  onHidden: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on('tray:hidden', listener);
    return () => ipcRenderer.removeListener('tray:hidden', listener);
  },
});
