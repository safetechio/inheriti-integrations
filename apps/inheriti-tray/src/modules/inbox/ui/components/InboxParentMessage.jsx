import { useState } from 'react';
import { INBOX_REVEAL_SECONDS } from '../inboxSettings.js';
import { ProtectedPart } from './ProtectedPart.jsx';

export function InboxParentMessage({ message, name, own, units, now, openingUnitId, summary, busy, onReveal, onRevealAll, onRetry, onHide, onCreatePlanFromSecret }) {
  const [confirmUnitId, setConfirmUnitId] = useState(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const parts = message.segments.filter(segment => 'unitId' in segment);
  const available = parts.filter(part => part.status === 'UNREAD' && !units.get(part.unitId));
  const opened = parts.filter(part => units.get(part.unitId)?.text && units.get(part.unitId).hideAt > now);
  const pending = parts.filter(part => units.get(part.unitId)?.acknowledgement === 'PENDING');
  const time = new Date(message.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return <article className={`inbox-thread-message ${own ? 'is-own' : ''}`}>
    {!own && <span className="inbox-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>}
    <div className="inbox-thread-message-content"><small>{own ? 'You' : name} · {time}</small>
      <div className="inbox-message-bubble inbox-parent-bubble"><div className="inbox-message-heading"><span className="inbox-parent-pill">{available.length ? 'Sealed' : opened.length ? 'Revealed' : 'Message'}</span><small>{message.mode === 'MIXED' ? 'Contains protected text' : message.mode === 'PROTECTED' ? 'Protected message' : 'Normal · Encrypted'}</small></div>
        <div className="inbox-parent-text">{message.segments.map((segment, index) => 'text' in segment
          ? <span key={`text-${index}`}>{segment.text}</span>
          : <ProtectedPart key={segment.unitId} part={segment} revealed={units.get(segment.unitId)} now={now}
              busy={busy} opening={openingUnitId === segment.unitId} onConfirm={() => setConfirmUnitId(segment.unitId)} />)}</div>
        {confirmUnitId && <div className="inbox-reveal-confirm"><p>Reveal this part once? It hides after {INBOX_REVEAL_SECONDS} seconds.</p><div><button type="button" className="button-secondary" onClick={() => setConfirmUnitId(null)}>Not now</button><button type="button" disabled={!!busy} onClick={() => { const unitId = confirmUnitId; setConfirmUnitId(null); void onReveal(message.parentId, unitId); }}>Reveal now</button></div></div>}
        {available.length > 0 && !confirmUnitId && <small className="inbox-sealed-hint">Tap the blurred text to reveal.</small>}
        {opened.map(part => {
          const revealed = units.get(part.unitId);
          const remaining = Math.max(0, Math.ceil((revealed.hideAt - now) / 1000));
          return <div className="inbox-parent-action" key={part.unitId}><div role="timer" className="inbox-reveal-timer"><span className="inbox-progress-track"><span style={{ width: `${remaining / INBOX_REVEAL_SECONDS * 100}%` }} /></span><span>Hides in {remaining}s</span></div>
            {revealed.suggestion && onCreatePlanFromSecret && <button type="button" className="button-secondary" onClick={() => { onCreatePlanFromSecret(revealed.suggestion); onHide(part.unitId); }}>Create plan from secret</button>}
            <button type="button" className="button-secondary" onClick={() => onHide(part.unitId)}>Hide now</button></div>;
        })}
        {pending.map(part => <div className="inbox-parent-action" key={part.unitId}><span role="status">Read acknowledgement pending for protected part {part.position + 1}.</span><button type="button" className="button-secondary" disabled={!!busy} onClick={() => onRetry(part.unitId)}>Retry acknowledgement</button></div>)}
        {available.length > 1 && (confirmAll
          ? <div className="inbox-reveal-confirm"><p>Reveal {available.length} protected parts independently? Each can only be opened once.</p><div><button type="button" className="button-secondary" onClick={() => setConfirmAll(false)}>Not now</button><button type="button" disabled={!!busy} onClick={() => { setConfirmAll(false); void onRevealAll(message.parentId, available.map(part => part.unitId)); }}>Reveal all</button></div></div>
          : <button type="button" className="button-secondary" disabled={!!busy} onClick={() => setConfirmAll(true)}>Reveal all</button>)}
        {summary?.parentId === message.parentId && <p role="status">{summary.succeeded} revealed, {summary.failed} failed.</p>}
      </div>
    </div>
  </article>;
}
