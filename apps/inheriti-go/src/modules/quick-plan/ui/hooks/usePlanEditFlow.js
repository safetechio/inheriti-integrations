import { useEffect, useRef, useState } from 'react';
import { buildAsset } from '../asset-input.js';
import { assetFormError } from '../asset-form-rules.js';
import { usePlanEditForm } from './usePlanEditForm.js';

export function usePlanEditFlow({ state, setState, messages }) {
  const [editing, setEditing] = useState(false);
  const [planId, setPlanId] = useState('');
  const [stage, setStage] = useState('pick');
  const [action, setAction] = useState('');
  const [assetId, setAssetId] = useState('');
  const [query, setQuery] = useState('');
  const { form, setForm, resetForm, loadAsset } = usePlanEditForm();
  const [busy, setBusy] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const generation = useRef(0);
  const loadedPlanId = useRef('');
  const activeOrganization = useRef(null);
  const session = useRef(null);
  session.current = { status: state?.status, organizationId: state?.selectedId };

  function close() {
    setConfirmation('');
    generation.current += 1;
    loadedPlanId.current = '';
    activeOrganization.current = null;
    setEditing(false);
    setAssetId('');
    setAction('');
    setPlanId('');
    setStage('pick');
    setQuery('');
    setError('');
    setBusy(false);
    resetForm();
  }

  useEffect(() => window.inheritiTray.onHidden(() => {
    generation.current += 1;
    loadedPlanId.current = '';
    setEditing(false);
    setStage('pick');
    setAssetId('');
    setQuery('');
    setAction('');
    setBusy(false);
    resetForm();
  }), []);

  useEffect(() => {
    if (activeOrganization.current && (state?.status !== 'signed-in' || state?.selectedId !== activeOrganization.current)) close();
  }, [state?.status, state?.selectedId]);

  useEffect(() => {
    if ((confirmation === 'cancel' || confirmation === 'back') && (state?.edit?.status !== 'loading' || !busy)) setConfirmation('');
  }, [confirmation, state?.edit?.status, busy]);

  async function open() {
    const currentGeneration = ++generation.current;
    loadedPlanId.current = '';
    activeOrganization.current = state?.selectedId;
    setEditing(true);
    setPlanId('');
    setStage('pick');
    setAction('');
    setAssetId('');
    resetForm();
    setBusy(true);
    setError('');
    try {
      const next = await window.inheritiTray.editablePlans();
      if (currentGeneration === generation.current) {
        setState(next);
        if (next.edit?.status === 'recovery-required' || next.edit?.status === 'error') setStage('access');
      }
    } catch { if (currentGeneration === generation.current) setError(messages.editUnavailable); }
    finally { if (currentGeneration === generation.current) setBusy(false); }
  }

  async function submit(event) {
    event.preventDefault();
    if (!planId || busy || canceling) return;
    setBusy(true);
    setError('');
    try {
      const definition = state.assetCatalog.find(({ id }) => id === form.assetType);
      const asset = await buildAsset(form, definition);
      setState(await (action === 'replace'
        ? window.inheritiTray.replacePlanAsset(planId, assetId, asset)
        : window.inheritiTray.addPlanAsset(planId, asset)));
      resetForm();
      setAssetId('');
    } catch (cause) { setError(assetFormError(cause, messages) || messages.editFailed); }
    finally { setBusy(false); }
  }

  async function chooseAction(next, selectedPlanId = planId) {
    if (busy || canceling) return;
    const currentGeneration = ++generation.current;
    setAction(next);
    setAssetId('');
    resetForm();
    setError('');
    if (!selectedPlanId) return;
    const needsAssets = next === 'replace' && loadedPlanId.current !== selectedPlanId;
    if (!needsAssets) return;
    setBusy(true);
    try {
      const nextState = await window.inheritiTray.listPlanAssets(selectedPlanId);
      if (currentGeneration === generation.current) {
        if (nextState.edit?.status === 'idle' && nextState.edit.planId === selectedPlanId) loadedPlanId.current = selectedPlanId;
        setState(nextState);
      }
    } catch { if (currentGeneration === generation.current) setError(messages.editUnavailable); }
    finally { if (currentGeneration === generation.current) setBusy(false); }
  }

  async function continueToAssets() {
    if (!planId || busy || canceling || stage !== 'pick') return;
    const currentGeneration = ++generation.current;
    setStage('access');
    setBusy(true);
    setError('');
    try {
      const next = await window.inheritiTray.listPlanAssets(planId);
      if (currentGeneration !== generation.current) return;
      setState(next);
      if (next.edit?.status === 'idle' && next.edit.planId === planId) {
        loadedPlanId.current = planId;
        setStage('manage');
        setAction('replace');
      }
    } catch { if (currentGeneration === generation.current) setError(messages.editUnavailable); }
    finally { if (currentGeneration === generation.current) setBusy(false); }
  }

  async function chooseAsset(id) {
    if (busy || canceling) return;
    const currentGeneration = ++generation.current;
    setAssetId(id);
    setBusy(true);
    setError('');
    try {
      const asset = await window.inheritiTray.getPlanAsset(planId, id);
      if (currentGeneration !== generation.current || session.current.status !== 'signed-in' || session.current.organizationId !== activeOrganization.current) return;
      loadAsset(asset);
    } catch { if (currentGeneration === generation.current) { setAssetId(''); setError(messages.editUnavailable); } }
    finally { setBusy(false); }
  }

  async function recover() {
    setBusy(true);
    try { setState(await window.inheritiTray.recoverPlanEdit()); }
    catch { setError(messages.editRecoveryRequired); }
    finally { setBusy(false); }
  }

  async function retryAccess() {
    if (!planId || busy || canceling) return;
    setBusy(true);
    setError('');
    try {
      const next = await window.inheritiTray.listPlanAssets(planId);
      if (next.edit?.status === 'idle' && next.edit.planId === planId) {
        loadedPlanId.current = planId;
        setStage('manage');
        setAction('replace');
      }
      setState(next);
    } catch { setError(messages.editUnavailable); }
    finally { setBusy(false); }
  }

  async function discard() {
    setConfirmation('discard');
  }

  async function confirm() {
    const actionToConfirm = confirmation;
    setConfirmation('');
    if (actionToConfirm === 'cancel' || actionToConfirm === 'back') {
      if (state.edit?.status === 'saving' || state.edit?.status === 'recovery-required') return;
      await cancelNow(actionToConfirm === 'cancel');
      return;
    }
    if (actionToConfirm !== 'discard') return;
    if (state.edit?.status === 'saving') return;
    setBusy(true);
    try { setState(await window.inheritiTray.discardPlanEdit()); setError(''); close(); }
    catch { setError(messages.editDiscardFailed); }
    finally { setBusy(false); }
  }

  async function cancel() {
    if (canceling || state.edit?.status === 'saving') return;
    if (stage !== 'pick' && busy && state.edit?.status === 'loading') {
      setConfirmation('cancel');
      return;
    }
    await cancelNow(true);
  }

  async function back() {
    if (canceling || state.edit?.status === 'saving' || state.edit?.status === 'recovery-required') return;
    if (stage === 'pick') { close(); return; }
    if (busy && state.edit?.status === 'loading') { setConfirmation('back'); return; }
    await cancelNow(false);
  }

  async function cancelNow(closeAfter) {
    if (state.edit?.status === 'saving' || state.edit?.status === 'recovery-required') return;
    if (stage === 'pick') {
      close();
      return;
    }
    generation.current += 1;
    setCanceling(true);
    setError('');
    try {
      const next = await window.inheritiTray.cancelPlanEdit();
      setState(next);
      if (closeAfter) close();
      else {
        loadedPlanId.current = '';
        setPlanId('');
        setAction('');
        setAssetId('');
        setQuery('');
        setStage('pick');
        setBusy(false);
        resetForm();
      }
    } catch {
      setError(messages.cancelEditFailed);
      setBusy(false);
    } finally {
      setCanceling(false);
    }
  }

  return { editing, close, back, cancel, canceling, confirmation, confirm, dismissConfirmation: () => setConfirmation(''), planId, stage, setPlanId: (id) => { setPlanId(id); setAction(''); setAssetId(''); resetForm(); }, continueToAssets, action, assetId, query, setQuery, chooseAction, chooseAsset, form, setForm, busy, error, open, submit, retryAccess, recover, discard };
}
