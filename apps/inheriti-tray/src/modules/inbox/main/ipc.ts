import { ipcMain } from 'electron';
import type { TraySession } from '../../launcher/main/state.js';

export function registerInboxIpc(session: TraySession, trusted: (event: Electron.IpcMainInvokeEvent) => void, publishInbox?: () => void): void {
  ipcMain.handle('tray:inbox-state', (event) => { trusted(event); return session.inboxState(); });
  ipcMain.handle('tray:inbox-prepare', async (event) => {
    trusted(event);
    const pending = session.prepareInbox();
    publishInbox?.();
    const result = await pending;
    publishInbox?.();
    return result;
  });
  const inboxId = (value: unknown) => {
    if (typeof value !== 'string' || !value || value.length > 200) throw new Error('Invalid Secure Inbox identifier');
    return value;
  };
  ipcMain.handle('tray:inbox-participants', (event, query: unknown) => {
    trusted(event);
    if (query !== undefined && (typeof query !== 'string' || query.length > 100)) throw new Error('Invalid Secure Inbox search');
    return session.listInboxParticipants(query ? { q: query } : undefined);
  });
  ipcMain.handle('tray:inbox-create-conversation', (event, memberId: unknown) => {
    trusted(event);
    return session.createInboxConversation([inboxId(memberId)]);
  });
  ipcMain.handle('tray:inbox-conversations', (event) => { trusted(event); return session.listInboxConversations(); });
  ipcMain.handle('tray:inbox-messages', (event, conversationId: unknown) => {
    trusted(event);
    return session.listInboxMessages(inboxId(conversationId));
  });
  ipcMain.handle('tray:inbox-send-text', (event, conversationId: unknown, content: unknown, expiresAt: unknown) => {
    trusted(event);
    if (typeof content !== 'string' || !content.trim() || content.length > 10000 || typeof expiresAt !== 'string' || !Number.isFinite(Date.parse(expiresAt))) throw new Error('Invalid Secure Inbox message');
    return session.sendInboxText(inboxId(conversationId), content, expiresAt);
  });
  ipcMain.handle('tray:inbox-open-text', (event, conversationId: unknown, messageId: unknown) => {
    trusted(event);
    return session.openInboxText(inboxId(conversationId), inboxId(messageId));
  });
  ipcMain.handle('tray:inbox-retry-ack', (event, conversationId: unknown, messageId: unknown) => {
    trusted(event);
    return session.retryInboxAck(inboxId(conversationId), inboxId(messageId));
  });
  ipcMain.handle('tray:inbox-hide-text', (event) => { trusted(event); session.hideInboxText(); });
}
