import { useInboxConversationMembers } from '../hooks/useInboxConversationMembers.js';
import { InboxAvatar } from './InboxAvatar.jsx';
import { InboxPresenceDot } from './InboxPresenceDot.jsx';

export function InboxConversationMembers({ conversation, ownMemberId, participants, names, avatars = {}, busy, onChange, presenceStatus = () => 'Unknown' }) {
  const { memberId, setMemberId, creator, available, add, remove } = useInboxConversationMembers({
    conversation, ownMemberId, participants, names, busy, onChange,
  });
  return <section className="inbox-members" aria-labelledby="inbox-members-heading">
    <h2 id="inbox-members-heading">Participants</h2>
    <ul>{conversation.participantMemberIds.map((id) => <li key={id}>
      <span className="inbox-avatar-presence"><InboxAvatar className="inbox-avatar inbox-sheet-avatar" name={names[id] || (id === ownMemberId ? 'You' : 'Member')} url={avatars[id]} /><InboxPresenceDot status={presenceStatus(id)} /></span>
      <span className="inbox-sheet-member-name"><strong>{names[id] || (id === ownMemberId ? 'You' : 'Member')}</strong>
        <small>{id === conversation.creatorMemberId ? 'Creator' : 'Member'}</small></span>
      {creator && id !== conversation.creatorMemberId && conversation.participantMemberIds.length > 2 &&
        <button type="button" className="inbox-sheet-remove" disabled={!!busy} aria-label={`Remove ${names[id] || id}`}
          onClick={() => remove(id)}>Remove</button>}
    </li>)}</ul>
    <p className="inbox-selection-limit">Removing someone stops future access. Plaintext they already retained cannot be revoked.</p>
    {creator && <details className="inbox-sheet-add">
      <summary>Add member</summary>
      <form className="inbox-search" onSubmit={participants.search}>
        <label htmlFor="inbox-add-search">Search active members</label>
        <div className="inbox-search-row">
          <input id="inbox-add-search" type="search" value={participants.query} onChange={(event) => participants.setQuery(event.target.value)} maxLength={100} />
        </div>
      </form>
      <form onSubmit={add}>
        <label htmlFor="inbox-add-member">Active member</label>
        <div className="inbox-search-row">
          <select id="inbox-add-member" value={memberId} onChange={(event) => setMemberId(event.target.value)} disabled={!!busy || !available.length}>
            <option value="">Select a member</option>
            {available.map((item) => <option key={item.memberId} value={item.memberId} disabled={!item.ready}>{item.name}{item.ready ? '' : ' · Not on Inheriti® Go yet'}</option>)}
          </select>
          <button type="submit" disabled={!!busy || !memberId || conversation.participantMemberIds.length >= 50}>Add</button>
        </div>
      </form>
    </details>}
  </section>;
}
