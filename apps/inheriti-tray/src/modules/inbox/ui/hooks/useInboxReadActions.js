import { useEffect, useState } from 'react';
import { INBOX_REVEAL_SECONDS } from '../inboxSettings.js';

export function finishAcknowledgement(current, messageId, acknowledgement) {
  if (!current || current.messageId !== messageId) return current;
  if (acknowledgement === 'ACKNOWLEDGED' && !current.text && !current.fileName) return null;
  const next = { messageId: current.messageId, text: current.text, fileName: current.fileName,
    hideAt: current.hideAt, acknowledgement };
  if ('suggestion' in current) next.suggestion = current.suggestion;
  return next;
}

function useRevealTimer(revealed, setRevealed) {
  const [revealSeconds, setRevealSeconds] = useState(0);
  useEffect(() => {
    if (!revealed?.text || !revealed.hideAt) return;
    const update = () => {
      const remaining = Math.max(0, Math.ceil((revealed.hideAt - Date.now()) / 1000));
      setRevealSeconds(remaining);
      if (remaining) return;
      setRevealed(current => current?.acknowledgement === 'PENDING'
        ? { messageId: current.messageId, acknowledgement: 'PENDING' } : null);
      void window.inheritiTray.inboxHideText();
    };
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [revealed?.messageId, revealed?.hideAt]);
  return { revealSeconds, setRevealSeconds };
}

export function useInboxReadActions(conversationId, generation, busy, setBusy, setError, refresh) {
  const [revealed, setRevealed] = useState(null);
  const [openingMessageId, setOpeningMessageId] = useState('');
  const { revealSeconds, setRevealSeconds } = useRevealTimer(revealed, setRevealed);

  async function view(messageId) {
    const current = generation.current;
    setRevealed(null);
    setError('');
    setBusy('opening');
    setOpeningMessageId(messageId);
    try {
      await window.inheritiTray.inboxHideText();
      if (generation.current !== current) return;
      const result = await window.inheritiTray.inboxOpenText(conversationId, messageId);
      if (generation.current !== current) return;
      setRevealed({ messageId, text: result.text, suggestion: result.suggestion, acknowledgement: result.acknowledgement,
        hideAt: Date.now() + INBOX_REVEAL_SECONDS * 1000 });
      void refresh();
    } catch {
      if (generation.current === current) setError('Could not open the message. Try again.');
    } finally {
      if (generation.current === current) { setBusy(''); setOpeningMessageId(''); }
    }
  }

  async function retryAck() {
    if (!revealed || revealed.acknowledgement !== 'PENDING' || busy) return;
    const current = generation.current;
    setBusy('acknowledging');
    setError('');
    try {
      const result = await window.inheritiTray.inboxRetryAck(conversationId, revealed.messageId);
      if (generation.current !== current) return;
      setRevealed(latest => finishAcknowledgement(latest, revealed.messageId, result.acknowledgement));
      if (result.acknowledgement === 'ACKNOWLEDGED') void refresh();
    } catch {
      if (generation.current === current) {
        setRevealed(null);
        setError('Could not confirm this read. Open the message again if it is still available.');
      }
    } finally {
      if (generation.current === current) setBusy('');
    }
  }

  function hide() {
    setRevealed(current => current?.acknowledgement === 'PENDING'
      ? { messageId: current.messageId, acknowledgement: 'PENDING' } : null);
    setRevealSeconds(0);
    void window.inheritiTray.inboxHideText();
  }

  return { revealed, setRevealed, revealSeconds, setRevealSeconds, openingMessageId, setOpeningMessageId,
    view, retryAck, hide };
}
