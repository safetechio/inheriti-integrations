import { createNodeInbox } from '@safetech/inheriti-elements-core/node';
import { TrayInboxIdentity } from './identity.js';
import type { InboxIdentityState } from './identity.js';
import { InboxReadAck } from './read-ack.js';

export class TrayInbox {
  private readonly identity: TrayInboxIdentity;
  private readonly read: InboxReadAck;

  constructor(private readonly apiUrl: string, private readonly environment: 'TEST' | 'LIVE',
    private readonly token: () => Promise<string | undefined>,
    private readonly resolveKey: (organizationId: string, signal: AbortSignal) => Promise<string>,
    private readonly selectedOrganization: () => string) {
    this.identity = new TrayInboxIdentity(apiUrl, environment, token, resolveKey);
    this.read = new InboxReadAck(this.identity, () => this.client(), resolveKey);
  }

  state(): InboxIdentityState { return this.identity.state(); }
  prepare(): Promise<InboxIdentityState> { return this.identity.prepare(this.selectedOrganization()); }
  clear(): void { this.read.clear(); this.identity.clear(); }
  hide(): void { this.read.clear(); this.identity.cancelOperation(); }

  private client() {
    const organizationId = this.selectedOrganization();
    return { organizationId, client: createNodeInbox({
      apiUrl: this.apiUrl, environment: this.environment, organizationId,
      getBearerToken: async () => (await this.token()) ?? null,
    }) };
  }

  listParticipants(input?: { q?: string; limit?: number; offset?: number }) {
    return this.client().client.listParticipants(input);
  }
  createConversation(participantMemberIds: string[]) {
    return this.client().client.createConversation(participantMemberIds);
  }
  listConversations(input?: { status?: 'ACTIVE' | 'CLOSED'; limit?: number; offset?: number }) {
    return this.client().client.listConversations(input);
  }
  listMessages(conversationId: string, input?: { status?: 'PREPARING' | 'AVAILABLE' | 'FAILED'; limit?: number; offset?: number }) {
    return this.client().client.listMessages(conversationId, input);
  }
  sendText(conversationId: string, text: string, expiresAt: string) {
    const { organizationId, client } = this.client();
    return this.identity.withIdentity(organizationId, async (identity, signal) => {
      const tenantKeyHex = await this.resolveKey(organizationId, signal);
      signal.throwIfAborted();
      return client.sendText({ conversationId, text, expiresAt, identity, tenantKeyHex });
    });
  }
  openText(conversationId: string, messageId: string) { return this.read.open(conversationId, messageId); }
  retryAck(conversationId: string, messageId: string) { return this.read.retry(conversationId, messageId); }
}
