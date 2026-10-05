import { useEffect, useRef, useState } from 'react';
import { INBOX_MESSAGE_EXPIRY_DAYS } from '../inboxSettings.js';
import { useInboxReadActions } from './useInboxReadActions.js';
import { useInboxUnitReveals } from './useInboxUnitReveals.js';
import { draftSegments, markDraft, unmarkDraft, updateMarkedDraft } from './inboxDraft.js';
export { finishAcknowledgement } from './useInboxReadActions.js';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export function clearPendingSend(pending) {
  pending.parentId = '';
  pending.expiresAt = '';
}

export function protectedSegmentsForSend(segments, pending) {
  if (!pending.expiresAt) pending.expiresAt = new Date(Date.now() + INBOX_MESSAGE_EXPIRY_DAYS * MILLISECONDS_PER_DAY).toISOString();
  return segments.map(segment => 'protectedText' in segment
    ? { protectedText: segment.protectedText, expiresAt: pending.expiresAt } : { text: segment.text });
}

async function settled(operation) {
  try { return { status: 'fulfilled', value: await operation() }; }
  catch { return { status: 'rejected' }; }
}

async function loadMessagePages(id) {
  const protectedPage = await settled(() => window.inheritiTray.inboxMessages(id));
  const normalPage = await settled(() => window.inheritiTray.inboxNormalMessages(id));
  const parentPage = await settled(() => window.inheritiTray.inboxParents(id));
  return [protectedPage, normalPage, parentPage];
}

export function useInboxMessages(onClose) {
  const generation = useRef(0);
  const request = useRef(0);
  const pendingSend = useRef({ parentId: '', expiresAt: '' });
  const [conversationId, setConversationId] = useState('');
  const [items, setItems] = useState([]);
  const [normalItems, setNormalItems] = useState([]);
  const [normalUnreadCount, setNormalUnreadCount] = useState(0);
  const [parentItems, setParentItems] = useState([]);
  const [parentUnreadCount, setParentUnreadCount] = useState(0);
  const [mode, setMode] = useState('NORMAL');
  const [draft, setDraft] = useState('');
  const [marks, setMarks] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [sendError, setSendError] = useState('');
  const [transfer, setTransfer] = useState(null);

  useEffect(() => {
    const stop = window.inheritiTray.onHidden(() => {
      generation.current++;
      setRevealed(null);
      setNormalItems([]);
      setParentItems([]);
      unitReveals.clear();
      setDraft('');
      setMarks([]);
      setSendError('');
      clearPendingSend(pendingSend.current);
      setRevealSeconds(0);
      setTransfer(null);
      onClose();
    });
    return () => { generation.current++; clearPendingSend(pendingSend.current); stop(); void window.inheritiTray.inboxHideText(); };
  }, [onClose]);

  useEffect(() => window.inheritiTray.onInboxTransferProgress(setTransfer), []);

  const { revealed, setRevealed, revealSeconds, setRevealSeconds, openingMessageId, setOpeningMessageId,
    view, retryAck, hide } = useInboxReadActions(conversationId, generation, busy, setBusy, setError, refresh);
  const unitReveals = useInboxUnitReveals(conversationId, generation, setBusy, setError, refresh);

  async function select(id) {
    const current = ++generation.current;
    const latest = ++request.current;
    void window.inheritiTray.inboxHideText();
    setConversationId(id);
    if (id !== conversationId) clearPendingSend(pendingSend.current);
    setRevealed(null);
    setNormalItems([]);
    setParentItems([]);
    unitReveals.clear();
    setNormalUnreadCount(0);
    setParentUnreadCount(0);
    setRevealSeconds(0);
    setItems([]);
    setError('');
    setSendError('');
    setBusy('loading');
    try {
      const [protectedPage, normalPage, parentPage] = await loadMessagePages(id);
      if (generation.current === current && request.current === latest) {
        if (protectedPage.status === 'fulfilled') setItems(protectedPage.value.items);
        if (normalPage.status === 'fulfilled') {
          setNormalItems(normalPage.value.items);
          setNormalUnreadCount(normalPage.value.unreadCount);
        }
        if (parentPage.status === 'fulfilled') {
          setParentItems(parentPage.value.items);
          setParentUnreadCount(parentPage.value.unreadCount);
          setNormalUnreadCount(0);
        }
        if (protectedPage.status === 'rejected' || (normalPage.status === 'rejected' && parentPage.status === 'rejected'))
          setError('Could not load all messages. Try again.');
      }
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
      const [protectedPage, normalPage, parentPage] = await loadMessagePages(id);
      if (generation.current === current && request.current === latest) {
        if (protectedPage.status === 'fulfilled') setItems(protectedPage.value.items);
        if (normalPage.status === 'fulfilled') {
          setNormalItems(normalPage.value.items);
          setNormalUnreadCount(normalPage.value.unreadCount);
        }
        if (parentPage.status === 'fulfilled') {
          setParentItems(parentPage.value.items);
          setParentUnreadCount(parentPage.value.unreadCount);
          setNormalUnreadCount(0);
        }
        if (protectedPage.status === 'rejected' || (normalPage.status === 'rejected' && parentPage.status === 'rejected'))
          setError('Could not refresh all messages. Try again.');
      }
    } catch {
      if (generation.current === current && request.current === latest) setError('Could not refresh messages. Try again.');
    }
  }

  async function clearHistory() {
    if (!conversationId || busy || !window.confirm('Clear your history in this conversation? You will lose access to its current messages and files. Other members keep theirs, and new messages will still arrive.')) return;
    const id = conversationId;
    const current = ++generation.current;
    setBusy('clearing-history');
    setError('');
    void window.inheritiTray.inboxHideText();
    setRevealed(null);
    unitReveals.clear();
    try {
      await window.inheritiTray.inboxClearHistory(id);
      if (generation.current !== current) return;
      setItems([]);
      setNormalItems([]);
      setParentItems([]);
      setNormalUnreadCount(0);
      setParentUnreadCount(0);
      await refresh();
    } catch {
      if (generation.current === current) setError('Could not clear your history. Try again.');
    } finally {
      if (generation.current === current) setBusy('');
    }
  }

  async function send(event) {
    event.preventDefault();
    if (!draft.trim() || busy) return;
    const id = conversationId;
    const current = generation.current;
    const segments = draftSegments(draft, marks, mode);
    const protectedSend = segments.some(segment => 'protectedText' in segment);
    setBusy(protectedSend ? 'sending' : 'sending-normal');
    setError('');
    setSendError('');
    try {
      if (!pendingSend.current.parentId) {
        const preparation = await window.inheritiTray.inboxNormalPreparation(id);
        pendingSend.current.parentId = preparation.parentId;
      }
      if (!protectedSend) {
        await window.inheritiTray.inboxSendNormal(id, pendingSend.current.parentId, draft);
      } else {
        await window.inheritiTray.inboxSendParent(id, pendingSend.current.parentId, protectedSegmentsForSend(segments, pendingSend.current));
      }
      if (generation.current !== current) return;
      clearPendingSend(pendingSend.current);
      setDraft('');
      setMarks([]);
      await refresh();
    } catch (failure) {
      if (String(failure).toLowerCase().includes('inbox_parent_failed')) clearPendingSend(pendingSend.current);
      if (generation.current === current) setSendError(!protectedSend
        ? 'Could not send the message. Your text is still here.' : String(failure).includes('INBOX_UNAVAILABLE')
        ? 'This organization needs two active message storage locations before you can send. Ask an owner or manager to add one. Your text is still here.'
        : 'Could not send the message. Your text is still here.');
    } finally {
      if (generation.current === current) setBusy('');
    }
  }

  function updateDraft(value) {
    clearPendingSend(pendingSend.current);
    setSendError('');
    setMarks(current => updateMarkedDraft(draft, current, value));
    setDraft(value);
  }
  function updateMode(value) { clearPendingSend(pendingSend.current); setSendError(''); setMode(value); }
  function markSelection(start, end) {
    clearPendingSend(pendingSend.current);
    setSendError('');
    setMarks(current => draft.slice(start, end).trim() ? markDraft(current, start, end) : current);
  }
  function unmarkSelection(start, end) { clearPendingSend(pendingSend.current); setSendError(''); setMarks(current => unmarkDraft(current, start, end)); }

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

  return { conversationId, items, normalItems, normalUnreadCount, parentItems, parentUnreadCount, mode, setMode: updateMode,
    draft, setDraft: updateDraft, marks, markSelection, unmarkSelection, unitReveals,
    segments: draftSegments(draft, marks, mode), revealed, revealSeconds, openingMessageId, busy, error, sendError, transfer,
    select, refresh, clearHistory, send, sendFile, saveFile, cancelTransfer, view, retryAck, hide };
}
