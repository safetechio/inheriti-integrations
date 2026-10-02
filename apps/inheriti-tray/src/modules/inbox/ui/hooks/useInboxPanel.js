import { useInboxParticipants } from './useInboxParticipants.js';
import { useInboxConversations } from './useInboxConversations.js';
import { useInboxMessages } from './useInboxMessages.js';

export function useInboxPanel(onClose, expiresInDays) {
  const participants = useInboxParticipants();
  const conversations = useInboxConversations();
  const messages = useInboxMessages(onClose, expiresInDays);
  const busy = participants.busy || conversations.busy || messages.busy;
  const error = messages.error || conversations.error || participants.error;

  async function createConversation(event) {
    event.preventDefault();
    if (!participants.memberId || busy) return;
    const conversation = await conversations.create(participants.memberId);
    if (!conversation) return;
    participants.setMemberId('');
    await messages.select(conversation.id);
  }

  return { participants, conversations, messages, busy, error, createConversation };
}
