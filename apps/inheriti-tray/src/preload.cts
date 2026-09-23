import electron = require('electron');
const { contextBridge, ipcRenderer } = electron;
import type { TrayState } from './state.js' with { 'resolution-mode': 'import' };

contextBridge.exposeInMainWorld('inheritiTray', {
  state: (): Promise<TrayState> => ipcRenderer.invoke('tray:state'),
  signIn: (): Promise<TrayState> => ipcRenderer.invoke('tray:sign-in'),
  select: (id: string): Promise<TrayState> => ipcRenderer.invoke('tray:select', id),
  signOut: (): Promise<TrayState> => ipcRenderer.invoke('tray:sign-out'),
  openBusiness: (): Promise<void> => ipcRenderer.invoke('tray:open-business'),
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
});
