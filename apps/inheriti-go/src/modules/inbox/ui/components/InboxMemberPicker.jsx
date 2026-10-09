import { InboxSkeleton } from './InboxSkeleton.jsx';
import { InboxAvatar } from './InboxAvatar.jsx';
import { InboxPresenceDot } from './InboxPresenceDot.jsx';

export function InboxMemberPicker({ title, setTitle, query, setQuery, onSearch, participants, ownMemberId, memberIds, onToggle, onClear, onCreate, busy, searchBusy, loadError, onRetry, names, avatars = {}, presenceStatus = () => 'Unknown' }) {
  const visible = participants.filter(({ memberId }) => memberId !== ownMemberId);
  return <div className="inbox-new-screen">
    <div className="tray-scroll inbox-new-content">
      <div className="inbox-title-field"><label htmlFor="inbox-conversation-title">Conversation title</label><input id="inbox-conversation-title" form="inbox-create-form" type="text" placeholder="e.g. Project handover" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} required disabled={!!busy} /></div>
      <form className="inbox-search" onSubmit={onSearch}><label htmlFor="inbox-search">Search members</label><div className="inbox-search-row"><input id="inbox-search" type="search" placeholder="Name or email" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={100} /></div></form>
      {memberIds.length > 0 && <div className="inbox-picked" aria-label="Selected members">{memberIds.map((id) => <button type="button" key={id} onClick={() => onToggle(id)} aria-label={`Remove ${names[id] || 'member'} from selection`}><InboxAvatar name={names[id]} url={avatars[id]} />{names[id] || 'Member'} ×</button>)}</div>}
      <div className="inbox-member-intro">
        <h2 className="inbox-overline">Members</h2>
      </div>
      <div className="inbox-member-list" role="group" aria-label="Members">
        {searchBusy && <InboxSkeleton label={searchBusy === 'searching' ? 'Searching members…' : 'Loading members…'} kind="members" />}
        {!searchBusy && loadError && <p className="inbox-member-empty" role="alert">Members unavailable. <button type="button" className="inbox-link" onClick={onRetry}>Retry</button></p>}
        {!searchBusy && !loadError && visible.length === 0 && <p className="inbox-member-empty">{query.trim() ? 'No matching members.' : 'No members yet.'}</p>}
        {!searchBusy && visible.map(({ memberId, name, ready }) => {
          const presence = presenceStatus(memberId);
          return <label className={`inbox-member-row${ready ? '' : ' is-unready'}`} key={memberId}
            title={ready ? undefined : 'You can add this member after they open Inheriti® Go.'}>
          <span className="inbox-avatar-presence"><InboxAvatar name={name} url={avatars[memberId]} />{ready && <InboxPresenceDot status={presence} />}</span><span>{name}{!ready && <small className="inbox-not-on-go">Not on Inheriti® Go yet</small>}</span>
          <input type="checkbox" checked={memberIds.includes(memberId)} onChange={() => onToggle(memberId)} disabled={!!busy || !ready || (memberIds.length >= 49 && !memberIds.includes(memberId))} />
        </label>})}
      </div>
    </div>
    <form id="inbox-create-form" className="inbox-new-footer" onSubmit={onCreate}><button type="button" className="button-secondary" onClick={onClear} disabled={!!busy || !memberIds.length}>Clear</button><button type="submit" disabled={!!busy || !memberIds.length || !title.trim()}>{busy === 'creating' ? 'Starting…' : 'Start conversation'}</button></form>
  </div>;
}
