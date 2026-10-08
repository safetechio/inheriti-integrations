import type { createNodeInbox } from '@safetech/inheriti-elements-core/inbox';
import type { TrayInboxIdentity } from './identity.js';

type InboxClient = ReturnType<typeof createNodeInbox>;

export class InboxReadAck {
  private readonly pending = new Map<string, { organizationId: string; conversationId: string; messageId: string; deviceId: string; leaseId: string }>();

  constructor(private readonly identity: TrayInboxIdentity,
    private readonly client: () => { organizationId: string; client: InboxClient },
    private readonly resolveKey: (organizationId: string, signal: AbortSignal) => Promise<string>) {}

  clear(): void { this.pending.clear(); }

  remember(organizationId: string, conversationId: string, messageId: string, deviceId: string,
    leaseId: string, acknowledgement: 'ACKNOWLEDGED' | 'PENDING'): void {
    const key = `${organizationId}:${conversationId}:${messageId}`;
    if (acknowledgement === 'PENDING') this.pending.set(key, { organizationId, conversationId, messageId, deviceId, leaseId });
    else this.pending.delete(key);
  }

  async open(conversationId: string, messageId: string) {
    const { organizationId, client } = this.client();
    const result = await this.identity.withIdentity(organizationId, async (identity, signal) => {
      const tenantKeyHex = await this.resolveKey(organizationId, signal);
      signal.throwIfAborted();
      const opened = await client.openText({ conversationId, messageId, identity, tenantKeyHex, signal });
      return { opened, deviceId: identity.deviceId };
    });
    this.remember(organizationId, conversationId, messageId, result.deviceId,
      result.opened.leaseId, result.opened.acknowledgement);
    return result.opened;
  }

  async openUnit(conversationId: string, parentId: string, unitId: string) {
    const { organizationId, client } = this.client();
    const result = await this.identity.withIdentity(organizationId, async (identity, signal) => {
      const tenantKeyHex = await this.resolveKey(organizationId, signal);
      signal.throwIfAborted();
      const opened = await client.revealUnit({ conversationId, parentId, unitId, identity, tenantKeyHex, signal });
      return { opened, deviceId: identity.deviceId };
    });
    this.remember(organizationId, conversationId, unitId, result.deviceId,
      result.opened.leaseId, result.opened.acknowledgement);
    return result.opened;
  }

  async retry(conversationId: string, messageId: string) {
    const { organizationId, client } = this.client();
    const key = `${organizationId}:${conversationId}:${messageId}`;
    const pending = this.pending.get(key);
    if (!pending || pending.conversationId !== conversationId || pending.messageId !== messageId ||
        pending.organizationId !== organizationId)
      throw new Error('inbox_ack_retry_unavailable');
    try {
      const acknowledgement = await this.identity.withIdentity(organizationId, async (identity, signal) => {
        if (identity.deviceId !== pending.deviceId) throw new Error('inbox_identity_mismatch');
        return client.ackText({ conversationId, messageId, deviceId: pending.deviceId, leaseId: pending.leaseId, signal });
      });
      if (acknowledgement === 'ACKNOWLEDGED') this.pending.delete(key);
      return { acknowledgement };
    } catch (error) {
      if (this.pending.has(key) && (error instanceof TypeError ||
          (error instanceof Error && 'status' in error && typeof error.status === 'number' && error.status >= 500) ||
          (error instanceof Error && /^inbox_identity_http_5\d\d$/.test(error.message))))
        return { acknowledgement: 'PENDING' as const };
      this.pending.delete(key);
      throw error;
    }
  }
}
