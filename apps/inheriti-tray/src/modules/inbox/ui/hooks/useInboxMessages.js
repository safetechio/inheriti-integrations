import { useEffect, useRef, useState } from 'react';
import { INBOX_MESSAGE_EXPIRY_DAYS, INBOX_REVEAL_SECONDS } from '../inboxSettings.js';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export function finishAcknowledgement(current, messageId, acknowledgement) {
  if (!current || current.messageId !== messageId) return current;
  if (acknowledgement === 'ACKNOWLEDGED' && !current.text && !current.fileName) return null;
  return { messageId: current.messageId, text: current.text, fileName: current.fileName,
    hideAt: current.hideAt, acknowledgement };
}

export function useInboxMessages(onClose) {
  const generation = useRef(0);
  const request = useRef(0);
  const [conversationId, setConversationId] = useState('');
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState('');
  const [revealed, setRevealed] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [transfer, setTransfer] = useState(null);
  const [openingMessageId, setOpeningMessageId] = useState('');
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

  useEffect(() => {
    const stop = window.inheritiTray.onHidden(() => {
      generation.current++;
      setRevealed(null);
      setRevealSeconds(0);
      setTransfer(null);
      onClose();
    });
    return () => { generation.current++; stop(); void window.inheritiTray.inboxHideText(); };
  }, [onClose]);

  useEffect(() => window.inheritiTray.onInboxTransferProgress(setTransfer), []);

  async function select(id) {
    const current = ++generation.current;
    const latest = ++request.current;
    void window.inheritiTray.inboxHideText();
    setConversationId(id);
    setRevealed(null);
    setRevealSeconds(0);
    setItems([]);
    setError('');
    setBusy('loading');
    try {
      const page = await window.inheritiTray.inboxMessages(id);
      if (generation.current === current && request.current === latest) setItems(page.items);
    } catch {
      if (generation.current === current && request.current === latest) setError('Could not load messages. Try again.');
    } finally {
      if (generation.current === current) setBusy('');
    }
  }

  async function refresh() {
    const id = conversationId;
    const current = generation.current;
    const latest = ++request.current;
    if (!id) return;
    try {
      const page = await window.inheritiTray.inboxMessages(id);
      if (generation.current === current && request.current === latest) setItems(page.items);
    } catch {
      if (generation.current === current && request.current === latest) setError('Could not refresh messages. Try again.');
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
      await window.inheritiTray.inboxSendText(id, draft, new Date(Date.now() + INBOX_MESSAGE_EXPIRY_DAYS * MILLISECONDS_PER_DAY).toISOString());
      if (generation.current !== current) return;
      setDraft('');
      await refresh();
    } catch (failure) {
      if (generation.current === current) setError(String(failure).includes('INBOX_UNAVAILABLE')
        ? 'This organization needs two active message storage locations before you can send. Ask an owner or manager to add one. Your text is still here.'
        : 'Could not send the message. Your text is still here.');
    } finally {
      if (generation.current === current) setBusy('');
    }
  }

  async function sendFile() {
    if (!conversationId || busy) return;
    const id = conversationId;
    const current = generation.current;
    setBusy('sending-file');
    setTransfer(null);
    setError('');
    try {
      const result = await window.inheritiTray.inboxSendFile(id, new Date(Date.now() + INBOX_MESSAGE_EXPIRY_DAYS * MILLISECONDS_PER_DAY).toISOString());
      if (generation.current !== current || result?.cancelled) return;
      await refresh();
    } catch (failure) {
      if (generation.current === current && !String(failure).includes('AbortError')) setError(String(failure).includes('INBOX_UNAVAILABLE')
        ? 'This organization needs two active message storage locations before you can send. Ask an owner or manager to add one.'
        : 'Could not send the file. Check the 10 MB limit and try again.');
    } finally {
      if (generation.current === current) { setBusy(''); setTransfer(null); }
    }
  }

  async function saveFile(messageId) {
    if (busy) return;
    const current = generation.current;
    setBusy('opening-file');
    setOpeningMessageId(messageId);
    setTransfer(null);
    setError('');
    try {
      const result = await window.inheritiTray.inboxOpenFile(conversationId, messageId);
      if (generation.current === current) {
        setRevealed({ messageId, fileName: result.name, acknowledgement: result.acknowledgement });
        await refresh();
      }
    } catch (failure) {
      if (generation.current === current && !String(failure).includes('inbox_file_save_cancelled') && !String(failure).includes('AbortError'))
        setError('Could not save this protected file. Try again while it is available.');
    } finally {
      if (generation.current === current) { setBusy(''); setTransfer(null); setOpeningMessageId(''); }
    }
  }

  function cancelTransfer() { void window.inheritiTray.inboxCancelTransfer(); }

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
      setRevealed({ messageId, text: result.text, acknowledgement: result.acknowledgement, hideAt: Date.now() + INBOX_REVEAL_SECONDS * 1000 });
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
      if (result.acknowledgement === 'ACKNOWLEDGED') {
        void refresh();
      }
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

  return { conversationId, items, draft, setDraft, revealed, revealSeconds, openingMessageId, busy, error, transfer, select, refresh, send, sendFile, saveFile, cancelTransfer, view, retryAck, hide };
}
