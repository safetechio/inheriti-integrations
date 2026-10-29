import { createNodeInboxEventListener, suggestInboxTextAsset } from '@safetech/inheriti-elements-core/node';
import { createNodeInbox, generateInheritiFileKey, sealInheritiFile, sealInheritiFileKey } from '@safetech/inheriti-elements-core/inbox';
import { dialog } from 'electron';
import { open, readFile, stat, unlink } from 'node:fs/promises';
import { extname, basename } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { TrayInboxIdentity } from './identity.js';
import type { InboxIdentityState } from './identity.js';
import { InboxReadAck } from './read-ack.js';

export type TrayInboxSignal = { kind: 'PARTICIPANTS' | 'NEW_MESSAGE'; tenantId?: string }
  | { kind: 'CONVERSATIONS'; tenantId?: string; conversationId?: string; action?: 'CREATED' | 'ADD' | 'REMOVE'; memberId?: string; memberName?: string; participantRevision?: number }
  | { kind: 'PRESENCE'; tenantId: string; memberIds?: string[]; checkedAt?: string; connected: boolean }
  | { conversationId: string; messageId: string; status: string; tenantId?: string; recipientStatus?: string; senderMemberId?: string; memberId?: string; memberName?: string };

const MAX_FILE_BYTES = 10_000_000;
const MAX_VIEWER_TEXT_BYTES = 45 * 1024;
const LEASE_SAFETY_MS = 30_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Receipt = { memberId: string; read?: boolean; readAt?: string | null;
  secrets?: Array<{ position: number; status: string; revealedAt?: string | null }> };

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
  private signalRevision = 0;
  private transfer: AbortController | undefined;
  private pendingOperations = 0;
  private transitioning = false;
  private planFileAccept: { conversationId: string; messageId: string; accept: () => void } | undefined;
  private cachedClient: { organizationId: string; client: ReturnType<typeof createNodeInbox> } | undefined;

  constructor(private readonly apiUrl: string, private readonly environment: 'TEST' | 'LIVE',
    private readonly token: () => Promise<string | undefined>,
    getPrincipal: () => Promise<{ issuer: string; subject: string } | undefined>,
    private readonly resolveKey: (organizationId: string, signal: AbortSignal, onRelaySession?: () => void) => Promise<string>,
    private readonly selectedOrganization: () => string,
    private readonly onSignal?: (signal?: TrayInboxSignal) => void,
    onIdentityState?: () => void) {
    this.identity = new TrayInboxIdentity(apiUrl, environment, token, getPrincipal, onIdentityState);
    this.read = new InboxReadAck(this.identity, () => this.client(), resolveKey);
  }

  state(): InboxIdentityState { return this.identity.state(); }
  registeredMemberId(): Promise<string | undefined> {
    if (this.transitioning) throw new Error('inbox_transition_in_progress');
    return this.identity.registeredMemberId(this.selectedOrganization());
  }
  async prepare(): Promise<InboxIdentityState> {
    if (this.transitioning) throw new Error('inbox_transition_in_progress');
    return this.identity.prepare(this.selectedOrganization());
  }
  replace(): Promise<InboxIdentityState> { return this.trackOperation(() => this.identity.replace(this.selectedOrganization())); }
  cancelPreparation(): void { this.identity.cancelPreparation(); }
  assertIdle(): void {
    if (this.transfer) throw new Error('inbox_transfer_busy');
    if (this.pendingOperations) throw new Error('inbox_operation_busy');
  }
  beginAccountTransition(): void {
    if (this.transitioning) throw new Error('inbox_transition_in_progress');
    this.assertIdle();
    this.transitioning = true;
    this.identity.cancelPreparation();
  }
  endAccountTransition(): void { this.transitioning = false; }
  clear(): void { ++this.signalRevision; this.cancelTransfer(); this.stopSignals?.(); this.stopSignals = undefined; this.read.clear(); this.identity.clear(); this.cachedClient = undefined; }
  hide(): void { this.cancelTransfer(); this.identity.cancelOperation(); }
  cancelTransfer(): void { this.transfer?.abort(); }

  private startTransfer(): AbortController {
    if (this.transitioning) throw new Error('inbox_transition_in_progress');
    if (this.transfer) throw new Error('inbox_transfer_busy');
    this.transfer = new AbortController();
    return this.transfer;
  }

  private async trackOperation<T>(run: () => Promise<T>): Promise<T> {
    if (this.transitioning) throw new Error('inbox_transition_in_progress');
    this.pendingOperations += 1;
    try { return await run(); }
    finally { this.pendingOperations -= 1; }
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
    if (this.transitioning) throw new Error('inbox_transition_in_progress');
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
  listProtectedFilePlans() { return this.client().client.listPlans(); }
  listMembers(input?: { q?: string; limit?: number; offset?: number }) {
    return this.client().client.listMembers(input);
  }
  async createConversation(title: string, participantMemberIds: string[]) {
    return this.trackOperation(async () => {
      const memberId = await this.registeredMemberId();
      if (!memberId) throw new Error('inbox_identity_not_ready');
      return this.client().client.createConversation(title, [memberId].concat(participantMemberIds));
    });
  }
  changeParticipants(conversationId: string, input: { action: 'ADD' | 'REMOVE'; memberId: string; expectedRevision: number }) {
    return this.trackOperation(() => this.client().client.changeParticipants(conversationId, input));
  }
  listConversations(input?: { status?: 'ACTIVE' | 'CLOSED'; limit?: number; offset?: number }) {
    if (this.transitioning) throw new Error('inbox_transition_in_progress');
    this.listen();
    return this.client().client.listConversations(input);
  }
  listOrganizationConversations(organizationId: string, input?: { status?: 'ACTIVE' | 'CLOSED'; limit?: number; offset?: number }) {
    if (this.transitioning) throw new Error('inbox_transition_in_progress');
    return createNodeInbox({ apiUrl: this.apiUrl, environment: this.environment, organizationId,
      getBearerToken: async () => (await this.token()) ?? null }).listConversations(input);
  }
  listen(): void {
    if (!this.stopSignals && this.onSignal) {
      const tenantId = this.selectedOrganization();
      const revision = ++this.signalRevision;
      const isCurrent = () => {
        if (revision !== this.signalRevision || this.transitioning) return false;
        try { return this.selectedOrganization() === tenantId; } catch { return false; }
      };
      this.stopSignals = createNodeInboxEventListener(this.apiUrl, async () => (await this.token()) ?? null,
        (signal) => {
          if (!isCurrent()) return;
          if (signal.tenantId !== tenantId && !('messageId' in signal) && signal.kind !== 'CONVERSATIONS') return;
          if ('kind' in signal) {
            if (signal.kind === 'CONVERSATIONS') {
              this.onSignal?.({ kind: 'CONVERSATIONS', tenantId: signal.tenantId, ...(signal.conversationId ? { conversationId: signal.conversationId } : {}),
                ...(signal.action ? { action: signal.action } : {}), ...(signal.memberId ? { memberId: signal.memberId } : {}),
                ...(signal.memberName ? { memberName: signal.memberName } : {}),
                ...(signal.participantRevision !== undefined ? { participantRevision: signal.participantRevision } : {}) });
            } else this.onSignal?.({ kind: signal.kind });
            return;
          }
          const update: TrayInboxSignal = { tenantId: signal.tenantId, conversationId: signal.conversationId, messageId: signal.messageId, status: signal.status };
          if (signal.recipientStatus) update.recipientStatus = signal.recipientStatus;
          if (signal.senderMemberId) update.senderMemberId = signal.senderMemberId;
          if (signal.memberId) update.memberId = signal.memberId;
          if (signal.memberName) update.memberName = signal.memberName;
          this.onSignal?.(update);
        }, () => { if (isCurrent()) this.onSignal?.(); }, tenantId, (snapshot) => {
          if (!isCurrent()) return;
          this.onSignal?.(snapshot
            ? { kind: 'PRESENCE', tenantId, memberIds: snapshot.memberIds, checkedAt: snapshot.checkedAt, connected: true }
            : { kind: 'PRESENCE', tenantId, connected: false });
        });
    }
  }
  listMessages(conversationId: string, input?: { status?: 'PREPARING' | 'AVAILABLE' | 'FAILED'; limit?: number; offset?: number }) {
    return this.client().client.listMessages(conversationId, input);
  }
  async clearHistory(conversationId: string) {
    return this.trackOperation(async () => {
      const { organizationId, client } = this.client();
      const result = await this.identity.withIdentity(organizationId, (_identity, signal) =>
        client.clearHistory(conversationId, signal));
      this.read.clear();
      this.identity.cancelOperation();
      return result;
    });
  }
  prepareNormal(conversationId: string) { return this.trackOperation(() => this.client().client.prepareNormal(conversationId)); }
  listNormalMetadata(conversationId: string) { return this.client().client.listNormal(conversationId, { limit: 25 }); }
  listParentMetadata(conversationId: string) { return this.client().client.listParents(conversationId, { limit: 25 }); }
  listParents(conversationId: string) {
    return this.trackOperation(() => {
      const { organizationId, client } = this.client();
      return this.identity.withIdentity(organizationId, async (identity, signal) => {
        const page = await client.listParents(conversationId, { limit: 25 }, signal);
        const items = await Promise.all(page.items.map(async (message: {
          parentId: string; sequence: number; mode: string; status: string; senderMemberId: string;
          senderDeviceId: string; participantRevision: number; createdAt: string; recipientStatuses?: Receipt[];
        }) => {
          const opened = await client.openParent({ conversationId, parentId: message.parentId, identity, signal });
          return { parentId: message.parentId, sequence: message.sequence, mode: message.mode, status: message.status,
            senderMemberId: message.senderMemberId, senderDeviceId: message.senderDeviceId,
            participantRevision: message.participantRevision, createdAt: message.createdAt,
            recipientStatuses: message.recipientStatuses,
            segments: opened.segments };
        }));
        signal.throwIfAborted();
        const newestParent = page.items.reduce((latest: typeof page.items[number] | undefined, item: typeof page.items[number]) => !latest || item.sequence > latest.sequence ? item : latest,
          undefined as typeof page.items[number] | undefined);
        const standalone = await client.listMessages(conversationId, { status: 'AVAILABLE', limit: 25 }, signal);
        const latestStandalone = standalone.items[0];
        let marked = false;
        for (const messageId of [newestParent?.parentId, latestStandalone?.id]) {
          if (!messageId) continue;
          const read = await client.markNormalRead({ conversationId, parentId: messageId, identity, signal }).catch(() => null);
          if (read) marked = true;
        }
        const unreadCount = marked ? (await client.listParents(conversationId, { limit: 25 }, signal)).unreadCount : page.unreadCount;
        return { items, total: page.total, unreadCount };
      });
    });
  }
  sendParent(conversationId: string, parentId: string, segments: Array<{ text: string } | { protectedText: string; expiresAt: string }>, progress?: (completed: number, total: number) => void) {
    return this.trackOperation(() => {
      const { organizationId, client } = this.client();
      return this.identity.withIdentity(organizationId, async (identity, signal) => {
        const tenantKeyHex = segments.some((segment) => 'protectedText' in segment)
          ? await this.resolveKey(organizationId, signal) : undefined;
        signal.throwIfAborted();
        return client.sendParent({ conversationId, parentId, segments, identity, tenantKeyHex, signal, onProgress: progress });
      });
    });
  }
  async revealUnit(conversationId: string, parentId: string, unitId: string) {
    return this.trackOperation(async () => {
      const opened = await this.read.openUnit(conversationId, parentId, unitId);
      return { text: opened.text, leaseId: opened.leaseId, leaseExpiresAt: opened.leaseExpiresAt,
        acknowledgement: opened.acknowledgement, suggestion: suggestInboxTextAsset(opened.text) };
    });
  }
  listNormal(conversationId: string) {
    return this.trackOperation(() => {
      const { organizationId, client } = this.client();
      return this.identity.withIdentity(organizationId, async (identity, signal) => {
        // Reads are limited to 25 individual decryptions until paginated history is available.
        const page = await client.listNormal(conversationId, { limit: 25 }, signal);
        const items = await Promise.all(page.items.map(async (message: {
          parentId: string; sequence: number; senderMemberId: string; senderDeviceId: string;
          participantRevision: number; createdAt: string; recipientStatuses?: Receipt[];
        }) => {
          const opened = await client.openNormal({ conversationId, parentId: message.parentId, identity, signal });
          return { parentId: message.parentId, sequence: message.sequence, senderMemberId: message.senderMemberId,
            senderDeviceId: message.senderDeviceId, participantRevision: message.participantRevision,
            createdAt: message.createdAt, recipientStatuses: message.recipientStatuses, text: opened.text };
        }));
        signal.throwIfAborted();
        const read = items.length ? await client.markNormalRead({ conversationId, parentId: items[0].parentId, identity, signal }).catch(() => null) : null;
        return { items, total: page.total, limit: page.limit, offset: page.offset,
          unreadCount: read ? 0 : page.unreadCount,
          readThroughSequence: read?.readThroughSequence ?? page.readThroughSequence };
      });
    });
  }
  sendNormal(conversationId: string, parentId: string, text: string) {
    return this.trackOperation(() => {
      const { organizationId, client } = this.client();
      return this.identity.withIdentity(organizationId, (identity) =>
        client.sendNormal({ conversationId, parentId, text, identity }));
    });
  }
  sendText(conversationId: string, text: string, expiresAt: string) {
    return this.trackOperation(() => {
      const { organizationId, client } = this.client();
      return this.identity.withIdentity(organizationId, async (identity, signal) => {
        const tenantKeyHex = await this.resolveKey(organizationId, signal);
        signal.throwIfAborted();
        return client.sendText({ conversationId, text, expiresAt, identity, tenantKeyHex });
      });
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
  async openProtectedFile(input: { conversationId: string; messageId: string; planId: string;
    copyId: string; envelopeId: string; openLimit: number | null },
    progress?: (completed: number, total: number, stage?: string) => void) {
    if (![input.conversationId, input.messageId, input.planId, input.copyId, input.envelopeId].every(value => UUID.test(value)) ||
      input.copyId === input.envelopeId ||
      (input.openLimit !== null && (!Number.isSafeInteger(input.openLimit) || input.openLimit < 1 || input.openLimit > 4294967295)))
      throw new Error('invalid_protected_file_selection');
    const operation = this.startTransfer();
    let savedPath: string | undefined;
    let creationAttempted = false;
    let sourceClient: ReturnType<typeof createNodeInbox> | undefined;
    try {
      const { organizationId, client } = this.client();
      sourceClient = client;
      const result = await this.identity.withIdentity(organizationId, (identity, signal) =>
        this.withTransferAbort(signal, operation, async () => {
          const tenantKeyHex = await this.resolveKey(organizationId, operation.signal);
          const opened = await client.openFile({ conversationId: input.conversationId, messageId: input.messageId,
            identity, tenantKeyHex, signal: operation.signal, onProgress: progress,
            save: async (file: { name: string; mimeType: string; bytes: Uint8Array },
              lease: { leaseId: string; leaseExpiresAt: string }) => {
              const deadline = Date.parse(lease.leaseExpiresAt) - LEASE_SAFETY_MS;
              if (!Number.isFinite(deadline) || deadline <= Date.now() + LEASE_SAFETY_MS ||
                file.mimeType !== 'text/plain' || !file.bytes.length || file.bytes.length > MAX_VIEWER_TEXT_BYTES)
                throw new Error('protected_file_unavailable');
              const key = await client.getOwnFileAccessIdentityKey(operation.signal);
              if (!key || key.status !== 'ACTIVE') throw new Error('protected_file_identity_unavailable');
              const fileKey = generateInheritiFileKey();
              try {
                const sealedFileKey = await sealInheritiFileKey(fileKey, key.publicKey);
                operation.signal.throwIfAborted();
                creationAttempted = true;
                const created = await client.createInboxFileAccess(input.conversationId, input.messageId, {
                  copyId: input.copyId, envelopeId: input.envelopeId, deviceId: identity.deviceId,
                  leaseId: lease.leaseId, planId: input.planId, identityKeyFingerprint: key.fingerprint,
                  sealedFileKey, openLimit: input.openLimit,
                }, operation.signal);
                if (created.copyId !== input.copyId || created.status !== 'PENDING') throw new Error('protected_file_creation_invalid');
                let copy = await client.getFileAccess(input.copyId, operation.signal);
                while (copy.status === 'PENDING' && Date.now() < deadline) {
                  await delay(1_000, undefined, { signal: operation.signal });
                  copy = await client.getFileAccess(input.copyId, operation.signal);
                }
                if (Date.now() >= deadline || copy.copyId !== input.copyId || copy.status !== 'READY' ||
                  copy.deployment !== new URL(this.apiUrl).origin || copy.origin !== 'INBOX' ||
                  copy.recipient !== identity.memberId || copy.expiresAt !== null || copy.allowedUses !== input.openLimit)
                  throw new Error('protected_file_claim_unavailable');
                const encrypted = await sealInheritiFile({ plaintext: file.bytes, fileKey,
                  binding: { deployment: copy.deployment, origin: 'INBOX', copyId: input.copyId,
                    recipient: identity.memberId, expiresAt: null, allowedUses: input.openLimit }, mimeType: file.mimeType });
                try {
                  operation.signal.throwIfAborted();
                  if (Date.now() >= deadline) throw new Error('protected_file_claim_unavailable');
                  const safeName = basename(file.name.replaceAll('\\', '/')) || 'Protected file';
                  const selected = await dialog.showSaveDialog({ title: 'Save protected .inheriti file', defaultPath: `${safeName}.inheriti` });
                  if (selected.canceled || !selected.filePath) throw new Error('inbox_file_save_cancelled');
                  operation.signal.throwIfAborted();
                  if (Date.now() >= deadline) throw new Error('protected_file_claim_unavailable');
                  const destination = await open(selected.filePath, 'wx');
                  try { await destination.writeFile(encrypted.fileBytes); await destination.sync(); }
                  catch (error) { await destination.close(); await unlink(selected.filePath).catch(() => {}); throw error; }
                  await destination.close();
                  savedPath = selected.filePath;
                  if (Date.now() >= deadline) throw new Error('protected_file_claim_unavailable');
                } finally { encrypted.fileBytes.fill(0); encrypted.fileKey.fill(0); }
              } finally { fileKey.fill(0); file.bytes.fill(0); }
            } });
          return { opened, deviceId: identity.deviceId };
        }));
      this.read.remember(organizationId, input.conversationId, input.messageId, result.deviceId,
        result.opened.leaseId, result.opened.acknowledgement);
      return result.opened;
    } catch (error) {
      if (!savedPath && creationAttempted) await sourceClient?.cancelInboxFileAccess(input.conversationId, input.messageId, input.copyId).catch(() => {});
      if (savedPath && error instanceof Error && error.message === 'protected_file_claim_unavailable') {
        await unlink(savedPath).catch(() => {});
        if (creationAttempted) await sourceClient?.cancelInboxFileAccess(input.conversationId, input.messageId, input.copyId).catch(() => {});
      }
      throw error;
    } finally { this.transfer = undefined; }
  }
  acceptFileForPlan(conversationId: string, messageId: string): void {
    if (this.planFileAccept?.conversationId !== conversationId || this.planFileAccept.messageId !== messageId)
      throw new Error('inbox_file_not_pending');
    this.planFileAccept.accept();
  }
  async openFileForPlan(conversationId: string, messageId: string,
    deliver: (file: { name: string; mimeType: string; bytes: Uint8Array }) => void,
    progress?: (completed: number, total: number, stage?: string) => void) {
    const operation = this.startTransfer();
    try {
      const { organizationId, client } = this.client();
      const result = await this.identity.withIdentity(organizationId, (identity, signal) =>
        this.withTransferAbort(signal, operation, async () => {
          const tenantKeyHex = await this.resolveKey(organizationId, operation.signal);
          const opened = await client.openFile({ conversationId, messageId, identity, tenantKeyHex, signal: operation.signal,
            onProgress: progress, save: async (openedFile: { name: string; mimeType: string; bytes: Uint8Array }) => {
              operation.signal.throwIfAborted();
              if (openedFile.bytes.length > MAX_FILE_BYTES) throw new Error('inbox_file_too_large');
              await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => { operation.signal.removeEventListener('abort', abort); this.planFileAccept = undefined; reject(new Error('inbox_file_accept_timeout')); }, 15_000);
                const abort = () => { clearTimeout(timeout); this.planFileAccept = undefined; reject(operation.signal.reason); };
                operation.signal.addEventListener('abort', abort, { once: true });
                this.planFileAccept = { conversationId, messageId, accept: () => {
                  clearTimeout(timeout);
                  operation.signal.removeEventListener('abort', abort);
                  this.planFileAccept = undefined;
                  resolve();
                } };
                try { deliver(openedFile); }
                catch (error) { clearTimeout(timeout); operation.signal.removeEventListener('abort', abort); this.planFileAccept = undefined; reject(error); }
              });
            } });
          return { opened, deviceId: identity.deviceId };
        }));
      this.read.remember(organizationId, conversationId, messageId, result.deviceId,
        result.opened.leaseId, result.opened.acknowledgement);
      return { acknowledgement: result.opened.acknowledgement };
    } finally { this.planFileAccept = undefined; this.transfer = undefined; }
  }
  async openText(conversationId: string, messageId: string) {
    return this.trackOperation(async () => {
      const opened = await this.read.open(conversationId, messageId);
      return { text: opened.text, leaseId: opened.leaseId, leaseExpiresAt: opened.leaseExpiresAt,
        acknowledgement: opened.acknowledgement, suggestion: suggestInboxTextAsset(opened.text) };
    });
  }
  retryAck(conversationId: string, messageId: string) {
    return this.trackOperation(() => this.read.retry(conversationId, messageId));
  }
}
