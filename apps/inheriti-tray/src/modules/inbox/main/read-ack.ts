import type { createNodeInbox } from '@safetech/inheriti-elements-core/node';
import type { TrayInboxIdentity } from './identity.js';

type InboxClient = ReturnType<typeof createNodeInbox>;

export class InboxReadAck {
  private pending: { organizationId: string; conversationId: string; messageId: string; deviceId: string; leaseId: string } | undefined;

  constructor(private readonly identity: TrayInboxIdentity,
    private readonly client: () => { organizationId: string; client: InboxClient },
    private readonly resolveKey: (organizationId: string, signal: AbortSignal) => Promise<string>) {}

  clear(): void { this.pending = undefined; }

  remember(organizationId: string, conversationId: string, messageId: string, deviceId: string,
    leaseId: string, acknowledgement: 'ACKNOWLEDGED' | 'PENDING'): void {
    this.pending = acknowledgement === 'PENDING'
      ? { organizationId, conversationId, messageId, deviceId, leaseId }
      : undefined;
  }

  async open(conversationId: string, messageId: string) {
    const { organizationId, client } = this.client();
    this.pending = undefined;
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

  async retry(conversationId: string, messageId: string) {
    const pending = this.pending;
    if (!pending || pending.conversationId !== conversationId || pending.messageId !== messageId ||
        pending.organizationId !== this.client().organizationId)
      throw new Error('inbox_ack_retry_unavailable');
    const { organizationId, client } = this.client();
    try {
      const acknowledgement = await this.identity.withIdentity(organizationId, async (identity, signal) => {
        if (identity.deviceId !== pending.deviceId) throw new Error('inbox_identity_mismatch');
        return client.ackText({ conversationId, messageId, deviceId: pending.deviceId, leaseId: pending.leaseId, signal });
      });
      if (acknowledgement === 'ACKNOWLEDGED') this.pending = undefined;
      return { acknowledgement };
    } catch (error) {
      if (this.pending && (error instanceof TypeError ||
          (error instanceof Error && 'status' in error && typeof error.status === 'number' && error.status >= 500) ||
          (error instanceof Error && /^inbox_identity_http_5\d\d$/.test(error.message))))
        return { acknowledgement: 'PENDING' as const };
      this.pending = undefined;
      throw error;
    }
  }
}
