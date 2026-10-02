import { useEffect, useRef, useState } from 'react';

export function useInboxParticipants() {
  const generation = useRef(0);
  const [items, setItems] = useState([]);
  const [names, setNames] = useState({});
  const [query, setQuery] = useState('');
  const [memberId, setMemberId] = useState('');
  const [busy, setBusy] = useState('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    const current = ++generation.current;
    window.inheritiTray.inboxParticipants()
      .then((page) => { if (generation.current === current) remember(page.items); })
      .catch(() => { if (generation.current === current) setError('Could not load members. Try again.'); })
      .finally(() => { if (generation.current === current) setBusy(''); });
    return () => { generation.current++; };
  }, []);

  function remember(found) {
    setItems(found);
    setNames((known) => Object.assign({}, known,
      Object.fromEntries(found.map(({ memberId: id, name }) => [id, name]))));
  }

  async function search(event) {
    event.preventDefault();
    const current = generation.current;
    setBusy('searching');
    setError('');
    try {
      const page = await window.inheritiTray.inboxParticipants(query.trim());
      if (generation.current !== current) return;
      remember(page.items);
      setMemberId('');
    } catch {
      if (generation.current === current) setError('Could not search members. Try again.');
    } finally {
      if (generation.current === current) setBusy('');
    }
  }

  return { items, names, query, setQuery, memberId, setMemberId, busy, error, search };
}
