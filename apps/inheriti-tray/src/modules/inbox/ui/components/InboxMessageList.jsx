import { useState } from 'react';
import { LockIcon, PlusIcon } from '../../../_shared/ui/components/Icons.jsx';
import { getInboxMessageState, useInboxMessageState } from '../hooks/useInboxMessageState.js';
import { InboxSkeleton } from './InboxSkeleton.jsx';
import { InboxRevealProgress } from './InboxRevealProgress.jsx';
import { INBOX_MESSAGE_EXPIRY_DAYS, INBOX_REVEAL_SECONDS } from '../inboxSettings.js';

function MessageCard({ message, name, own, names, revealed, revealSeconds, openingMessageId, transfer, busy, onView, onSaveFile, onHide, onRetryAck, onCancelTransfer }) {
  const [confirm, setConfirm] = useState(false);
  const state = useInboxMessageState(message, own);
  const isFile = message.contentKind === 'FILE';
  const visible = !own && revealed?.messageId === message.id;
  const opening = !own && openingMessageId === message.id;
  const hasOpenedContent = visible && (revealed.text || revealed.fileName);
  const displayState = opening ? { kind: 'opening', label: 'Opening' }
    : hasOpenedContent ? { kind: 'revealed', label: isFile ? 'Saved' : 'Revealed' } : state;
  const action = isFile ? onSaveFile : onView;
  const label = isFile ? 'Save file once' : 'View once';
  const time = new Date(message.createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  return <article className={`inbox-thread-message ${own ? 'is-own' : ''} ${opening ? 'is-opening' : ''}`}>
    {!own && <span className="inbox-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>}
    <div className="inbox-thread-message-content"><small>{own ? 'You' : name} · {time}</small>
      <div className="inbox-message-bubble">
        <div className="inbox-message-heading"><span className={`inbox-status inbox-status-${displayState.kind}`}>{displayState.label}</span><small>{isFile ? 'Protected file' : 'Protected message'}</small></div>
        {visible ? <div className="inbox-reveal">
          {revealed.fileName && <p className="inbox-revealed">Saved {revealed.fileName} to your chosen location.</p>}
          {revealed.text && <><p className="inbox-revealed">{revealed.text}</p><div className="inbox-reveal-timer" role="timer" aria-label={`Message hides in ${revealSeconds} ${revealSeconds === 1 ? 'second' : 'seconds'}`}><span className="inbox-progress-track"><span style={{ width: `${revealSeconds / INBOX_REVEAL_SECONDS * 100}%` }} /></span><span>Hides in {revealSeconds}s</span></div></>}
          {!revealed.text && !revealed.fileName && <p className="inbox-sealed-copy">Message hidden. Confirm the read to finish.</p>}
          {revealed.acknowledgement === 'PENDING' && <><p className="inbox-ack-pending" role="status">Read acknowledgement pending. Keep this window open and retry.</p><button type="button" className="button-secondary" disabled={!!busy} onClick={onRetryAck}>Retry acknowledgement</button></>}
          {(revealed.text || revealed.fileName) && <button type="button" className="button-secondary" onClick={onHide}>Hide now</button>}</div>
        : opening ? isFile ? <div className="inbox-opening" role="status"><span className="inbox-setup-spinner" aria-hidden="true" />Opening protected file…<span className={`inbox-progress-track ${transfer?.stage === 'DOWNLOADING' ? '' : 'is-indeterminate'}`}><span style={transfer?.stage === 'DOWNLOADING' ? { width: `${Math.min(100, Math.round(transfer.completed / Math.max(1, transfer.total) * 100))}%` } : undefined} /></span><small>{transfer?.stage === 'DOWNLOADING' ? `${transfer.completed} of ${transfer.total} encrypted shares` : 'Verifying on this device'}</small><button type="button" className="inbox-link" onClick={onCancelTransfer}>Cancel transfer</button></div>
          : <InboxRevealProgress />
        : state.canView ? confirm ? <div className="inbox-reveal-confirm"><p>{isFile ? 'Choose where to save this file. You can save it once.' : `Reveal this message once? It hides after ${INBOX_REVEAL_SECONDS} ${INBOX_REVEAL_SECONDS === 1 ? 'second' : 'seconds'}.`}</p><div><button type="button" className="button-secondary" onClick={() => setConfirm(false)}>Not now</button><button type="button" disabled={!!busy} onClick={() => { setConfirm(false); action(message.id); }}>{isFile ? 'Choose location' : 'Reveal now'}</button></div></div>
        : <button type="button" disabled={!!busy} onClick={() => setConfirm(true)}>{label}</button>
        : <p className="inbox-sealed-copy">{own ? state.label === 'Failed' ? 'This message could not be delivered.' : isFile ? 'File sealed for recipients.' : 'Message sealed for recipients.' : state.label === 'Read' ? 'This message has been opened.' : 'Encrypted content is unavailable.'}</p>}
      </div>
      {own && message.recipientStatuses?.length > 0 && <div className="inbox-recipient-statuses" aria-label="Recipient status">{message.recipientStatuses.map(recipient => {
        const complete = recipient.status === 'CONSUMED';
        const label = complete ? isFile ? 'saved' : 'revealed' : recipient.status === 'UNREAD' ? 'sealed' : recipient.status === 'LEASED' ? 'opening' : 'unavailable';
        return <span key={recipient.memberId} className={complete ? 'is-complete' : ''}><span className="inbox-recipient-dot" aria-hidden="true">{complete ? '✓' : ''}</span>{names[recipient.memberId] || 'Member'} · {label}</span>;
      })}</div>}
    </div>
  </article>;
}

export function InboxMessageList({ conversationId, messages, names, ownMemberId, revealed, revealSeconds, openingMessageId, onHide, onRetryAck, onRefresh, onView, onSaveFile, onSend, onSendFile, onCancelTransfer, transfer, draft, setDraft, busy }) {
  const unread = messages.filter((message) => getInboxMessageState(message, message.senderMemberId === ownMemberId).kind === 'unread').length;
  const shareProgress = transfer && (transfer.stage === 'UPLOADING' || transfer.stage === 'DOWNLOADING');
  const transferLabel = transfer?.stage === 'UPLOADING' ? 'Uploading encrypted shares' : transfer?.stage === 'DOWNLOADING' ? 'Downloading encrypted shares'
    : transfer?.stage === 'SPLITTING' ? 'Sealing file on this device' : transfer?.stage === 'RECONSTRUCTING' ? 'Opening file on this device'
      : busy === 'sending-file' ? 'Preparing protected file' : 'Opening protected file';
  return <section className="inbox-thread">
    <div className="tray-scroll inbox-thread-scroll">
      <div className="inbox-thread-notice"><LockIcon /><span>Messages are encrypted on your device. Each member can reveal a message once, then it’s gone.</span></div>
      <div className="inbox-thread-tools"><span>{unread} unread</span><button type="button" className="inbox-link" disabled={!!busy} onClick={() => onRefresh(conversationId)}>Refresh</button></div>
      {busy === 'loading' && <InboxSkeleton label="Loading messages…" kind="messages" />}
      {busy !== 'loading' && !messages.length && <p className="inbox-empty">No protected messages yet. Send the first one below.</p>}
      {messages.map((message) => <MessageCard key={message.id} message={message} name={names[message.senderMemberId] || 'Member'} names={names} own={message.senderMemberId === ownMemberId} revealed={revealed} revealSeconds={revealSeconds} openingMessageId={openingMessageId} transfer={transfer} busy={busy} onView={onView} onSaveFile={onSaveFile} onHide={onHide} onRetryAck={onRetryAck} onCancelTransfer={onCancelTransfer} />)}
    </div>
    {(busy === 'sending' || (busy === 'sending-file' && transfer)) && <div className="inbox-send-status" role="status">
      <span className="inbox-setup-spinner" aria-hidden="true" />
      <span>{busy === 'sending' ? 'Sealing and sending message…' : `${transferLabel}${shareProgress ? ` · ${transfer.completed} of ${transfer.total} shares` : ''}`}</span>
      {busy === 'sending-file' && <button type="button" className="inbox-link" onClick={onCancelTransfer}>Cancel</button>}
      {busy === 'sending-file' && <span className={`inbox-progress-track ${shareProgress ? '' : 'is-indeterminate'}`}><span style={shareProgress ? { width: `${Math.min(100, Math.round(transfer.completed / Math.max(1, transfer.total) * 100))}%` } : undefined} /></span>}
    </div>}
    <form className="inbox-thread-composer" onSubmit={onSend}>
      <label htmlFor="inbox-draft" className="sr-only">Write a protected message</label>
      <div><button type="button" className="button-secondary inbox-attach" aria-label="Attach a file up to 10 MB" title="Attach a file up to 10 MB" disabled={!!busy} onClick={onSendFile}><PlusIcon /></button><textarea id="inbox-draft" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={10000} rows={2} placeholder="Write a protected message" disabled={!!busy} /><button type="submit" disabled={!draft.trim() || !!busy}>Send</button></div>
      <small>Each member can reveal once. Unopened messages and files expire in {INBOX_MESSAGE_EXPIRY_DAYS} {INBOX_MESSAGE_EXPIRY_DAYS === 1 ? 'day' : 'days'}.</small>
    </form>
  </section>;
}
