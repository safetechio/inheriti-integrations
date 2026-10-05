import { useRef } from 'react';
import { ChevronDownIcon, LockIcon, PlanIcon, PlusIcon } from '../../../_shared/ui/components/Icons.jsx';
import { draftSegments } from '../hooks/inboxDraft.js';
import { useComposerDrawer } from '../hooks/useComposerDrawer.js';
import { useComposerSelection } from '../hooks/useComposerSelection.js';
import { INBOX_MESSAGE_EXPIRY_DAYS } from '../inboxSettings.js';

export function InboxComposer({ mode, setMode, draft, setDraft, marks = [], onMark = () => {}, onUnmark = () => {}, onSend, onSendFile, onCreatePlanFromSecret, sendError, busy }) {
  const { collapsed, setCollapsed, height, startDrag, moveDrag, stopDrag, resizeWithKeys } = useComposerDrawer();
  const { input, editor, menu, setMenu, openMenu, actOnSelection, toPlan } = useComposerSelection({ mode, busy, marks, draft, onCreatePlanFromSecret });
  const highlight = useRef(null);
  const mixed = mode === 'NORMAL' && marks.length > 0;
  const preview = draftSegments(draft, marks, mode);
  const editorKeys = event => {
    if (event.key === 'Escape') setMenu(null);
    if (event.shiftKey && event.key === 'F10') openMenu(event);
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    event.preventDefault();
    if (draft.trim() && !busy) event.currentTarget.form.requestSubmit();
  };
  return <form className="inbox-thread-composer" onSubmit={onSend}>
    <div className="inbox-composer-handle" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag}>
      <span role="separator" aria-label="Resize composer" aria-orientation="horizontal" aria-valuemin={150} aria-valuemax={typeof window === 'undefined' ? 420 : Math.min(420, Math.round(window.innerHeight * .55))} aria-valuenow={height ?? 230} tabIndex={0} onKeyDown={resizeWithKeys} />
      <button type="button" aria-label={collapsed ? 'Expand composer' : 'Collapse composer'} aria-expanded={!collapsed} aria-controls="inbox-composer-body" onClick={() => setCollapsed(value => !value)}><ChevronDownIcon /></button>
    </div>
    <div id="inbox-composer-body" className="inbox-composer-body" hidden={collapsed} style={height && !collapsed ? { height } : undefined}>
      <div className="inbox-mode" role="group" aria-label="Message mode"><button type="button" aria-pressed={mode === 'NORMAL'} onClick={() => { setMenu(null); setMode('NORMAL'); }}>Normal message</button><button type="button" aria-pressed={mode === 'PROTECTED'} onClick={() => { setMenu(null); setMode('PROTECTED'); }}><LockIcon /> Protected message</button></div>
      <label className="sr-only" htmlFor="inbox-draft">{mode === 'PROTECTED' ? 'Protected message' : mixed ? 'Mixed message' : 'Normal message'}</label>
      <div className="inbox-composer-input"><div className="inbox-editor" ref={editor}>
        {menu && <div className="inbox-composer-menu" role="menu" style={{ left: menu.x }} onKeyDown={event => { if (event.key === 'Escape') { setMenu(null); input.current.focus(); } }}>
          {menu.start < menu.end && <button type="button" role="menuitem" onMouseDown={event => event.preventDefault()} onClick={() => actOnSelection(onMark)}><LockIcon /> Make this secret</button>}
          {menu.canUnmark && <button type="button" role="menuitem" onMouseDown={event => event.preventDefault()} onClick={() => actOnSelection(onUnmark)}>Unmark secret</button>}
          {menu.start < menu.end && onCreatePlanFromSecret && <button type="button" role="menuitem" onMouseDown={event => event.preventDefault()} onClick={toPlan}><PlanIcon /> Transform to a plan</button>}
        </div>}
        <div className="inbox-editor-field">{mixed && <div ref={highlight} className="inbox-editor-highlight" aria-hidden="true">{preview.map((segment, index) => 'text' in segment
          ? <span key={index}>{segment.text}</span> : <span key={index} className="is-secret">{segment.protectedText}</span>)}</div>}
          <textarea ref={input} id="inbox-draft" className={mixed ? 'has-marks' : undefined} value={draft} onChange={event => { setMenu(null); setDraft(event.target.value); }} onScroll={event => { if (highlight.current) highlight.current.scrollTop = event.currentTarget.scrollTop; }} onContextMenu={openMenu} onKeyDown={editorKeys} maxLength={10000} rows={2} placeholder={mode === 'NORMAL' ? 'Write a message' : 'Write a protected message'} disabled={!!busy} /></div>
        {mode === 'NORMAL' && <div className="inbox-mark-hint">Right-click selected text to make it secret or unmark it</div>}</div>
        <div className="inbox-composer-actions"><button type="button" className="button-secondary inbox-attach" aria-label="Attach a protected file up to 10 MB" title="Attach a protected file up to 10 MB" disabled={!!busy} onClick={onSendFile}><PlusIcon /></button><button type="submit" disabled={!draft.trim() || !!busy}>Send</button></div></div>
      <div className="inbox-composer-preview"><strong>Recipients see:</strong> <span>{draft.trim() ? preview.map((segment, index) => 'text' in segment
        ? <span key={index}>{segment.text}</span>
        : <span key={index} className="inbox-preview-secret" aria-label="Protected text">{'•'.repeat(Math.min(20, segment.protectedText.length))}</span>) : 'Your message will appear here'}</span></div>
      {sendError && <p className="inbox-error error" role="alert">{sendError}</p>}
      <small>Unopened messages and files expire in {INBOX_MESSAGE_EXPIRY_DAYS} days.</small>
    </div>
  </form>;
}
