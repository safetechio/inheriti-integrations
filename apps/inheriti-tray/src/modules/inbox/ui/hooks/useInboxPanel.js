import { useEffect, useRef, useState } from 'react';
import { useInboxParticipants } from './useInboxParticipants.js';
import { useInboxConversations } from './useInboxConversations.js';
import { useInboxMessages } from './useInboxMessages.js';

export function useInboxPanel(onClose, identity) {
  const participants = useInboxParticipants();
  const conversations = useInboxConversations();
  const messages = useInboxMessages(onClose);
  const [toast, setToast] = useState(null);
  const refresh = useRef(null);
  refresh.current = (signal) => {
    if (signal?.kind === 'NEW_MESSAGE') {
      setToast({ kind: 'info', message: 'A protected message is ready.' });
      return;
    }
    if (signal?.recipientStatus === 'CONSUMED' && signal.senderMemberId === identity?.memberId &&
      signal.memberId !== identity?.memberId) {
      setToast({ kind: 'info', message: 'A member opened your message.' });
    }
    if (!signal || signal.kind === 'PARTICIPANTS' || signal.kind === 'CONVERSATIONS') void participants.refresh();
    if (signal?.kind === 'PARTICIPANTS') return;
    void conversations.refresh();
    if (!signal || ('conversationId' in signal && signal.conversationId === messages.conversationId)) void messages.refresh();
  };
  useEffect(() => window.inheritiTray.onInboxChanged((signal) => refresh.current?.(signal)), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  const busy = participants.busy || conversations.busy || messages.busy;
  const error = messages.error || conversations.error || participants.error;

  async function createConversation(event) {
    event.preventDefault();
    if (participants.memberIds.length < 1 || participants.memberIds.length > 49 || busy) return;
    const conversation = await conversations.create(participants.memberIds);
    if (!conversation) return;
    participants.setMemberIds([]);
    await messages.select(conversation.id);
    return conversation;
  }

  return { participants, conversations, messages, identity, busy, error, toast, createConversation };
}
