import { InboxSkeleton } from './InboxSkeleton.jsx';
import { conversationMemberNames, conversationPreview, conversationTitle, messageTime } from '../utils/inboxDisplay.js';
import { InboxAvatar } from './InboxAvatar.jsx';

export function InboxConversationList({ conversations, names, avatars = {}, ownMemberId, busy, onRefresh, onSelect }) {
  return <section className="inbox-conversations">
    <div className="inbox-list-heading"><h2>Conversations</h2><button type="button" className="inbox-link" disabled={!!busy} onClick={onRefresh}>Refresh</button></div>
    {busy === 'loading' && !conversations.length && <InboxSkeleton label="Loading conversations…" kind="conversations" />}
    {!busy && !conversations.length && <p className="inbox-empty">No conversations yet. Start one with a member of your organisation.</p>}
    {!!conversations.length && <div className="inbox-conversation-rows">{conversations.map((conversation) => {
      const memberNames = conversationMemberNames(conversation, names, ownMemberId);
      const memberIds = conversation.participantMemberIds.filter((id) => id !== ownMemberId);
      const title = conversation.title || conversationTitle(memberNames);
      const latest = conversation.latestMessage;
      const preview = conversationPreview(latest, ownMemberId);
      return <button type="button" className="inbox-conversation-row" key={conversation.id} onClick={() => onSelect(conversation.id)}>
        <span className="inbox-avatar-pair" aria-hidden="true"><InboxAvatar name={memberNames[0]} url={avatars[memberIds[0]]} />{memberIds.length > 1 && <InboxAvatar name={memberNames[1]} url={avatars[memberIds[1]]} />}</span>
        <span className="inbox-conversation-copy">
          <span className="inbox-conversation-title"><strong>{title}</strong><time>{messageTime(latest?.createdAt)}</time></span>
          <span className="inbox-conversation-preview"><small>{preview}</small>{conversation.unreadCount > 0 &&
            <span className="inbox-unread-badge" aria-label={`${conversation.unreadCount} unread`}>{conversation.unreadCount}</span>}</span>
        </span>
      </button>;
    })}</div>}
  </section>;
}
