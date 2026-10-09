import { useEffect, useRef, useState } from 'react';

const PHOTO_REFRESH_MS = 45 * 60_000;
export function shouldRefreshMemberPhotos(lastLoadedAt, now = Date.now()) { return now - lastLoadedAt >= PHOTO_REFRESH_MS; }
export function mergeMemberAvatars(known, found) {
  return Object.assign({}, known,
    Object.fromEntries(found.map(({ memberId: id, profilePicture }) => [id, profilePicture?.url])));
}

export async function fetchMembers(query) {
  const items = [];
  let offset = 0;
  const seen = new Set();
  while (true) {
    const page = await window.inheritiTray.inboxMembers(query || undefined, offset);
    items.push(...page.items);
    if (page.nextOffset == null) return { items };
    if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset || seen.has(page.nextOffset)) throw new Error('Invalid member page');
    seen.add(page.nextOffset);
    offset = page.nextOffset;
  }
}

export function toggleSelectedMember(selected, items, id) {
  if (selected.includes(id)) return selected.filter((memberId) => memberId !== id);
  if (!items.some((item) => item.memberId === id && item.ready) || selected.length >= 49) return selected;
  return selected.concat(id);
}

export function useInboxParticipants() {
  const generation = useRef(0);
  const request = useRef(0);
  const appliedQuery = useRef('');
  const searchTimer = useRef();
  const firstQuery = useRef(true);
  const lastLoadedAt = useRef(Date.now());
  const photoRefreshPending = useRef(false);
  const [items, setItems] = useState([]);
  const [names, setNames] = useState({});
  const [avatars, setAvatars] = useState({});
  const [query, setQuery] = useState('');
  const [memberIds, setMemberIds] = useState([]);
  const [busy, setBusy] = useState('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    const current = ++generation.current;
    const latest = ++request.current;
    fetchMembers('')
      .then((page) => { if (generation.current === current && request.current === latest) remember(page.items, true); })
      .catch(() => { if (generation.current === current && request.current === latest) setError('Could not load members. Try again.'); })
      .finally(() => { if (generation.current === current && request.current === latest) setBusy(''); });
    return () => { generation.current++; };
  }, []);

  useEffect(() => {
    if (firstQuery.current) { firstQuery.current = false; return; }
    request.current++;
    searchTimer.current = setTimeout(() => {
      appliedQuery.current = query.trim();
      void loadMembers(appliedQuery.current, 'searching');
    }, 250);
    return () => clearTimeout(searchTimer.current);
  }, [query]);

  useEffect(() => {
    const refreshIfOld = () => {
      if (photoRefreshPending.current || !shouldRefreshMemberPhotos(lastLoadedAt.current)) return;
      photoRefreshPending.current = true;
      const current = generation.current;
      void fetchMembers('').then((page) => {
        if (generation.current === current) remember(page.items, true, false);
      }).catch(() => {}).finally(() => { photoRefreshPending.current = false; });
    };
    const timer = setInterval(refreshIfOld, 60_000);
    window.addEventListener('focus', refreshIfOld);
    return () => { clearInterval(timer); window.removeEventListener('focus', refreshIfOld); };
  }, []);

  function remember(found, full = false, replaceItems = true) {
    if (full) lastLoadedAt.current = Date.now();
    if (replaceItems) setItems(found);
    setNames((known) => Object.assign({}, known,
      Object.fromEntries(found.map(({ memberId: id, name }) => [id, name]))));
    setAvatars((known) => mergeMemberAvatars(known, found));
  }

  async function loadMembers(value, phase) {
    const current = generation.current;
    const latest = ++request.current;
    setBusy(phase);
    setError('');
    try {
      const page = await fetchMembers(value);
      if (generation.current !== current || request.current !== latest) return;
      remember(page.items, !value);
    } catch {
      if (phase && generation.current === current && request.current === latest) setError('Could not load members. Try again.');
    } finally {
      if (generation.current === current && request.current === latest) setBusy('');
    }
  }

  function search(event) {
    event.preventDefault();
    clearTimeout(searchTimer.current);
    appliedQuery.current = query.trim();
    return loadMembers(appliedQuery.current, 'searching');
  }
  function refresh() { return loadMembers(appliedQuery.current, 'loading'); }

  function toggleMemberId(id) {
    setMemberIds((selected) => toggleSelectedMember(selected, items, id));
  }

  return { items, names, avatars, query, setQuery, memberIds, setMemberIds, toggleMemberId, busy, error, search, refresh };
}
