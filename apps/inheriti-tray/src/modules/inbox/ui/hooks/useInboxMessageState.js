export function getInboxMessageState(message, own = false) {
  if (own) {
    if (message.status === 'PREPARING') return { label: 'Preparing', kind: 'pending', canView: false };
    if (message.status === 'FAILED') return { label: 'Failed', kind: 'muted', canView: false };
    if (Date.parse(message.expiresAt) <= Date.now() || message.status === 'DELETING') return { label: 'Expired', kind: 'muted', canView: false };
    return { label: 'Sent', kind: 'sent', canView: false };
  }
  if (message.recipientStatus === 'CONSUMED') return { label: 'Read', kind: 'muted', canView: false };
  if (Date.parse(message.expiresAt) <= Date.now() || message.recipientStatus === 'EXPIRED') return { label: 'Expired', kind: 'muted', canView: false };
  if (message.status === 'PREPARING') return { label: 'Pending', kind: 'pending', canView: false };
  if (message.status !== 'AVAILABLE') return { label: 'Unavailable', kind: 'muted', canView: false };
  if (message.recipientStatus === 'LEASED') return { label: 'Opening', kind: 'pending', canView: false };
  if (message.recipientStatus !== 'UNREAD') return { label: 'Unavailable', kind: 'muted', canView: false };
  return { label: 'Unread', kind: 'unread', canView: true };
}

export function useInboxMessageState(message, own) {
  return getInboxMessageState(message, own);
}
