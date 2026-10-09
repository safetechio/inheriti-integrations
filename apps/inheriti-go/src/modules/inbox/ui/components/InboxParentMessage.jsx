import { useState } from 'react';
import { INBOX_REVEAL_SECONDS } from '../inboxSettings.js';
import { ProtectedPart } from './ProtectedPart.jsx';
import { InboxRevealProgress } from './InboxRevealProgress.jsx';
import { InboxAvatar } from './InboxAvatar.jsx';

export function InboxParentMessage({ message, name, avatarUrl, own, units, now, openingUnitId, openingProgress, summary, busy, onReveal, onRevealAll, onRetry, onHide, onCreatePlanFromSecret }) {
  const [confirmUnitId, setConfirmUnitId] = useState(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [selectedPartId, setSelectedPartId] = useState(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const parts = message.segments.filter(segment => 'unitId' in segment);
  const available = parts.filter(part => part.status === 'UNREAD' && !units.get(part.unitId));
  const opened = parts.filter(part => units.get(part.unitId)?.text && units.get(part.unitId).hideAt > now);
  const nextToHide = opened.reduce((next, part) => !next || units.get(part.unitId).hideAt < units.get(next.unitId).hideAt ? part : next, null);
  const remaining = nextToHide ? Math.max(0, Math.ceil((units.get(nextToHide.unitId).hideAt - now) / 1000)) : 0;
  const pending = parts.filter(part => units.get(part.unitId)?.acknowledgement === 'PENDING');
  const time = new Date(message.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const selectedPart = opened.find(part => part.unitId === selectedPartId) ?? opened[0];
  const selectedIndex = opened.indexOf(selectedPart);
  const revealed = selectedPart && units.get(selectedPart.unitId);
  const partActions = selectedPart && <span className="inbox-parent-part-actions">
    {revealed.suggestion && onCreatePlanFromSecret && <button type="button" className={opened.length > 1 ? 'inbox-action-link' : 'button-secondary'} aria-label={`Create plan from protected part ${parts.indexOf(selectedPart) + 1}`} onClick={() => { onCreatePlanFromSecret(revealed.suggestion); onHide(selectedPart.unitId); }}>Create plan from secret</button>}
    <button type="button" className={opened.length > 1 ? 'inbox-action-link' : 'button-secondary'} aria-label={`Hide protected part ${parts.indexOf(selectedPart) + 1} now`} onClick={() => onHide(selectedPart.unitId)}>{opened.length > 1 ? 'Hide' : 'Hide now'}</button>
  </span>;
  return <article className={`inbox-thread-message ${own ? 'is-own' : ''}`}>
    {!own && <InboxAvatar name={name} url={avatarUrl} />}
    <div className="inbox-thread-message-content"><small>{own ? 'You' : name} · {time}</small>
      <div className="inbox-message-bubble inbox-parent-bubble"><div className="inbox-message-heading"><span className="inbox-parent-pill">{available.length ? 'Sealed' : opened.length ? 'Revealed' : 'Message'}</span><small>{message.mode === 'MIXED' ? 'Contains protected text' : message.mode === 'PROTECTED' ? 'Protected message' : 'Normal · Encrypted'}</small></div>
        <div className="inbox-parent-text">{message.segments.map((segment, index) => 'text' in segment
          ? <span key={`text-${index}`}>{segment.text}</span>
          : <ProtectedPart key={segment.unitId} part={segment} ordinal={parts.findIndex(part => part.unitId === segment.unitId) + 1} revealed={units.get(segment.unitId)} now={now}
              busy={busy} opening={openingUnitId === segment.unitId} onConfirm={() => setConfirmUnitId(segment.unitId)} />)}</div>
        {parts.some(part => part.unitId === openingUnitId) && <InboxRevealProgress progress={openingProgress} showBar={!opened.length} />}
        {confirmUnitId && <div className="inbox-reveal-confirm"><p>Reveal this part once? It hides after {INBOX_REVEAL_SECONDS} seconds.</p><div><button type="button" className="button-secondary" onClick={() => setConfirmUnitId(null)}>Not now</button><button type="button" disabled={!!busy} onClick={() => { const unitId = confirmUnitId; setConfirmUnitId(null); void onReveal(message.parentId, unitId, { current: parts.findIndex(part => part.unitId === unitId) + 1, total: parts.length }); }}>Reveal now</button></div></div>}
        {available.length > 0 && !confirmUnitId && <small className="inbox-sealed-hint">Tap the blurred text to reveal.</small>}
        {nextToHide && <div className="inbox-parent-action"><div role="timer" className="inbox-reveal-timer"><span className="inbox-progress-track"><span style={{ width: `${remaining / INBOX_REVEAL_SECONDS * 100}%` }} /></span><span>{opened.length > 1 ? 'Next hides' : 'Hides'} in {remaining}s</span></div></div>}
        {(opened.length > 0 || available.length > 1 && !confirmAll) && <div className="inbox-parent-actions">
          {opened.length > 1 && <div className="inbox-parent-action-row"><button type="button" className="inbox-action-link" onClick={() => opened.forEach(part => onHide(part.unitId))}>Hide all</button><button type="button" className="inbox-action-link" aria-expanded={optionsOpen} aria-controls={`inbox-options-${message.parentId}`} onClick={() => setOptionsOpen(value => !value)}>Options</button></div>}
          {opened.length > 1 ? <div id={`inbox-options-${message.parentId}`} className="inbox-parent-options" hidden={!optionsOpen}>
            <div className="inbox-option-selector"><button type="button" aria-label="Previous visible secret" disabled={selectedIndex === 0} onClick={() => setSelectedPartId(opened[selectedIndex - 1].unitId)}>‹</button><span aria-live="polite">Secret {parts.indexOf(selectedPart) + 1} of {parts.length}</span><button type="button" aria-label="Next visible secret" disabled={selectedIndex === opened.length - 1} onClick={() => setSelectedPartId(opened[selectedIndex + 1].unitId)}>›</button></div>
            {partActions}
          </div> : partActions}
          {available.length > 1 && !confirmAll && <button type="button" className="button-secondary" disabled={!!busy} onClick={() => setConfirmAll(true)}>Reveal all</button>}
        </div>}
        {pending.map(part => <div className="inbox-parent-action" key={part.unitId}><span role="status">Read acknowledgement pending for protected part {parts.indexOf(part) + 1}.</span><button type="button" className="button-secondary" disabled={!!busy} onClick={() => onRetry(part.unitId)}>Retry acknowledgement</button></div>)}
        {available.length > 1 && confirmAll && <div className="inbox-reveal-confirm"><p>Reveal {available.length} protected parts independently? Each can only be opened once.</p><div><button type="button" className="button-secondary" onClick={() => setConfirmAll(false)}>Not now</button><button type="button" disabled={!!busy} onClick={() => { setConfirmAll(false); void onRevealAll(message.parentId, available.map(part => part.unitId)); }}>Reveal all</button></div></div>}
        {summary?.parentId === message.parentId && <p role="status" className="inbox-reveal-summary">{summary.succeeded} revealed, {summary.failed} failed.</p>}
      </div>
    </div>
  </article>;
}
