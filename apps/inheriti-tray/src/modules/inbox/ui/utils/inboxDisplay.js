export function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase();
}

export function conversationMemberNames(conversation, names, ownMemberId) {
  return conversation?.participantMemberIds.filter((id) => id !== ownMemberId)
    .map((id) => names[id] || 'Member') || [];
}

export function conversationTitle(memberNames) {
  return memberNames.length > 2
    ? `${memberNames.slice(0, 2).join(', ')} +${memberNames.length - 2}`
    : memberNames.join(', ') || 'Conversation';
}

export function conversationPreview(latest, ownMemberId) {
  if (!latest) return 'No messages yet';
  const kind = latest.contentKind === 'FILE' ? 'Protected file' : 'Sealed message';
  return latest.senderMemberId === ownMemberId ? `You: ${kind}` : kind;
}

export function messageTime(value) {
  if (!value) return '';
  const sent = new Date(value);
  if (Number.isNaN(sent.getTime())) return '';
  const sameDay = sent.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat(undefined, sameDay
    ? { hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric' }).format(sent);
}
