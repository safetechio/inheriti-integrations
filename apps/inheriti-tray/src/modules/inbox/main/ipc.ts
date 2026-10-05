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
  ipcMain.handle('tray:inbox-replace-device', async (event) => {
    trusted(event);
    const pending = session.replaceInboxDevice();
    publishInbox?.();
    const result = await pending;
    publishInbox?.();
    return result;
  });
  ipcMain.handle('tray:inbox-cancel-preparation', (event) => { trusted(event); session.cancelInboxPreparation(); publishInbox?.(); });
  const inboxId = (value: unknown) => {
    if (typeof value !== 'string' || !value || value.length > 200) throw new Error('Invalid Secure Chat identifier');
    return value;
  };
  ipcMain.handle('tray:inbox-participants', (event, query: unknown) => {
    trusted(event);
    if (query !== undefined && (typeof query !== 'string' || query.length > 100)) throw new Error('Invalid Secure Chat search');
    return session.listInboxParticipants(query ? { q: query } : undefined);
  });
  ipcMain.handle('tray:inbox-create-conversation', (event, title: unknown, memberIds: unknown) => {
    trusted(event);
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 80) throw new Error('Invalid Secure Chat title');
    if (!Array.isArray(memberIds) || memberIds.length < 1 || memberIds.length > 49 ||
      new Set(memberIds).size !== memberIds.length) throw new Error('Invalid Secure Chat participants');
    return session.createInboxConversation(title.trim(), memberIds.map(inboxId));
  });
  ipcMain.handle('tray:inbox-change-participants', (event, conversationId: unknown, action: unknown, memberId: unknown, expectedRevision: unknown) => {
    trusted(event);
    if (action !== 'ADD' && action !== 'REMOVE') throw new Error('Invalid Secure Chat action');
    if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 1) throw new Error('Invalid Secure Chat revision');
    const conversation = inboxId(conversationId);
    const member = inboxId(memberId);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(conversation) || !uuid.test(member)) throw new Error('Invalid Secure Chat identifier');
    return session.changeInboxParticipants(conversation, { action, memberId: member, expectedRevision: expectedRevision as number });
  });
  ipcMain.handle('tray:inbox-conversations', (event) => { trusted(event); return session.listInboxConversations(); });
  ipcMain.handle('tray:inbox-clear-history', (event, conversationId: unknown) => {
    trusted(event);
    return session.clearInboxHistory(inboxId(conversationId));
  });
  ipcMain.handle('tray:inbox-normal-preparation', (event, conversationId: unknown) => {
    trusted(event); return session.prepareNormalInbox(inboxId(conversationId));
  });
  ipcMain.handle('tray:inbox-normal-messages', (event, conversationId: unknown) => {
    trusted(event); return session.listNormalInboxMessages(inboxId(conversationId));
  });
  ipcMain.handle('tray:inbox-send-normal', (event, conversationId: unknown, parentId: unknown, content: unknown) => {
    trusted(event);
    if (typeof content !== 'string' || !content.trim() || content.length > 65536) throw new Error('Invalid Secure Chat message');
    return session.sendNormalInboxText(inboxId(conversationId), inboxId(parentId), content);
  });
  ipcMain.handle('tray:inbox-messages', (event, conversationId: unknown) => {
    trusted(event);
    return session.listInboxMessages(inboxId(conversationId));
  });
  ipcMain.handle('tray:inbox-parents', (event, conversationId: unknown) => {
    trusted(event);
    return session.listInboxParents(inboxId(conversationId));
  });
  ipcMain.handle('tray:inbox-send-parent', (event, conversationId: unknown, parentId: unknown, segments: unknown) => {
    trusted(event);
    const conversation = inboxId(conversationId);
    const parent = inboxId(parentId);
    if (!Array.isArray(segments) || !segments.length || segments.length > 9) throw new Error('Invalid Secure Chat segments');
    let protectedCount = 0;
    let length = 0;
    const validated = segments.map((segment: unknown) => {
      if (!segment || typeof segment !== 'object' || Array.isArray(segment)) throw new Error('Invalid Secure Chat segment');
      if ('text' in segment && !('protectedText' in segment) && typeof segment.text === 'string' && segment.text.length) {
        length += segment.text.length;
        return { text: segment.text };
      }
      if ('protectedText' in segment && !('text' in segment) && typeof segment.protectedText === 'string' && segment.protectedText.length
        && 'expiresAt' in segment && typeof segment.expiresAt === 'string' && Number.isFinite(Date.parse(segment.expiresAt))) {
        protectedCount += 1;
        length += segment.protectedText.length;
        return { protectedText: segment.protectedText, expiresAt: segment.expiresAt };
      }
      throw new Error('Invalid Secure Chat segment');
    });
    if (protectedCount > 4 || length > 10000 || !length) throw new Error('Invalid Secure Chat segments');
    return session.sendInboxParent(conversation, parent, validated);
  });
  ipcMain.handle('tray:inbox-reveal-unit', (event, conversationId: unknown, parentId: unknown, unitId: unknown) => {
    trusted(event);
    return session.revealInboxUnit(inboxId(conversationId), inboxId(parentId), inboxId(unitId));
  });
  ipcMain.handle('tray:inbox-send-text', (event, conversationId: unknown, content: unknown, expiresAt: unknown) => {
    trusted(event);
    if (typeof content !== 'string' || !content.trim() || content.length > 10000 || typeof expiresAt !== 'string' || !Number.isFinite(Date.parse(expiresAt))) throw new Error('Invalid Secure Chat message');
    return session.sendInboxText(inboxId(conversationId), content, expiresAt);
  });
  ipcMain.handle('tray:inbox-send-file', (event, conversationId: unknown, expiresAt: unknown) => {
    trusted(event);
    if (typeof expiresAt !== 'string' || !Number.isFinite(Date.parse(expiresAt))) throw new Error('Invalid Secure Chat expiry');
    return session.sendInboxFile(inboxId(conversationId), expiresAt,
      (completed, total, stage) => { if (!event.sender.isDestroyed()) event.sender.send('tray:inbox-transfer-progress', { completed, total, stage }); });
  });
  ipcMain.handle('tray:inbox-open-text', (event, conversationId: unknown, messageId: unknown) => {
    trusted(event);
    return session.openInboxText(inboxId(conversationId), inboxId(messageId));
  });
  ipcMain.handle('tray:inbox-open-file', (event, conversationId: unknown, messageId: unknown) => {
    trusted(event);
    return session.openInboxFile(inboxId(conversationId), inboxId(messageId),
      (completed, total, stage) => { if (!event.sender.isDestroyed()) event.sender.send('tray:inbox-transfer-progress', { completed, total, stage }); });
  });
  ipcMain.handle('tray:inbox-cancel-transfer', (event) => { trusted(event); session.cancelInboxTransfer(); });
  ipcMain.handle('tray:inbox-retry-ack', (event, conversationId: unknown, messageId: unknown) => {
    trusted(event);
    return session.retryInboxAck(inboxId(conversationId), inboxId(messageId));
  });
  ipcMain.handle('tray:inbox-hide-text', (event) => { trusted(event); session.hideInboxText(); });
}
