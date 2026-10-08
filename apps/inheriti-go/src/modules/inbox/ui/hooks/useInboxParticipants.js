import { useEffect, useRef, useState } from 'react';

export function useInboxParticipants() {
  const generation = useRef(0);
  const request = useRef(0);
  const appliedQuery = useRef('');
  const [items, setItems] = useState([]);
  const [names, setNames] = useState({});
  const [query, setQuery] = useState('');
  const [memberIds, setMemberIds] = useState([]);
  const [busy, setBusy] = useState('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    const current = ++generation.current;
    const latest = ++request.current;
    window.inheritiTray.inboxParticipants()
      .then((page) => { if (generation.current === current && request.current === latest) remember(page.items); })
      .catch(() => { if (generation.current === current && request.current === latest) setError('Could not load members. Try again.'); })
      .finally(() => { if (generation.current === current && request.current === latest) setBusy(''); });
    return () => { generation.current++; };
  }, []);

  function remember(found) {
    setItems(found);
    setNames((known) => Object.assign({}, known,
      Object.fromEntries(found.map(({ memberId: id, name }) => [id, name]))));
  }

  async function loadMembers(value, phase) {
    const current = generation.current;
    const latest = ++request.current;
    setBusy(phase);
    setError('');
    try {
      const page = await window.inheritiTray.inboxParticipants(value);
      if (generation.current !== current || request.current !== latest) return;
      remember(page.items);
    } catch {
      if (generation.current === current && request.current === latest) setError('Could not load members. Try again.');
    } finally {
      if (generation.current === current && request.current === latest) setBusy('');
    }
  }

  function search(event) {
    event.preventDefault();
    appliedQuery.current = query.trim();
    return loadMembers(appliedQuery.current, 'searching');
  }
  function refresh() { return loadMembers(appliedQuery.current, 'loading'); }

  function toggleMemberId(id) {
    setMemberIds((selected) => selected.includes(id)
      ? selected.filter((memberId) => memberId !== id)
      : selected.length < 49 ? selected.concat(id) : selected);
  }

  return { items, names, query, setQuery, memberIds, setMemberIds, toggleMemberId, busy, error, search, refresh };
}
