import { InboxSkeleton } from './InboxSkeleton.jsx';
import { initials } from '../utils/inboxDisplay.js';

export function InboxMemberPicker({ title, setTitle, query, setQuery, onSearch, participants, memberIds, onToggle, onClear, onCreate, busy, searchBusy, names }) {
  return <div className="inbox-new-screen">
    <div className="tray-scroll inbox-new-content">
      <div className="inbox-title-field"><label htmlFor="inbox-conversation-title">Conversation title</label><input id="inbox-conversation-title" form="inbox-create-form" type="text" placeholder="e.g. Project handover" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} required disabled={!!busy} /></div>
      <form className="inbox-search" onSubmit={onSearch}><label htmlFor="inbox-search">Search members</label><div className="inbox-search-row"><input id="inbox-search" type="search" placeholder="Search members" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={100} disabled={!!busy} /><button type="submit" className="button-secondary" disabled={!!busy}>Search</button></div></form>
      {memberIds.length > 0 && <div className="inbox-picked" aria-label="Selected members">{memberIds.map((id) => <button type="button" key={id} onClick={() => onToggle(id)} aria-label={`Remove ${names[id] || 'member'} from selection`}><span className="inbox-avatar">{initials(names[id] || 'M')}</span>{names[id] || 'Member'} ×</button>)}</div>}
      <div className="inbox-member-intro">
        <h2 className="inbox-overline">Members</h2>
        <p className="inbox-member-hint">Active members appear here once they open Secure Chat in Inheriti® Go on their computer.</p>
      </div>
      <div className="inbox-member-list" role="group" aria-label="Members">
        {searchBusy && <InboxSkeleton label={searchBusy === 'searching' ? 'Searching members…' : 'Loading members…'} kind="members" />}
        {!searchBusy && participants.length === 0 && <p className="inbox-member-empty">{query.trim() ? 'No ready members match this search.' : 'No members ready yet.'}</p>}
        {!searchBusy && participants.map(({ memberId, name }) => <label className="inbox-member-row" key={memberId}>
          <span className="inbox-avatar" aria-hidden="true">{initials(name)}</span><span>{name}</span>
          <input type="checkbox" checked={memberIds.includes(memberId)} onChange={() => onToggle(memberId)} disabled={!!busy || (memberIds.length >= 49 && !memberIds.includes(memberId))} />
        </label>)}
      </div>
      <p className="inbox-selection-limit">Choose up to 49 members to join you. You are included automatically.</p>
    </div>
    <form id="inbox-create-form" className="inbox-new-footer" onSubmit={onCreate}><button type="button" className="button-secondary" onClick={onClear} disabled={!!busy || !memberIds.length}>Clear</button><button type="submit" disabled={!!busy || !memberIds.length || !title.trim()}>{busy === 'creating' ? 'Starting…' : 'Start conversation'}</button></form>
  </div>;
}
