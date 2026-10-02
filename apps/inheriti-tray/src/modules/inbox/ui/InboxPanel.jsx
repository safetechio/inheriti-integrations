import { useInboxPanel } from './hooks/useInboxPanel.js';
import { InboxMemberPicker } from './components/InboxMemberPicker.jsx';
import { InboxConversationList } from './components/InboxConversationList.jsx';
import { InboxMessageList } from './components/InboxMessageList.jsx';

const expiresInDays = 7;

export function InboxPanel({ onClose }) {
  const inbox = useInboxPanel(onClose, expiresInDays);
  return <main className="tray-screen inbox-panel">
    <header className="tray-screen-header tray-screen-heading">
      <button className="tray-back" type="button" aria-label="Close Secure Inbox" onClick={onClose}>←</button>
      <h1>Secure Inbox</h1>
    </header>
    <div className="tray-scroll inbox-content">
      {inbox.error && <p className="error" role="alert">{inbox.error}</p>}
      {inbox.busy === 'loading' && <p role="status">Loading Secure Inbox…</p>}
      <InboxMemberPicker query={inbox.participants.query} setQuery={inbox.participants.setQuery}
        onSearch={inbox.participants.search} participants={inbox.participants.items}
        memberId={inbox.participants.memberId} setMemberId={inbox.participants.setMemberId}
        onCreate={inbox.createConversation} busy={inbox.busy} />
      <InboxConversationList conversations={inbox.conversations.items}
        conversationId={inbox.messages.conversationId} names={inbox.participants.names}
        busy={inbox.busy} onRefresh={inbox.conversations.refresh} onSelect={inbox.messages.select} />
      {inbox.messages.conversationId && <InboxMessageList conversationId={inbox.messages.conversationId}
        messages={inbox.messages.items} names={inbox.participants.names} revealed={inbox.messages.revealed}
        onHide={inbox.messages.hide} onRetryAck={inbox.messages.retryAck} onRefresh={inbox.messages.select} onView={inbox.messages.view}
        onSend={inbox.messages.send} draft={inbox.messages.draft} setDraft={inbox.messages.setDraft} busy={inbox.busy}
        expiresInDays={expiresInDays} />}
    </div>
  </main>;
}
