import { useEffect, useRef, useState } from 'react';
import { INBOX_MESSAGE_EXPIRY_DAYS } from '../inboxSettings.js';
import { useInboxReadActions } from './useInboxReadActions.js';
import { useInboxUnitReveals } from './useInboxUnitReveals.js';
import { draftSegments, markDraft, unmarkDraft, updateMarkedDraft } from './inboxDraft.js';
export { finishAcknowledgement } from './useInboxReadActions.js';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const ORGANISATION_KEY_UNAVAILABLE = 'Organisation Key unavailable. Claim it in SafeKey Mobile, or ask an owner to finish setup, then try again.';

export function isOrganisationKeyUnavailable(failure) {
  return /master_key_required|MasterKeyRequired/i.test(String(failure));
}

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
  return Promise.all([
    settled(() => window.inheritiTray.inboxMessages(id)),
    settled(() => window.inheritiTray.inboxNormalMessages(id)),
    settled(() => window.inheritiTray.inboxParents(id)),
  ]);
}

export function useInboxMessages(onClose) {
  const generation = useRef(0);
  const request = useRef(0);
  const pendingSend = useRef({ parentId: '', expiresAt: '' });
  const planFile = useRef(null);
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
  const [pendingMessage, setPendingMessage] = useState(null);
  const [acceptedMessages, setAcceptedMessages] = useState([]);

  useEffect(() => {
    const stop = window.inheritiTray.onHidden(() => {
      generation.current++;
      planFile.current = null;
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
      setPendingMessage(null);
      setAcceptedMessages([]);
      onClose();
    });
    return () => { generation.current++; planFile.current = null; clearPendingSend(pendingSend.current); stop(); void window.inheritiTray.inboxHideText(); };
  }, [onClose]);

  useEffect(() => window.inheritiTray.onInboxTransferProgress(setTransfer), []);
  useEffect(() => window.inheritiTray.onInboxParentSendProgress(progress => {
    if (progress.parentId !== pendingSend.current.parentId) return;
    setPendingMessage(current => current?.parentId === progress.parentId
      ? { ...current, completed: progress.completed, total: progress.total } : current);
  }), []);
  useEffect(() => window.inheritiTray.onInboxFileForPlan(async (opened) => {
    const expected = planFile.current;
    const bytes = opened.bytes instanceof Uint8Array ? opened.bytes : new Uint8Array(opened.bytes);
    try {
      if (!expected || expected.conversationId !== opened.conversationId || expected.messageId !== opened.messageId ||
        expected.generation !== generation.current || !opened.name || bytes.length > 10_000_000) {
        void window.inheritiTray.inboxCancelTransfer();
        return;
      }
      expected.file = new File([bytes], opened.name, { type: opened.mimeType || 'application/octet-stream' });
      await window.inheritiTray.inboxAcceptFileForPlan(opened.conversationId, opened.messageId);
    } catch { planFile.current = null; void window.inheritiTray.inboxCancelTransfer(); }
    finally { bytes.fill(0); }
  }), []);

  const { revealed, setRevealed, revealSeconds, setRevealSeconds, openingMessageId, setOpeningMessageId,
    view, retryAck, hide } = useInboxReadActions(conversationId, generation, busy, setBusy, setError, refresh);
  const unitReveals = useInboxUnitReveals(conversationId, generation, setBusy, setError, refresh);

  async function select(id) {
    const current = ++generation.current;
    planFile.current = null;
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
    setPendingMessage(null);
    if (id !== conversationId) setAcceptedMessages([]);
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
        setAcceptedMessages(messages => messages.filter(message =>
          !((normalPage.status === 'fulfilled' && normalPage.value.items.some(item => item.parentId === message.parentId)) ||
            (parentPage.status === 'fulfilled' && parentPage.value.items.some(item => item.parentId === message.parentId)))));
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
        setAcceptedMessages(messages => messages.filter(message =>
          !((normalPage.status === 'fulfilled' && normalPage.value.items.some(item => item.parentId === message.parentId)) ||
            (parentPage.status === 'fulfilled' && parentPage.value.items.some(item => item.parentId === message.parentId)))));
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
    planFile.current = null;
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
    const protectedCount = segments.filter(segment => 'protectedText' in segment).length;
    setBusy(protectedSend ? 'sending' : 'sending-normal');
    setError('');
    setSendError('');
    setPendingMessage({ conversationId: id, parentId: pendingSend.current.parentId, protectedSend,
      text: protectedSend ? '' : draft, completed: 0, total: protectedCount, status: 'sending' });
    try {
      if (!pendingSend.current.parentId) {
        const preparation = await window.inheritiTray.inboxNormalPreparation(id);
        pendingSend.current.parentId = preparation.parentId;
        setPendingMessage(current => current ? { ...current, parentId: preparation.parentId } : current);
      }
      if (!protectedSend) {
        await window.inheritiTray.inboxSendNormal(id, pendingSend.current.parentId, draft);
      } else {
        await window.inheritiTray.inboxSendParent(id, pendingSend.current.parentId, protectedSegmentsForSend(segments, pendingSend.current));
      }
      if (generation.current !== current) return;
      const sentParentId = pendingSend.current.parentId;
      clearPendingSend(pendingSend.current);
      setDraft('');
      setMarks([]);
      setAcceptedMessages(messages => [...messages, { conversationId: id, parentId: sentParentId,
        protectedSend, text: protectedSend ? '' : draft, status: 'sent' }]);
      setPendingMessage(null);
      await refresh();
    } catch (failure) {
      if (String(failure).toLowerCase().includes('inbox_parent_failed')) clearPendingSend(pendingSend.current);
      if (generation.current === current) setSendError(!protectedSend
        ? 'Could not send the message. Your text is still here.' : isOrganisationKeyUnavailable(failure)
        ? `${ORGANISATION_KEY_UNAVAILABLE} Your text is still here.` : String(failure).includes('INBOX_UNAVAILABLE')
        ? 'Secure Chat storage is unavailable. Ask an owner or manager to check InheritiChain, Inheriti® Vault, and Inheriti® HSM. Your text is still here.'
        : 'Could not send the message. Your text is still here.');
      if (generation.current === current) setPendingMessage(message => message ? { ...message, status: 'failed' } : null);
    } finally {
      if (generation.current === current) setBusy('');
    }
  }

  function updateDraft(value) {
    clearPendingSend(pendingSend.current);
    setSendError('');
    setPendingMessage(null);
    setMarks(current => updateMarkedDraft(draft, current, value));
    setDraft(value);
  }
  function updateMode(value) { clearPendingSend(pendingSend.current); setSendError(''); setPendingMessage(null); setMode(value); }
  function markSelection(start, end) {
    clearPendingSend(pendingSend.current);
    setSendError('');
    setPendingMessage(null);
    setMarks(current => draft.slice(start, end).trim() ? markDraft(current, start, end) : current);
  }
  function unmarkSelection(start, end) { clearPendingSend(pendingSend.current); setSendError(''); setPendingMessage(null); setMarks(current => unmarkDraft(current, start, end)); }

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
      if (generation.current === current && !String(failure).includes('AbortError')) setError(isOrganisationKeyUnavailable(failure)
        ? ORGANISATION_KEY_UNAVAILABLE : String(failure).includes('INBOX_UNAVAILABLE')
        ? 'Secure Chat storage is unavailable. Ask an owner or manager to check InheritiChain, Inheriti® Vault, and Inheriti® HSM.'
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
        setError(isOrganisationKeyUnavailable(failure) ? ORGANISATION_KEY_UNAVAILABLE : 'Could not save this protected file. Try again while it is available.');
    } finally {
      if (generation.current === current) { setBusy(''); setTransfer(null); setOpeningMessageId(''); }
    }
  }

  async function saveFileAsPlan(messageId, onCreatePlanFromFile) {
    if (busy || !conversationId) return;
    const current = generation.current;
    setBusy('opening-file');
    setOpeningMessageId(messageId);
    setTransfer(null);
    setError('');
    planFile.current = { conversationId, messageId, generation: current, onCreatePlanFromFile, file: null };
    let pendingAck = false;
    try {
      const opened = await window.inheritiTray.inboxOpenFileForPlan(conversationId, messageId);
      if (generation.current !== current) return;
      if (!planFile.current?.file) throw new Error('File was not accepted');
      if (opened.acknowledgement === 'PENDING') {
        pendingAck = true;
        setRevealed({ messageId, acknowledgement: 'PENDING', planPending: true });
        return;
      }
      if (!onCreatePlanFromFile(planFile.current.file)) throw new Error('Could not create a file plan');
      planFile.current = null;
    } catch (failure) {
      if (generation.current === current && !String(failure).includes('AbortError'))
        setError(planFile.current?.file ? 'This file was opened, but the plan could not be started.' : isOrganisationKeyUnavailable(failure)
          ? ORGANISATION_KEY_UNAVAILABLE : 'Could not open this protected file as a plan. Try again while it is available.');
      planFile.current = null;
    } finally {
      if (generation.current === current) { setBusy(pendingAck ? 'plan-pending' : ''); setTransfer(null); setOpeningMessageId(''); }
    }
  }

  async function retryPlanAck() {
    const pending = planFile.current;
    if (!pending?.file) return retryAck();
    if (busy !== 'plan-pending' || revealed?.messageId !== pending.messageId || !revealed.planPending) return;
    setBusy('acknowledging');
    setError('');
    try {
      const result = pending.acknowledged ? { acknowledgement: 'ACKNOWLEDGED' }
        : await window.inheritiTray.inboxRetryAck(pending.conversationId, pending.messageId);
      if (planFile.current !== pending || generation.current !== pending.generation) return;
      if (result.acknowledgement !== 'ACKNOWLEDGED') return;
      pending.acknowledged = true;
      setRevealed({ messageId: pending.messageId, acknowledgement: 'PENDING', planPending: true, planAcknowledged: true });
      if (!pending.onCreatePlanFromFile(pending.file)) throw new Error('Could not create a file plan');
      planFile.current = null;
      setRevealed(null);
    } catch {
      if (planFile.current === pending) setError('Could not confirm this read. Retry while this window remains open.');
    } finally { if (planFile.current === pending) setBusy('plan-pending'); else setBusy(''); }
  }

  function hideWithPlanWarning() {
    if (planFile.current && !window.confirm('Leave this conversation? The opened file will be lost before it is saved as a plan.')) return false;
    planFile.current = null;
    setBusy('');
    hide();
    return true;
  }

  function cancelTransfer() { void window.inheritiTray.inboxCancelTransfer(); }

  return { conversationId, items, normalItems, normalUnreadCount, parentItems, parentUnreadCount, mode, setMode: updateMode,
    draft, setDraft: updateDraft, marks, markSelection, unmarkSelection, unitReveals,
    segments: draftSegments(draft, marks, mode), revealed, revealSeconds, openingMessageId, busy, error, sendError, transfer, pendingMessage, acceptedMessages,
    select, refresh, clearHistory, send, sendFile, saveFile, saveFileAsPlan, cancelTransfer, view, retryAck: retryPlanAck, hide: hideWithPlanWarning };
}
