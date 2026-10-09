import { useEffect, useRef, useState } from 'react';
import { useInboxParticipants } from './useInboxParticipants.js';
import { useInboxConversations } from './useInboxConversations.js';
import { useInboxMessages } from './useInboxMessages.js';

let latestPresence = null;

export function rememberInboxPresence(signal) {
  if (signal?.kind !== 'PRESENCE') return null;
  latestPresence = { ...signal, receivedAt: performance.now() };
  return latestPresence;
}

export function currentInboxPresence() { return latestPresence; }
export function clearInboxPresence() { latestPresence = null; }

export function inboxPresenceStatus(presence, memberId, organizationId, elapsedMs) {
  if (!presence || presence.tenantId !== organizationId || !presence.connected ||
    !Array.isArray(presence.memberIds) || elapsedMs - presence.receivedAt > 45_000) return 'Unknown';
  return presence.memberIds.includes(memberId) ? 'Online' : 'Offline';
}

export function useInboxPanel(onClose, identity, organizationId) {
  const participants = useInboxParticipants();
  const conversations = useInboxConversations();
  const messages = useInboxMessages(onClose);
  const [toast, setToast] = useState(null);
  const [title, setTitle] = useState('');
  const [presence, setPresence] = useState(currentInboxPresence);
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const presenceStatus = (memberId) => inboxPresenceStatus(presence, memberId, organizationId, now);
  const refresh = useRef(null);
  refresh.current = (signal) => {
    if (signal?.kind === 'PRESENCE') {
      if (signal.tenantId === organizationId) {
        const current = rememberInboxPresence(signal);
        setPresence(current);
        setNow(current.receivedAt);
      }
      return;
    }
    if (signal?.kind === 'NEW_MESSAGE') {
      setToast({ kind: 'info', message: 'A new message is ready.' });
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
    if (!title.trim() || participants.memberIds.length < 1 || participants.memberIds.length > 49 || busy) return;
    const conversation = await conversations.create(title.trim(), participants.memberIds);
    if (!conversation) return;
    participants.setMemberIds([]);
    setTitle('');
    await messages.select(conversation.id);
    return conversation;
  }

  return { participants, conversations, messages, identity, busy, error, toast, title, setTitle, createConversation, presenceStatus };
}
