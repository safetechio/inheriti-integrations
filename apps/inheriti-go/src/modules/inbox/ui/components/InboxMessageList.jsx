import { useLayoutEffect, useRef, useState } from 'react';
import { InboxComposer } from './InboxComposer.jsx';
import { ClockIcon } from '../../../_shared/ui/components/Icons.jsx';
import { InboxParentMessage } from './InboxParentMessage.jsx';
import { useInboxMessageState } from '../hooks/useInboxMessageState.js';
import { InboxSkeleton } from './InboxSkeleton.jsx';
import { InboxRevealProgress } from './InboxRevealProgress.jsx';
import { InboxAvatar } from './InboxAvatar.jsx';
import { INBOX_REVEAL_SECONDS } from '../inboxSettings.js';


function NormalMessageCard({ message, name, avatarUrl, own }) {
  const time = new Date(message.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return <article className={`inbox-thread-message ${own ? 'is-own' : ''}`}>
    {!own && <InboxAvatar name={name} url={avatarUrl} />}
    <div className="inbox-thread-message-content"><small>{own ? 'You' : name} · {time}</small>
      <div className="inbox-message-bubble"><div className="inbox-message-heading"><span className="inbox-parent-pill">Normal</span><small>Message</small></div>
        <p className="inbox-revealed">{message.text}</p></div></div>
  </article>;
}

function MessageCard({ message, name, avatarUrl, own, names, revealed, revealSeconds, openingMessageId, transfer, busy, onView, onSaveFile, onSaveFileAsPlan, onCreatePlanFromFile, onHide, onRetryAck, onCancelTransfer, onCreatePlanFromSecret }) {
  const [confirm, setConfirm] = useState(false);
  const state = useInboxMessageState(message, own);
  const isFile = message.contentKind === 'FILE';
  const visible = !own && revealed?.messageId === message.id;
  const opening = !own && openingMessageId === message.id;
  const hasOpenedContent = visible && (revealed.text || revealed.fileName);
  const displayState = opening ? { kind: 'opening', label: 'Opening' }
    : hasOpenedContent ? { kind: 'revealed', label: isFile ? 'Saved' : 'Revealed' } : state;
  const action = isFile ? onSaveFile : onView;
  const label = isFile ? 'Open file once' : 'View once';
  const time = new Date(message.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return <article className={`inbox-thread-message ${own ? 'is-own' : ''} ${opening ? 'is-opening' : ''}`}>
    {!own && <InboxAvatar name={name} url={avatarUrl} />}
    <div className="inbox-thread-message-content"><small>{own ? 'You' : name} · {time}</small>
      <div className="inbox-message-bubble">
        <div className="inbox-message-heading"><span className={`inbox-status inbox-status-${displayState.kind}`}>{displayState.label}</span><small>{isFile ? 'Protected file' : 'Protected message'}</small></div>
        {visible ? <div className="inbox-reveal">
          {revealed.fileName && <p className="inbox-revealed">Saved {revealed.fileName} to your chosen location.</p>}
          {revealed.text && <><p className="inbox-revealed">{revealed.text}</p><div className="inbox-reveal-timer" role="timer" aria-label={`Message hides in ${revealSeconds} ${revealSeconds === 1 ? 'second' : 'seconds'}`}><span className="inbox-progress-track"><span style={{ width: `${revealSeconds / INBOX_REVEAL_SECONDS * 100}%` }} /></span><span>Hides in {revealSeconds}s</span></div></>}
          {revealed.text && revealed.suggestion && onCreatePlanFromSecret && <button type="button" className="button-secondary" onClick={() => { onCreatePlanFromSecret(revealed.suggestion); onHide(); }}>Create plan from secret</button>}
          {!revealed.text && !revealed.fileName && <p className="inbox-sealed-copy">{revealed.planAcknowledged ? 'File ready for Quick Plan.' : revealed.planPending ? 'File ready for Quick Plan. Confirm the read to continue.' : 'Message hidden. Confirm the read to finish.'}</p>}
          {revealed.acknowledgement === 'PENDING' && <><p className="inbox-ack-pending" role="status">{revealed.planAcknowledged ? 'Continue to Quick Plan when ready.' : 'Read acknowledgement pending. Keep this window open and retry.'}</p><button type="button" className="button-secondary" disabled={!!busy && busy !== 'plan-pending'} onClick={onRetryAck}>{revealed.planAcknowledged ? 'Continue to plan' : 'Retry acknowledgement'}</button></>}
          {(revealed.text || revealed.fileName) && <button type="button" className="button-secondary" onClick={onHide}>Hide now</button>}</div>
        : opening ? isFile ? <div className="inbox-opening" role="status"><span className="inbox-setup-spinner" aria-hidden="true" />Opening protected file…<span className={`inbox-progress-track ${transfer?.stage === 'DOWNLOADING' ? '' : 'is-indeterminate'}`}><span style={transfer?.stage === 'DOWNLOADING' ? { width: `${Math.min(100, Math.round(transfer.completed / Math.max(1, transfer.total) * 100))}%` } : undefined} /></span><small>{transfer?.stage === 'DOWNLOADING' ? `${transfer.completed} of ${transfer.total} encrypted shares` : 'Verifying on this computer'}</small><button type="button" className="inbox-link" onClick={onCancelTransfer}>Cancel transfer</button></div>
          : <InboxRevealProgress />
        : state.canView ? confirm ? <div className="inbox-reveal-confirm"><p>{isFile ? 'Open this file once. Save it to your computer or make a Quick Plan.' : `Reveal this message once? It hides after ${INBOX_REVEAL_SECONDS} ${INBOX_REVEAL_SECONDS === 1 ? 'second' : 'seconds'}.`}</p><div><button type="button" className="button-secondary" onClick={() => setConfirm(false)}>Not now</button>{isFile && onSaveFileAsPlan && <button type="button" disabled={!!busy} onClick={() => { setConfirm(false); onSaveFileAsPlan(message.id, onCreatePlanFromFile); }}>Save as a plan</button>}<button type="button" disabled={!!busy} onClick={() => { setConfirm(false); action(message.id); }}>{isFile ? 'Choose location' : 'Reveal now'}</button></div></div>
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

export function InboxMessageList({ conversationId, messages, normalMessages = [], normalUnreadCount = 0, parentMessages = [], parentUnreadCount = 0, unitReveals,
  mode = 'PROTECTED', setMode = () => {}, marks = [], onMark = () => {}, onUnmark = () => {},
  names, avatars = {}, ownMemberId, revealed, revealSeconds, openingMessageId, onHide, onRetryAck, onRefresh, onView, onSaveFile,
  onSend, onSendFile, onCancelTransfer, onCreatePlanFromSecret, onCreatePlanFromFile, onSaveFileAsPlan, transfer, draft, setDraft, sendError, busy, pendingMessage, acceptedMessages = [] }) {
  const scroll = useRef(null);
  const previous = useRef({ conversationId: '', newestMessageId: '' });
  const parentIds = new Set(parentMessages.map(message => message.parentId));
  const ordered = messages.map(message => ({ kind: 'PROTECTED', id: message.id, message }))
    .concat(normalMessages.filter(message => !parentIds.has(message.parentId)).map(message => ({ kind: 'NORMAL', id: message.parentId, message })))
    .concat(parentMessages.map(message => ({ kind: 'PARENT', id: message.parentId, message })))
    .sort((a, b) => new Date(a.message.createdAt) - new Date(b.message.createdAt) || a.id.localeCompare(b.id));
  const pendingMessages = [...acceptedMessages, ...(pendingMessage ? [pendingMessage] : [])]
    .filter(message => message.conversationId === conversationId && !ordered.some(item => item.id === message.parentId));
  const newestMessageId = pendingMessages.at(-1)?.parentId || ordered.at(-1)?.id || '';
  useLayoutEffect(() => {
    const panel = scroll.current;
    if (!panel || !newestMessageId) {
      previous.current = { conversationId, newestMessageId };
      return;
    }
    const smooth = previous.current.conversationId === conversationId && previous.current.newestMessageId &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    panel.scrollTo({ top: panel.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
    previous.current = { conversationId, newestMessageId };
  }, [conversationId, newestMessageId]);
  const unread = parentUnreadCount + normalUnreadCount;
  const shareProgress = transfer && (transfer.stage === 'UPLOADING' || transfer.stage === 'DOWNLOADING');
  const transferLabel = transfer?.stage === 'UPLOADING' ? 'Uploading encrypted shares' : transfer?.stage === 'DOWNLOADING' ? 'Downloading encrypted shares'
    : transfer?.stage === 'SPLITTING' ? 'Sealing file on this computer' : transfer?.stage === 'RECONSTRUCTING' ? 'Opening file on this computer'
      : busy === 'sending-file' ? 'Preparing protected file' : 'Opening protected file';
  return <section className="inbox-thread">
    <div className="inbox-thread-tools"><span>{unread} unread</span><button type="button" className="inbox-link" disabled={!!busy} onClick={() => onRefresh(conversationId)}>Refresh</button></div>
    <div ref={scroll} className="tray-scroll inbox-thread-scroll">
      {busy === 'loading' && <InboxSkeleton label="Loading messages…" kind="messages" />}
      {busy !== 'loading' && !ordered.length && !pendingMessages.length && <p className="inbox-empty">No messages yet. Send the first one below.</p>}
      {ordered.map(({ kind, id, message }) => kind === 'PARENT'
        ? <InboxParentMessage key={id} message={message} name={names[message.senderMemberId] || 'Member'} avatarUrl={avatars[message.senderMemberId]} own={message.senderMemberId === ownMemberId}
            units={unitReveals?.units || new Map()} now={unitReveals?.now || Date.now()} openingUnitId={unitReveals?.openingUnitId || ''} openingProgress={unitReveals?.openingProgress}
            summary={unitReveals?.summary} busy={busy} onReveal={unitReveals?.reveal} onRevealAll={unitReveals?.revealAll} onRetry={unitReveals?.retry} onHide={unitReveals?.hide} onCreatePlanFromSecret={onCreatePlanFromSecret} />
        : kind === 'NORMAL' ? <NormalMessageCard key={id} message={message} name={names[message.senderMemberId] || 'Member'} avatarUrl={avatars[message.senderMemberId]} own={message.senderMemberId === ownMemberId} />
        : <MessageCard key={id} message={message} name={names[message.senderMemberId] || 'Member'} avatarUrl={avatars[message.senderMemberId]} names={names} own={message.senderMemberId === ownMemberId} revealed={revealed} revealSeconds={revealSeconds} openingMessageId={openingMessageId} transfer={transfer} busy={busy} onView={onView} onSaveFile={onSaveFile} onSaveFileAsPlan={onSaveFileAsPlan} onCreatePlanFromFile={onCreatePlanFromFile} onHide={onHide} onRetryAck={onRetryAck} onCancelTransfer={onCancelTransfer} onCreatePlanFromSecret={onCreatePlanFromSecret} />)}
      {pendingMessages.map(pendingMessage =>
        <article key={pendingMessage.parentId || 'pending'} className="inbox-thread-message is-own inbox-pending-message" aria-live="polite">
          <div className="inbox-thread-message-content"><small>You · {pendingMessage.status === 'failed' ? 'Failed' : pendingMessage.status === 'sent' ? 'Sent' : 'Sending'}</small>
            <div className="inbox-message-bubble"><div className="inbox-message-heading"><span className="inbox-parent-pill">{pendingMessage.protectedSend ? 'Protected' : 'Normal'}</span><small className="inbox-pending-status">{pendingMessage.status === 'sending' && <ClockIcon />}{pendingMessage.status === 'failed' ? 'Not sent' : pendingMessage.status === 'sent' ? 'Syncing…' : 'Sending…'}</small></div>
              <p className="inbox-revealed">{pendingMessage.protectedSend ? 'Protected message' : pendingMessage.text}</p>
              {pendingMessage.protectedSend && pendingMessage.status === 'sending' && <div className="inbox-pending-footer" role="status">
                <small>{pendingMessage.completed === 0
                  ? `Sealing ${pendingMessage.total} protected ${pendingMessage.total === 1 ? 'part' : 'parts'}…`
                  : pendingMessage.completed < pendingMessage.total
                    ? `Sealing protected text ${pendingMessage.completed + 1}/${pendingMessage.total}` : 'Publishing protected message…'}</small>
                <span className="inbox-progress-track is-indeterminate" aria-hidden="true"><span /></span>
              </div>}
              {pendingMessage.status === 'failed' && <button type="button" className="button-secondary" disabled={!!busy} onClick={onSend}>Retry</button>}
            </div></div>
        </article>)}
    </div>
    {busy === 'sending-file' && transfer && <div className="inbox-send-status" role="status">
      <span className="inbox-setup-spinner" aria-hidden="true" />
      <span>{transferLabel}{shareProgress ? ` · ${transfer.completed} of ${transfer.total} shares` : ''}</span>
      <button type="button" className="inbox-link" onClick={onCancelTransfer}>Cancel</button>
      <span className={`inbox-progress-track ${shareProgress ? '' : 'is-indeterminate'}`}><span style={shareProgress ? { width: `${Math.min(100, Math.round(transfer.completed / Math.max(1, transfer.total) * 100))}%` } : undefined} /></span>
    </div>}
    <InboxComposer mode={mode} setMode={setMode} draft={draft} setDraft={setDraft} marks={marks} onMark={onMark} onUnmark={onUnmark} sendError={sendError}
      onSend={onSend} onSendFile={onSendFile} onCreatePlanFromSecret={onCreatePlanFromSecret} busy={busy} />
  </section>;
}
