import { useEffect, useRef, useState } from 'react';

export function useInboxNavigation(inbox) {
  const [screen, setScreen] = useState('list');
  const [showMembers, setShowMembers] = useState(false);
  const sheetDone = useRef(null);

  useEffect(() => {
    if (!showMembers) return;
    sheetDone.current?.focus();
    function closeOnEscape(event) { if (event.key === 'Escape') setShowMembers(false); }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showMembers]);

  function goBack() {
    if (screen === 'thread' && !inbox.messages.hide()) return;
    setScreen('list');
    setShowMembers(false);
  }

  async function openConversation(id) {
    setScreen('thread');
    await inbox.messages.select(id);
    await inbox.conversations.refresh();
  }

  async function createConversation(event) {
    const created = await inbox.createConversation(event);
    if (created) setScreen('thread');
  }

  return { screen, showMembers, sheetDone, goBack, openConversation, createConversation,
    startConversation: () => setScreen('new'), openMembers: () => setShowMembers(true),
    closeMembers: () => setShowMembers(false) };
}
