import { useEffect, useRef, useState } from 'react';

export function useInboxConversations() {
  const generation = useRef(0);
  const request = useRef(0);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    const current = ++generation.current;
    const latest = ++request.current;
    window.inheritiTray.inboxConversations()
      .then((page) => { if (generation.current === current && request.current === latest) setItems(page.items); })
      .catch(() => { if (generation.current === current && request.current === latest) setError('Could not load conversations. Try again.'); })
      .finally(() => { if (generation.current === current && request.current === latest) setBusy(''); });
    return () => { generation.current++; };
  }, []);

  async function refresh() {
    const current = generation.current;
    const latest = ++request.current;
    setBusy('loading');
    setError('');
    try {
      const page = await window.inheritiTray.inboxConversations();
      if (generation.current === current && request.current === latest) setItems(page.items);
    } catch {
      if (generation.current === current && request.current === latest) setError('Could not load conversations. Try again.');
    } finally {
      if (generation.current === current && request.current === latest) setBusy('');
    }
  }

  async function create(title, memberIds) {
    const current = generation.current;
    setBusy('creating');
    setError('');
    try {
      const conversation = await window.inheritiTray.inboxCreateConversation(title, memberIds);
      if (generation.current !== current) return;
      request.current++;
      setItems((existing) => [conversation].concat(existing.filter(({ id }) => id !== conversation.id)));
      return conversation;
    } catch {
      if (generation.current === current) setError('Could not start the conversation. Try again.');
    } finally {
      if (generation.current === current) setBusy('');
    }
  }

  async function change(conversation, action, memberId) {
    const current = generation.current;
    setBusy('changing');
    setError('');
    try {
      const updated = await window.inheritiTray.inboxChangeParticipants(conversation.id, action, memberId, conversation.participantRevision);
      if (generation.current === current) {
        request.current++;
        setItems((existing) => existing.map((item) => item.id === updated.id
          ? { ...updated, unreadCount: item.unreadCount || 0 } : item));
      }
      return true;
    } catch {
      if (generation.current === current) {
        setError('Could not change members. The conversation may have changed; review the refreshed list and try again.');
        try {
          const page = await window.inheritiTray.inboxConversations();
          if (generation.current === current) setItems(page.items);
        } catch { /* Keep the current list and error visible. */ }
      }
      return false;
    } finally {
      if (generation.current === current) setBusy('');
    }
  }

  return { items, busy, error, refresh, create, change };
}
