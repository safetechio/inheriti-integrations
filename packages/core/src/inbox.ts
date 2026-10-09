import { HttpElementsApiPort, NodeInboxFile, NodeInboxNormal, NodeInboxParent, NodeInboxText } from '@safetech/inheriti-client-sdk/inbox';
import type { InboxLocalIdentity, NormalInboxMessagePage, SendNormalInboxTextInput, OpenNormalInboxTextInput, SendInboxFileInput, OpenInboxFileInput, SendInboxParentInput, OpenInboxParentInput } from '@safetech/inheriti-client-sdk/inbox';
import type { ElementsEnvironment } from './index.js';
export type { InboxLocalIdentity } from '@safetech/inheriti-client-sdk/inbox';
export function createNodeInbox(options: {
  apiUrl: string;
  environment: ElementsEnvironment;
  organizationId: string;
  getBearerToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}) {
  const api = new HttpElementsApiPort(options.apiUrl, options.environment, options.getBearerToken,
    options.fetchImpl ?? globalThis.fetch.bind(globalThis), { organizationId: options.organizationId });
  const text = new NodeInboxText(api);
  const file = new NodeInboxFile(api);
  const normal = new NodeInboxNormal(api);
  const parent = new NodeInboxParent(api, text);
  return {
    listMembers: (input?: { q?: string; limit?: number; offset?: number }, signal?: AbortSignal) => api.listInboxMembers(input, signal),
    listParticipants: (input?: { q?: string; limit?: number; offset?: number }, signal?: AbortSignal) => api.listInboxParticipants(input, signal),
    createConversation: (title: string, participantMemberIds: string[]) => api.createInboxConversation({ title, participantMemberIds }),
    changeParticipants: (conversationId: string, input: { action: 'ADD' | 'REMOVE'; memberId: string; expectedRevision: number }) =>
      api.changeInboxParticipants(conversationId, input),
    listConversations: (input?: { status?: 'ACTIVE' | 'CLOSED'; limit?: number; offset?: number }, signal?: AbortSignal) => api.listInboxConversations(input, signal),
    listMessages: (conversationId: string, input?: { status?: 'PREPARING' | 'AVAILABLE' | 'FAILED'; limit?: number; offset?: number }, signal?: AbortSignal) => api.listInboxMessages(conversationId, input, signal),
    prepareNormal: (conversationId: string) => api.getNormalInboxSendPreparation(conversationId),
    listNormal: (conversationId: string, input?: { limit?: number; offset?: number }, signal?: AbortSignal): Promise<NormalInboxMessagePage> => normal.list(conversationId, input, signal),
    sendNormal: (input: SendNormalInboxTextInput) => normal.send(input),
    openNormal: (input: OpenNormalInboxTextInput) => normal.open(input),
    markNormalRead: (input: OpenNormalInboxTextInput) => normal.markRead(input),
    listParents: (conversationId: string, input?: { limit?: number; offset?: number }, signal?: AbortSignal) =>
      parent.list(conversationId, input, signal),
    sendParent: (input: SendInboxParentInput) => parent.send(input),
    openParent: (input: OpenInboxParentInput) => parent.open(input),
    revealUnit: (input: OpenInboxParentInput & { unitId: string; tenantKeyHex: string }) => parent.revealUnit(input),
    clearHistory: (conversationId: string, signal?: AbortSignal) => parent.clearHistory(conversationId, signal),
    sendText: (input: { conversationId: string; text: string; expiresAt: string; identity: InboxLocalIdentity; tenantKeyHex: string }) => text.send(input),
    openText: (input: { conversationId: string; messageId: string; identity: InboxLocalIdentity; tenantKeyHex: string; signal?: AbortSignal }) => text.open(input),
    sendFile: (input: SendInboxFileInput) => file.sendFile(input),
    openFile: (input: OpenInboxFileInput) => file.openFile(input),
    ackText: (input: { conversationId: string; messageId: string; deviceId: string; leaseId: string; signal?: AbortSignal }) =>
      text.ack(input.conversationId, input.messageId, input.deviceId, input.leaseId, input.signal),
  };
}
