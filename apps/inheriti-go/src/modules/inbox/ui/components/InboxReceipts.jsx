import { useEffect, useRef, useState } from 'react';
import { InboxAvatar } from './InboxAvatar.jsx';

function date(value) {
  if (!value || Number.isNaN(new Date(value).getTime())) return '';
  return new Date(value).toLocaleString();
}

function shortDate(value) {
  if (!value || Number.isNaN(new Date(value).getTime())) return '';
  const when = new Date(value);
  return when.toDateString() === new Date().toDateString()
    ? when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : when.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
}

function ReceiptState({ label, at }) {
  return <span className="inbox-receipt-state"><span className="inbox-receipt-badge">{label}</span>{date(at) && <time dateTime={at}>{date(at)}</time>}</span>;
}

function ReceiptDetails({ recipient, protectedParts }) {
  const secrets = recipient.secrets || [];
  const legacyReveal = protectedParts === 1 && !recipient.secrets && recipient.status === 'CONSUMED';
  const revealed = secrets.filter(secret => secret.status === 'CONSUMED' || secret.revealedAt).length + (legacyReveal ? 1 : 0);
  const oneRevealAt = secrets[0]?.revealedAt || (legacyReveal ? recipient.consumedAt : null);
  return <span className="inbox-receipt-detail">
    {(recipient.readAt !== undefined || recipient.read !== undefined || !recipient.status) && <ReceiptState label={recipient.readAt || recipient.read ? 'Read' : 'Not read'} at={recipient.readAt} />}
    {protectedParts === 1 && <ReceiptState label={revealed ? 'Revealed' : 'Not revealed'} at={oneRevealAt} />}
    {protectedParts > 1 && <span>{revealed}/{protectedParts} protected parts revealed
      {[...secrets].sort((a, b) => a.position - b.position).map((secret, index) => <span key={secret.position} className="inbox-receipt-part">Part {index + 1} <ReceiptState label={secret.status === 'CONSUMED' || secret.revealedAt ? 'Revealed' : 'Not revealed'} at={secret.revealedAt} /></span>)}
    </span>}
  </span>;
}

export function InboxReceipts({ recipients, names, avatars, protectedParts = 0 }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef(null);
  const done = useRef(null);
  useEffect(() => {
    if (!open) return;
    done.current?.focus();
    const onKey = event => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key === 'Tab') { event.preventDefault(); done.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); trigger.current?.focus(); };
  }, [open]);
  if (!recipients?.length) return <div className="inbox-recipient-statuses" aria-label="Recipient status"><span className="inbox-receipt-compact">Sent</span></div>;
  const details = open && <div className="inbox-sheet" role="dialog" aria-modal="true" aria-label="Recipient status">
    <button type="button" className="inbox-sheet-backdrop" tabIndex={-1} aria-label="Close recipient status" onClick={() => setOpen(false)} />
    <div className="inbox-sheet-body"><div className="inbox-sheet-header"><h2>Recipient status</h2><button ref={done} type="button" className="inbox-link" onClick={() => setOpen(false)}>Done</button></div>
      <ul className="inbox-receipt-list">{recipients.map(recipient => { const name = names[recipient.memberId] || 'Member'; return <li key={recipient.memberId}><InboxAvatar name={name} url={avatars[recipient.memberId]} /><div className="inbox-receipt-person"><strong title={name}>{name}</strong><ReceiptDetails recipient={recipient} protectedParts={protectedParts} /></div></li>; })}</ul>
    </div>
  </div>;
  if (recipients.length === 1) {
    const recipient = recipients[0];
    const name = names[recipient.memberId] || 'Member';
    const read = shortDate(recipient.readAt);
    const secrets = recipient.secrets || [];
    const revealed = secrets.filter(secret => secret.status === 'CONSUMED' || secret.revealedAt);
    const legacyReveal = protectedParts === 1 && !recipient.secrets && recipient.status === 'CONSUMED';
    const revealAt = revealed[0]?.revealedAt || (legacyReveal ? recipient.consumedAt : null);
    const revealedCount = revealed.length + (legacyReveal ? 1 : 0);
    const readLabel = read ? `Read ${read}` : recipient.read ? 'Read' : legacyReveal ? '' : 'Sent';
    const revealLabel = protectedParts === 1
      ? revealedCount ? `Revealed${shortDate(revealAt) ? ` ${shortDate(revealAt)}` : ''}` : 'Not revealed'
      : protectedParts > 1 ? `${revealedCount}/${protectedParts} revealed` : '';
    return <div className="inbox-recipient-statuses" aria-label="Recipient status" title={[name, recipient.readAt && `Read ${date(recipient.readAt)}`, revealAt && `Revealed ${date(revealAt)}`].filter(Boolean).join(' · ')}>
      <span className="inbox-receipt-compact"><strong>{name}</strong>{protectedParts > 1
        ? <button ref={trigger} type="button" className="inbox-receipt-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>{[readLabel, revealLabel].filter(Boolean).join(' · ')} · Details</button>
        : <span>{[readLabel, revealLabel].filter(Boolean).join(' · ')}</span>}</span>
      {details}
    </div>;
  }
  const read = recipients.filter(recipient => recipient.readAt || recipient.read).length;
  const revealed = recipients.filter(recipient => recipient.status === 'CONSUMED' || recipient.secrets?.some(secret => secret.status === 'CONSUMED' || secret.revealedAt)).length;
  const hasReadReceipts = recipients.some(recipient => recipient.readAt !== undefined || recipient.read !== undefined);
  return <div className="inbox-recipient-statuses" aria-label="Recipient status">
    <button ref={trigger} type="button" className="inbox-receipt-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>{hasReadReceipts ? `${read}/${recipients.length} read${protectedParts ? ' · ' : ''}` : ''}{protectedParts ? `${revealed}/${recipients.length} revealed` : ''} · Details</button>
    {details}
  </div>;
}
