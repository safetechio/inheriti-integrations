import { useState } from 'react';

export function useInboxConversationMembers({ conversation, ownMemberId, participants, names, busy, onChange }) {
  const [memberId, setMemberId] = useState('');
  const creator = ownMemberId && ownMemberId === conversation.creatorMemberId;
  const available = participants.items.filter((item) => !conversation.participantMemberIds.includes(item.memberId));

  async function add(event) {
    event.preventDefault();
    if (!memberId || busy) return;
    if (await onChange(conversation, 'ADD', memberId)) setMemberId('');
  }

  function remove(id) {
    if (busy) return;
    const name = names[id] || id;
    if (!window.confirm(`Remove ${name} from this conversation? Their unread messages and pending access will be permanently lost. Messages they already saved cannot be revoked.`)) return;
    onChange(conversation, 'REMOVE', id);
  }

  return { memberId, setMemberId, creator, available, add, remove };
}
