import { createNodeInbox, createNodeInboxEventListener, suggestInboxTextAsset } from '@safetech/inheriti-elements-core/node';
import { dialog } from 'electron';
import { open, readFile, stat, unlink } from 'node:fs/promises';
import { extname, basename } from 'node:path';
import { TrayInboxIdentity } from './identity.js';
import type { InboxIdentityState } from './identity.js';
import { InboxReadAck } from './read-ack.js';

export type TrayInboxSignal = { kind: 'PARTICIPANTS' | 'CONVERSATIONS' | 'NEW_MESSAGE' }
  | { conversationId: string; messageId: string; status: string; recipientStatus?: string; senderMemberId?: string; memberId?: string };

const MAX_FILE_BYTES = 10_000_000;

function mimeTypeFor(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  return ({ '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json' } as Record<string, string>)[extension]
    ?? 'application/octet-stream';
}

export class TrayInbox {
  private readonly identity: TrayInboxIdentity;
  private readonly read: InboxReadAck;
  private stopSignals: (() => void) | undefined;
  private transfer: AbortController | undefined;
  private cachedClient: { organizationId: string; client: ReturnType<typeof createNodeInbox> } | undefined;

  constructor(private readonly apiUrl: string, private readonly environment: 'TEST' | 'LIVE',
    private readonly token: () => Promise<string | undefined>,
    private readonly resolveKey: (organizationId: string, signal: AbortSignal, onRelaySession?: () => void) => Promise<string>,
    private readonly selectedOrganization: () => string,
    private readonly onSignal?: (signal?: TrayInboxSignal) => void,
    onIdentityState?: () => void) {
    this.identity = new TrayInboxIdentity(apiUrl, environment, token, resolveKey, onIdentityState);
    this.read = new InboxReadAck(this.identity, () => this.client(), resolveKey);
  }

  state(): InboxIdentityState { return this.identity.state(); }
  registeredMemberId(): Promise<string | undefined> { return this.identity.registeredMemberId(this.selectedOrganization()); }
  prepare(): Promise<InboxIdentityState> { return this.identity.prepare(this.selectedOrganization()); }
  replace(): Promise<InboxIdentityState> { return this.identity.replace(this.selectedOrganization()); }
  cancelPreparation(): void { this.identity.cancelPreparation(); }
  clear(): void { this.cancelTransfer(); this.stopSignals?.(); this.stopSignals = undefined; this.read.clear(); this.identity.clear(); this.cachedClient = undefined; }
  hide(): void { this.cancelTransfer(); this.identity.cancelOperation(); }
  cancelTransfer(): void { this.transfer?.abort(); }

  private startTransfer(): AbortController {
    if (this.transfer) throw new Error('inbox_transfer_busy');
    this.transfer = new AbortController();
    return this.transfer;
  }

  private async withTransferAbort<T>(signal: AbortSignal, operation: AbortController, run: () => Promise<T>): Promise<T> {
    const abort = () => operation.abort();
    signal.addEventListener('abort', abort, { once: true });
    try { signal.throwIfAborted(); return await run(); }
    finally { signal.removeEventListener('abort', abort); }
  }

  private async saveOpenedFile(file: { name: string; mimeType: string; bytes: Uint8Array }, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const selected = await dialog.showSaveDialog({ title: 'Save Secure Chat file', defaultPath: file.name });
    if (selected.canceled || !selected.filePath) throw new Error('inbox_file_save_cancelled');
    signal.throwIfAborted();
    const destination = await open(selected.filePath, 'wx');
    try { await destination.writeFile(file.bytes); }
    catch (error) { await destination.close(); await unlink(selected.filePath).catch(() => {}); throw error; }
    await destination.close();
  }

  private client() {
    const organizationId = this.selectedOrganization();
    if (this.cachedClient?.organizationId === organizationId) return this.cachedClient;
    this.cachedClient = { organizationId, client: createNodeInbox({
      apiUrl: this.apiUrl, environment: this.environment, organizationId,
      getBearerToken: async () => (await this.token()) ?? null,
    }) };
    return this.cachedClient;
  }

  listParticipants(input?: { q?: string; limit?: number; offset?: number }) {
    return this.client().client.listParticipants(input);
  }
  async createConversation(title: string, participantMemberIds: string[]) {
    const memberId = await this.registeredMemberId();
    if (!memberId) throw new Error('inbox_identity_not_ready');
    return this.client().client.createConversation(title, [memberId].concat(participantMemberIds));
  }
  changeParticipants(conversationId: string, input: { action: 'ADD' | 'REMOVE'; memberId: string; expectedRevision: number }) {
    return this.client().client.changeParticipants(conversationId, input);
  }
  listConversations(input?: { status?: 'ACTIVE' | 'CLOSED'; limit?: number; offset?: number }) {
    this.listen();
    return this.client().client.listConversations(input);
  }
  listen(): void {
    if (!this.stopSignals && this.onSignal) {
      this.stopSignals = createNodeInboxEventListener(this.apiUrl, async () => (await this.token()) ?? null,
        (signal) => {
          if (signal.tenantId !== this.selectedOrganization()) return;
          if ('kind' in signal) { this.onSignal?.({ kind: signal.kind }); return; }
          const update: TrayInboxSignal = { conversationId: signal.conversationId, messageId: signal.messageId, status: signal.status };
          if (signal.recipientStatus) update.recipientStatus = signal.recipientStatus;
          if (signal.senderMemberId) update.senderMemberId = signal.senderMemberId;
          if (signal.memberId) update.memberId = signal.memberId;
          this.onSignal?.(update);
        }, () => this.onSignal?.());
    }
  }
  listMessages(conversationId: string, input?: { status?: 'PREPARING' | 'AVAILABLE' | 'FAILED'; limit?: number; offset?: number }) {
    return this.client().client.listMessages(conversationId, input);
  }
  async clearHistory(conversationId: string) {
    const { organizationId, client } = this.client();
    const result = await this.identity.withIdentity(organizationId, (_identity, signal) =>
      client.clearHistory(conversationId, signal));
    this.read.clear();
    this.identity.cancelOperation();
    return result;
  }
  prepareNormal(conversationId: string) { return this.client().client.prepareNormal(conversationId); }
  listNormalMetadata(conversationId: string) { return this.client().client.listNormal(conversationId, { limit: 25 }); }
  listParents(conversationId: string) {
    const { organizationId, client } = this.client();
    return this.identity.withIdentity(organizationId, async (identity, signal) => {
      const page = await client.listParents(conversationId, { limit: 25 }, signal);
      const items = await Promise.all(page.items.map(async (message: {
        parentId: string; sequence: number; mode: string; status: string; senderMemberId: string;
        senderDeviceId: string; participantRevision: number; createdAt: string;
      }) => {
        const opened = await client.openParent({ conversationId, parentId: message.parentId, identity, signal });
        return { parentId: message.parentId, sequence: message.sequence, mode: message.mode, status: message.status,
          senderMemberId: message.senderMemberId, senderDeviceId: message.senderDeviceId,
          participantRevision: message.participantRevision, createdAt: message.createdAt,
          segments: opened.segments };
      }));
      signal.throwIfAborted();
      const newestNormal = items.filter((item) => item.mode !== 'PROTECTED')
        .reduce((latest, item) => !latest || item.sequence > latest.sequence ? item : latest, undefined as typeof items[number] | undefined);
      const read = newestNormal ? await client.markNormalRead({ conversationId, parentId: newestNormal.parentId, identity, signal }).catch(() => null) : null;
      const unreadCount = read ? (await client.listParents(conversationId, { limit: 25 }, signal)).unreadCount : page.unreadCount;
      return { items, total: page.total, unreadCount };
    });
  }
  sendParent(conversationId: string, parentId: string, segments: Array<{ text: string } | { protectedText: string; expiresAt: string }>) {
    const { organizationId, client } = this.client();
    return this.identity.withIdentity(organizationId, async (identity, signal) => {
      const tenantKeyHex = segments.some((segment) => 'protectedText' in segment)
        ? await this.resolveKey(organizationId, signal) : undefined;
      signal.throwIfAborted();
      return client.sendParent({ conversationId, parentId, segments, identity, tenantKeyHex, signal });
    });
  }
  async revealUnit(conversationId: string, parentId: string, unitId: string) {
    const opened = await this.read.openUnit(conversationId, parentId, unitId);
    return { text: opened.text, leaseId: opened.leaseId, leaseExpiresAt: opened.leaseExpiresAt,
      acknowledgement: opened.acknowledgement, suggestion: suggestInboxTextAsset(opened.text) };
  }
  listNormal(conversationId: string) {
    const { organizationId, client } = this.client();
    return this.identity.withIdentity(organizationId, async (identity, signal) => {
      // Reads are limited to 25 individual decryptions until paginated history is available.
      const page = await client.listNormal(conversationId, { limit: 25 }, signal);
      const items = await Promise.all(page.items.map(async (message: {
        parentId: string; sequence: number; senderMemberId: string; senderDeviceId: string;
        participantRevision: number; createdAt: string;
      }) => {
        const opened = await client.openNormal({ conversationId, parentId: message.parentId, identity, signal });
        return { parentId: message.parentId, sequence: message.sequence, senderMemberId: message.senderMemberId,
          senderDeviceId: message.senderDeviceId, participantRevision: message.participantRevision,
          createdAt: message.createdAt, text: opened.text };
      }));
      signal.throwIfAborted();
      const read = items.length ? await client.markNormalRead({ conversationId, parentId: items[0].parentId, identity, signal }).catch(() => null) : null;
      return { items, total: page.total, limit: page.limit, offset: page.offset,
        unreadCount: read ? 0 : page.unreadCount,
        readThroughSequence: read?.readThroughSequence ?? page.readThroughSequence };
    });
  }
  sendNormal(conversationId: string, parentId: string, text: string) {
    const { organizationId, client } = this.client();
    return this.identity.withIdentity(organizationId, (identity) =>
      client.sendNormal({ conversationId, parentId, text, identity }));
  }
  sendText(conversationId: string, text: string, expiresAt: string) {
    const { organizationId, client } = this.client();
    return this.identity.withIdentity(organizationId, async (identity, signal) => {
      const tenantKeyHex = await this.resolveKey(organizationId, signal);
      signal.throwIfAborted();
      return client.sendText({ conversationId, text, expiresAt, identity, tenantKeyHex });
    });
  }
  async sendFile(conversationId: string, expiresAt: string, progress?: (completed: number, total: number, stage?: string) => void) {
    const operation = this.startTransfer();
    let bytes: Buffer | undefined;
    try {
      const { organizationId, client } = this.client();
      const selected = await dialog.showOpenDialog({ properties: ['openFile'], title: 'Choose a file for Secure Chat' });
      operation.signal.throwIfAborted();
      if (this.selectedOrganization() !== organizationId) throw new Error('inbox_organization_changed');
      if (selected.canceled || !selected.filePaths[0]) return { cancelled: true };
      const filePath = selected.filePaths[0];
      if ((await stat(filePath)).size > MAX_FILE_BYTES) throw new Error('inbox_file_too_large');
      bytes = await readFile(filePath, { signal: operation.signal });
      if (bytes.length > MAX_FILE_BYTES) throw new Error('inbox_file_too_large');
      operation.signal.throwIfAborted();
      return await this.identity.withIdentity(organizationId, (identity, signal) =>
        this.withTransferAbort(signal, operation, async () => {
          const tenantKeyHex = await this.resolveKey(organizationId, operation.signal);
          operation.signal.throwIfAborted();
          return client.sendFile({ conversationId, file: { name: basename(filePath), mimeType: mimeTypeFor(filePath), bytes: bytes! }, expiresAt,
            identity, tenantKeyHex, signal: operation.signal, onProgress: progress });
        }));
    } finally {
      bytes?.fill(0);
      this.transfer = undefined;
    }
  }
  async openFile(conversationId: string, messageId: string, progress?: (completed: number, total: number, stage?: string) => void) {
    const operation = this.startTransfer();
    try {
      const { organizationId, client } = this.client();
      const result = await this.identity.withIdentity(organizationId, (identity, signal) =>
        this.withTransferAbort(signal, operation, async () => {
          const tenantKeyHex = await this.resolveKey(organizationId, operation.signal);
          const opened = await client.openFile({ conversationId, messageId, identity, tenantKeyHex, signal: operation.signal,
            onProgress: progress, save: (file: { name: string; mimeType: string; bytes: Uint8Array }) =>
              this.saveOpenedFile(file, operation.signal) });
          return { opened, deviceId: identity.deviceId };
        }));
      this.read.remember(organizationId, conversationId, messageId, result.deviceId,
        result.opened.leaseId, result.opened.acknowledgement);
      return result.opened;
    } finally { this.transfer = undefined; }
  }
  async openText(conversationId: string, messageId: string) {
    const opened = await this.read.open(conversationId, messageId);
    return { text: opened.text, leaseId: opened.leaseId, leaseExpiresAt: opened.leaseExpiresAt,
      acknowledgement: opened.acknowledgement, suggestion: suggestInboxTextAsset(opened.text) };
  }
  retryAck(conversationId: string, messageId: string) { return this.read.retry(conversationId, messageId); }
}
