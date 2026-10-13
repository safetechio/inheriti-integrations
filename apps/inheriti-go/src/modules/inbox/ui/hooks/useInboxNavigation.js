import { useEffect, useRef, useState } from 'react';

export function useInboxNavigation(inbox) {
  const [screen, setScreen] = useState('list');
  const [showMembers, setShowMembers] = useState(false);
  const sheetDone = useRef(null);
  const opening = useRef(0);

  useEffect(() => {
    if (!showMembers) return;
    sheetDone.current?.focus();
    function closeOnEscape(event) { if (event.key === 'Escape') setShowMembers(false); }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showMembers]);

  function goBack() {
    opening.current++;
    if (screen === 'thread' && !inbox.messages.leave()) return;
    setScreen('list');
    setShowMembers(false);
  }

  async function openConversation(id) {
    const current = ++opening.current;
    setScreen('thread');
    await inbox.messages.select(id);
    if (current !== opening.current) return;
    void inbox.conversations.refresh();
  }

  async function createConversation(event) {
    const created = await inbox.createConversation(event);
    if (created) setScreen('thread');
  }

  return { screen, showMembers, sheetDone, goBack, openConversation, createConversation,
    startConversation: () => { opening.current++; setScreen('new'); }, openMembers: () => setShowMembers(true),
    closeMembers: () => setShowMembers(false) };
}
