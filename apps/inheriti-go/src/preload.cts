import electron = require('electron');
const { contextBridge, ipcRenderer } = electron;
import type { TrayState } from './modules/launcher/main/state.js';
import type { InboxIdentityState } from './modules/inbox/main/identity.js';
import type { TrayInboxSignal } from './modules/inbox/main/inbox.js';
import type { TrayAction } from './modules/launcher/main/launcher-window.js';
import type { CreateQuickPlanInput } from './modules/quick-plan/main/quick-plan-input.js' with { 'resolution-mode': 'import' };

const pendingActions: TrayAction[] = [];
const actionListeners = new Set<(action: TrayAction) => void>();
let actionFlushScheduled = false;
function flushPendingActions(): void {
  if (actionFlushScheduled || !pendingActions.length) return;
  actionFlushScheduled = true;
  queueMicrotask(() => {
    actionFlushScheduled = false;
    if (!actionListeners.size) return;
    for (const action of pendingActions.splice(0)) actionListeners.forEach((listener) => listener(action));
  });
}
ipcRenderer.on('tray:action', (_event, action: TrayAction) => {
  if (actionListeners.size) actionListeners.forEach((listener) => listener(action));
  else { pendingActions.push(action); flushPendingActions(); }
});

contextBridge.exposeInMainWorld('inheritiTray', {
  state: (): Promise<TrayState> => ipcRenderer.invoke('tray:state'),
  version: (): Promise<string> => ipcRenderer.invoke('tray:version'),
  inboxState: (): Promise<InboxIdentityState> => ipcRenderer.invoke('tray:inbox-state'),
  selectCustodianDevice: (value: 'SK_MOBILE' | 'SK_PRO'): Promise<TrayState> => ipcRenderer.invoke('tray:select-custodian-device', value),
  submitSafeKeyProPin: (value: string): Promise<TrayState> => ipcRenderer.invoke('tray:submit-safekey-pro-pin', value),
  signIn: (): Promise<TrayState> => ipcRenderer.invoke('tray:sign-in'),
  select: (id: string): Promise<TrayState> => ipcRenderer.invoke('tray:select', id),
  signOut: (): Promise<TrayState> => ipcRenderer.invoke('tray:sign-out'),
  inboxPrepare: (): Promise<InboxIdentityState> => ipcRenderer.invoke('tray:inbox-prepare'),
  inboxNormalPreparation: (conversationId: string): Promise<unknown> => ipcRenderer.invoke('tray:inbox-normal-preparation', conversationId),
  inboxNormalMessages: (conversationId: string): Promise<unknown> => ipcRenderer.invoke('tray:inbox-normal-messages', conversationId),
  inboxSendNormal: (conversationId: string, parentId: string, content: string): Promise<unknown> =>
    ipcRenderer.invoke('tray:inbox-send-normal', conversationId, parentId, content),
  inboxReplaceDevice: (): Promise<InboxIdentityState> => ipcRenderer.invoke('tray:inbox-replace-device'),
  inboxCancelPreparation: (): Promise<void> => ipcRenderer.invoke('tray:inbox-cancel-preparation'),
  inboxParticipants: (query?: string): Promise<unknown> => ipcRenderer.invoke('tray:inbox-participants', query),
  inboxMembers: (query?: string, offset?: number): Promise<unknown> => ipcRenderer.invoke('tray:inbox-members', query, offset),
  inboxCreateConversation: (title: string, memberIds: string[]): Promise<unknown> => ipcRenderer.invoke('tray:inbox-create-conversation', title, memberIds),
  inboxChangeParticipants: (conversationId: string, action: 'ADD' | 'REMOVE', memberId: string, expectedRevision: number): Promise<unknown> =>
    ipcRenderer.invoke('tray:inbox-change-participants', conversationId, action, memberId, expectedRevision),
  inboxConversations: (): Promise<unknown> => ipcRenderer.invoke('tray:inbox-conversations'),
  inboxClearHistory: (conversationId: string): Promise<{ clearedThroughSequence: number }> =>
    ipcRenderer.invoke('tray:inbox-clear-history', conversationId),
  inboxMessages: (conversationId: string): Promise<unknown> => ipcRenderer.invoke('tray:inbox-messages', conversationId),
  inboxParents: (conversationId: string): Promise<unknown> => ipcRenderer.invoke('tray:inbox-parents', conversationId),
  inboxSendParent: (conversationId: string, parentId: string, segments: Array<{ text: string } | { protectedText: string; expiresAt: string }>): Promise<unknown> =>
    ipcRenderer.invoke('tray:inbox-send-parent', conversationId, parentId, segments),
  inboxRevealUnit: (conversationId: string, parentId: string, unitId: string): Promise<{ text: string; acknowledgement: 'ACKNOWLEDGED' | 'PENDING'; suggestion: unknown }> =>
    ipcRenderer.invoke('tray:inbox-reveal-unit', conversationId, parentId, unitId),
  inboxSendText: (conversationId: string, text: string, expiresAt: string): Promise<unknown> => ipcRenderer.invoke('tray:inbox-send-text', conversationId, text, expiresAt),
  inboxSendFile: (conversationId: string, expiresAt: string): Promise<unknown> => ipcRenderer.invoke('tray:inbox-send-file', conversationId, expiresAt),
  inboxOpenText: (conversationId: string, messageId: string): Promise<{ text: string; leaseId: string; leaseExpiresAt: string; acknowledgement: 'ACKNOWLEDGED' | 'PENDING'; suggestion: unknown }> => ipcRenderer.invoke('tray:inbox-open-text', conversationId, messageId),
  inboxOpenFile: (conversationId: string, messageId: string): Promise<unknown> => ipcRenderer.invoke('tray:inbox-open-file', conversationId, messageId),
  inboxOpenFileForPlan: (conversationId: string, messageId: string): Promise<{ acknowledgement: 'ACKNOWLEDGED' | 'PENDING' }> => ipcRenderer.invoke('tray:inbox-open-file-for-plan', conversationId, messageId),
  inboxAcceptFileForPlan: (conversationId: string, messageId: string): Promise<void> => ipcRenderer.invoke('tray:inbox-accept-file-for-plan', conversationId, messageId),
  onInboxFileForPlan: (callback: (file: { conversationId: string; messageId: string; name: string; mimeType: string; bytes: Uint8Array }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, file: { conversationId: string; messageId: string; name: string; mimeType: string; bytes: Uint8Array }) => callback(file);
    ipcRenderer.on('tray:inbox-file-for-plan', listener);
    return () => ipcRenderer.removeListener('tray:inbox-file-for-plan', listener);
  },
  inboxCancelTransfer: (): Promise<void> => ipcRenderer.invoke('tray:inbox-cancel-transfer'),
  inboxRetryAck: (conversationId: string, messageId: string): Promise<{ acknowledgement: 'ACKNOWLEDGED' | 'PENDING' }> => ipcRenderer.invoke('tray:inbox-retry-ack', conversationId, messageId),
  inboxHideText: (): Promise<void> => ipcRenderer.invoke('tray:inbox-hide-text'),
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
  openSafeKeyDesktopTool: (): Promise<void> => ipcRenderer.invoke('tray:open-safekey-desktop-tool'),
  onAction: (callback: (action: TrayAction) => void): (() => void) => {
    actionListeners.add(callback);
    flushPendingActions();
    return () => actionListeners.delete(callback);
  },
  onStateChanged: (callback: (state: TrayState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: TrayState) => callback(state);
    ipcRenderer.on('tray:state-changed', listener);
    return () => ipcRenderer.removeListener('tray:state-changed', listener);
  },
  onInboxStateChanged: (callback: (state: InboxIdentityState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: InboxIdentityState) => callback(state);
    ipcRenderer.on('tray:inbox-state-changed', listener);
    return () => ipcRenderer.removeListener('tray:inbox-state-changed', listener);
  },
  onInboxChanged: (callback: (signal: TrayInboxSignal | null) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, signal: TrayInboxSignal | null) => callback(signal);
    ipcRenderer.on('tray:inbox-changed', listener);
    return () => ipcRenderer.removeListener('tray:inbox-changed', listener);
  },
  onInboxTransferProgress: (callback: (progress: { completed: number; total: number; stage?: string }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: { completed: number; total: number; stage?: string }) => callback(progress);
    ipcRenderer.on('tray:inbox-transfer-progress', listener);
    return () => ipcRenderer.removeListener('tray:inbox-transfer-progress', listener);
  },
  onInboxParentSendProgress: (callback: (progress: { parentId: string; completed: number; total: number }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: { parentId: string; completed: number; total: number }) => callback(progress);
    ipcRenderer.on('tray:inbox-parent-send-progress', listener);
    return () => ipcRenderer.removeListener('tray:inbox-parent-send-progress', listener);
  },
  onHidden: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on('tray:hidden', listener);
    return () => ipcRenderer.removeListener('tray:hidden', listener);
  },
});
