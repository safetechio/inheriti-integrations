export function InboxMemberPicker({ query, setQuery, onSearch, participants, memberId, setMemberId, onCreate, busy }) {
  return <>
    <form onSubmit={onSearch}>
      <label htmlFor="inbox-search">Search members</label>
      <input id="inbox-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={100} disabled={!!busy} />
      <button type="submit" disabled={!!busy}>Search</button>
    </form>
    <form onSubmit={onCreate}>
      <label htmlFor="inbox-member">Start a two-person conversation</label>
      <select id="inbox-member" value={memberId} onChange={(event) => setMemberId(event.target.value)} disabled={!!busy}>
        <option value="">Choose a member</option>
        {participants.map(({ memberId: id, name }) => <option value={id} key={id}>{name}</option>)}
      </select>
      <button type="submit" disabled={!memberId || !!busy}>Start conversation</button>
    </form>
  </>;
}
