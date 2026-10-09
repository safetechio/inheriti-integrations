import { useEffect, useState } from 'react';
import { INBOX_REVEAL_SECONDS } from '../inboxSettings.js';
import { finishAcknowledgement } from './useInboxReadActions.js';

export function useInboxUnitReveals(conversationId, generation, setBusy, setError, refresh) {
  const [units, setUnits] = useState(() => new Map());
  const [openingUnitId, setOpeningUnitId] = useState('');
  const [openingProgress, setOpeningProgress] = useState(null);
  const [summary, setSummary] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!Array.from(units.values()).some(unit => unit.text && unit.hideAt)) return;
    const timer = setInterval(() => {
      const time = Date.now();
      setNow(time);
      setUnits(current => {
        const next = new Map(current);
        let changed = false;
        for (const [id, unit] of next) if (unit.text && unit.hideAt <= time) {
          next.set(id, { messageId: id, acknowledgement: unit.acknowledgement });
          changed = true;
        }
        return changed ? next : current;
      });
    }, 250);
    return () => clearInterval(timer);
  }, [units]);

  async function reveal(parentId, unitId, progress, keepProgress = false) {
    const current = generation.current;
    setOpeningUnitId(unitId);
    setOpeningProgress(progress);
    setBusy('opening-unit');
    setError('');
    try {
      const result = await window.inheritiTray.inboxRevealUnit(conversationId, parentId, unitId);
      if (generation.current !== current) return false;
      setUnits(previous => new Map(previous).set(unitId, {
        messageId: unitId, text: result.text, suggestion: result.suggestion, acknowledgement: result.acknowledgement,
        hideAt: Date.now() + INBOX_REVEAL_SECONDS * 1000,
      }));
      void refresh();
      return true;
    } catch {
      if (generation.current === current) setError('Could not reveal this protected part. Other parts remain available.');
      return false;
    } finally {
      if (generation.current === current && !keepProgress) { setOpeningUnitId(''); setOpeningProgress(null); setBusy(''); }
    }
  }

  async function revealAll(parentId, unitIds) {
    const current = generation.current;
    setSummary(null);
    let succeeded = 0;
    let failed = 0;
    try {
      for (const [index, unitId] of unitIds.entries()) {
        if (generation.current !== current) return;
        if (await reveal(parentId, unitId, { current: index + 1, total: unitIds.length, remaining: true }, true)) succeeded += 1;
        else failed += 1;
      }
      if (generation.current === current) setSummary({ parentId, succeeded, failed });
    } finally {
      if (generation.current === current) { setOpeningUnitId(''); setOpeningProgress(null); setBusy(''); }
    }
  }

  async function retry(unitId) {
    const unit = units.get(unitId);
    if (unit?.acknowledgement !== 'PENDING') return;
    const current = generation.current;
    setBusy('acknowledging');
    try {
      const result = await window.inheritiTray.inboxRetryAck(conversationId, unitId);
      if (generation.current !== current) return;
      setUnits(previous => {
        const finished = finishAcknowledgement(previous.get(unitId), unitId, result.acknowledgement);
        return new Map(previous).set(unitId, finished ?? { messageId: unitId, acknowledgement: 'ACKNOWLEDGED' });
      });
      if (result.acknowledgement === 'ACKNOWLEDGED') void refresh();
    } catch {
      if (generation.current === current) setError('Could not confirm this read. Try again while the acknowledgement is pending.');
    } finally {
      if (generation.current === current) setBusy('');
    }
  }

  function hide(unitId) {
    setUnits(previous => {
      const next = new Map(previous);
      const unit = next.get(unitId);
      if (unit) next.set(unitId, { messageId: unitId, acknowledgement: unit.acknowledgement });
      return next;
    });
    void window.inheritiTray.inboxHideText();
  }

  function clear() { setUnits(new Map()); setSummary(null); setOpeningProgress(null); }
  return { units, openingUnitId, openingProgress, summary, now, reveal, revealAll, retry, hide, clear };
}
