import { useEffect, useRef, useState } from 'react';

export function useInboxConversations() {
  const generation = useRef(0);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    const current = ++generation.current;
    window.inheritiTray.inboxConversations()
      .then((page) => { if (generation.current === current) setItems(page.items); })
      .catch(() => { if (generation.current === current) setError('Could not load conversations. Try again.'); })
      .finally(() => { if (generation.current === current) setBusy(''); });
    return () => { generation.current++; };
  }, []);

  async function refresh() {
    const current = generation.current;
    setBusy('loading');
    setError('');
    try {
      const page = await window.inheritiTray.inboxConversations();
      if (generation.current === current) setItems(page.items);
    } catch {
      if (generation.current === current) setError('Could not load conversations. Try again.');
    } finally {
      if (generation.current === current) setBusy('');
    }
  }

  async function create(memberId) {
    const current = generation.current;
    setBusy('creating');
    setError('');
    try {
      const conversation = await window.inheritiTray.inboxCreateConversation(memberId);
      if (generation.current !== current) return;
      setItems((existing) => [conversation].concat(existing.filter(({ id }) => id !== conversation.id)));
      return conversation;
    } catch {
      if (generation.current === current) setError('Could not start the conversation. Try again.');
    } finally {
      if (generation.current === current) setBusy('');
    }
  }

  return { items, busy, error, refresh, create };
}
