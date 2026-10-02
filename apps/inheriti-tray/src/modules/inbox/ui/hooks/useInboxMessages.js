import { useEffect, useRef, useState } from 'react';

export function useInboxMessages(onClose, expiresInDays) {
  const generation = useRef(0);
  const [conversationId, setConversationId] = useState('');
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState('');
  const [revealed, setRevealed] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const stop = window.inheritiTray.onHidden(() => {
      generation.current++;
      setRevealed(null);
      onClose();
    });
    return () => { generation.current++; stop(); void window.inheritiTray.inboxHideText(); };
  }, [onClose]);

  async function select(id) {
    const current = ++generation.current;
    void window.inheritiTray.inboxHideText();
    setConversationId(id);
    setRevealed(null);
    setItems([]);
    setError('');
    setBusy('loading');
    try {
      const page = await window.inheritiTray.inboxMessages(id);
      if (generation.current === current) setItems(page.items);
    } catch {
      if (generation.current === current) setError('Could not load messages. Try again.');
    } finally {
      if (generation.current === current) setBusy('');
    }
  }

  async function send(event) {
    event.preventDefault();
    if (!draft.trim() || busy) return;
    const id = conversationId;
    const current = generation.current;
    setBusy('sending');
    setError('');
    try {
      await window.inheritiTray.inboxSendText(id, draft, new Date(Date.now() + expiresInDays * 86400000).toISOString());
      if (generation.current !== current) return;
      setDraft('');
      const page = await window.inheritiTray.inboxMessages(id);
      if (generation.current === current) setItems(page.items);
    } catch {
      if (generation.current === current) setError('Could not send the message. Your text is still here.');
    } finally {
      if (generation.current === current) setBusy('');
    }
  }

  async function view(messageId) {
    const current = generation.current;
    setRevealed(null);
    setError('');
    setBusy('opening');
    try {
      await window.inheritiTray.inboxHideText();
      if (generation.current !== current) return;
      const result = await window.inheritiTray.inboxOpenText(conversationId, messageId);
      if (generation.current === current) setRevealed({ messageId, text: result.text, acknowledgement: result.acknowledgement });
    } catch {
      if (generation.current === current) setError('Could not open the message. Try again.');
    } finally {
      if (generation.current === current) setBusy('');
    }
  }

  async function retryAck() {
    if (!revealed || revealed.acknowledgement !== 'PENDING' || busy) return;
    const current = generation.current;
    setBusy('acknowledging');
    setError('');
    try {
      const result = await window.inheritiTray.inboxRetryAck(conversationId, revealed.messageId);
      if (generation.current === current) setRevealed({ messageId: revealed.messageId, text: revealed.text, acknowledgement: result.acknowledgement });
    } catch {
      if (generation.current === current) {
        setRevealed(null);
        setError('Could not confirm this read. Open the message again if it is still available.');
      }
    } finally {
      if (generation.current === current) setBusy('');
    }
  }

  function hide() { setRevealed(null); void window.inheritiTray.inboxHideText(); }

  return { conversationId, items, draft, setDraft, revealed, busy, error, select, send, view, retryAck, hide };
}
