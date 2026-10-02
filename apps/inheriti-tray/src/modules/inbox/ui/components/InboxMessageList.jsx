export function InboxMessageList({ conversationId, messages, names, revealed, onHide, onRefresh, onView, onSend, draft, setDraft, busy, expiresInDays }) {
  const nameFor = (id) => names[id] || id;
  return <section>
    <h2>Messages</h2>
    <button type="button" className="button-secondary" disabled={!!busy} onClick={() => onRefresh(conversationId)}>Refresh messages</button>
    {!busy && !messages.length && <p>No messages yet.</p>}
    <div className="inbox-list">{messages.map((message) => <article className="inbox-message" key={message.id}>
      <p>Protected message from {nameFor(message.senderMemberId)}</p>
      <small>{new Date(message.createdAt).toLocaleString()} · {message.status}</small>
      {revealed?.messageId === message.id
        ? <><p className="inbox-revealed">{revealed.text}</p><button type="button" className="button-secondary" onClick={onHide}>Hide</button></>
        : <button type="button" className="button-secondary" disabled={!!busy || message.status !== 'AVAILABLE'} onClick={() => onView(message.id)}>View</button>}
    </article>)}</div>
    <form onSubmit={onSend}>
      <label htmlFor="inbox-draft">Message</label>
      <textarea id="inbox-draft" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={10000} rows={3} disabled={!!busy} />
      <small>Messages expire after {expiresInDays} days.</small>
      <button type="submit" disabled={!draft.trim() || !!busy}>Send securely</button>
    </form>
  </section>;
}
