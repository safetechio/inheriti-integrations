export function InboxConversationList({ conversations, conversationId, names, busy, onRefresh, onSelect }) {
  const nameFor = (id) => names[id] || id;
  return <section>
    <h2>Conversations</h2>
    <button type="button" className="button-secondary" disabled={!!busy} onClick={onRefresh}>Refresh conversations</button>
    {!busy && !conversations.length && <p>No conversations yet.</p>}
    <div className="inbox-list">{conversations.map((conversation) => <button type="button" className="button-secondary"
      aria-current={conversationId === conversation.id ? 'true' : undefined} key={conversation.id}
      onClick={() => onSelect(conversation.id)} disabled={!!busy}>
      {conversation.participantMemberIds.map(nameFor).join(', ')}
    </button>)}</div>
  </section>;
}
