export function ProtectedPart({ part, ordinal, revealed, now, busy, opening, onConfirm }) {
  const opened = revealed?.text && revealed.hideAt > now;
  const pending = revealed?.acknowledgement === 'PENDING';
  const canReveal = part.status === 'UNREAD' && !revealed;
  if (opened) return <span className="inbox-inline-secret is-revealed">{revealed.text}</span>;
  if (opening) return <span className="inbox-inline-secret is-opening" aria-hidden="true">•••••••••••••</span>;
  if (canReveal) return <button type="button" className="inbox-sealed-trigger inbox-inline-secret" aria-label={`Reveal protected part ${ordinal}`} disabled={!!busy} onClick={onConfirm}><span aria-hidden="true">•••••••••••••</span></button>;
  const label = pending ? 'Read pending' : part.status === 'CONSUMED' ? 'Read' : part.status === 'EXPIRED' ? 'Expired' : part.status === 'FAILED' ? 'Failed' : 'Unavailable';
  if (label === 'Read' || label === 'Unavailable') return <span className="inbox-inline-secret inbox-inline-status is-spent" role="img" aria-label={label === 'Read' ? 'Read; this secret cannot be reopened' : 'Unavailable; this secret cannot be opened'}><span aria-hidden="true" /></span>;
  return <span className="inbox-inline-secret inbox-inline-status">[{label}]</span>;
}
