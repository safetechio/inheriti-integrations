import { useEffect, useRef, useState } from 'react';
import { buildAsset } from '../asset-input.js';
import { assetFormError } from '../asset-form-rules.js';
import { usePlanEditForm } from './usePlanEditForm.js';

export function usePlanEditFlow({ state, setState, messages }) {
  const [editing, setEditing] = useState(false);
  const [planId, setPlanId] = useState('');
  const [action, setAction] = useState('');
  const [assetId, setAssetId] = useState('');
  const [query, setQuery] = useState('');
  const { form, setForm, resetForm, loadAsset } = usePlanEditForm();
  const [busy, setBusy] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const loadedPlanId = useRef('');
  const activeOrganization = useRef(null);
  const session = useRef(null);
  session.current = { status: state?.status, organizationId: state?.selectedId };

  function close() {
    generation.current += 1;
    loadedPlanId.current = '';
    activeOrganization.current = null;
    setEditing(false);
    setAssetId('');
    setAction('');
    setPlanId('');
    setQuery('');
    setError('');
    setBusy(false);
    resetForm();
  }

  useEffect(() => window.inheritiTray.onHidden(() => {
    generation.current += 1;
    loadedPlanId.current = '';
    setEditing(false);
    setAssetId('');
    setQuery('');
    setAction('');
    setBusy(false);
    resetForm();
  }), []);

  useEffect(() => {
    if (activeOrganization.current && (state?.status !== 'signed-in' || state?.selectedId !== activeOrganization.current)) close();
  }, [state?.status, state?.selectedId]);

  async function open() {
    const currentGeneration = ++generation.current;
    loadedPlanId.current = '';
    activeOrganization.current = state?.selectedId;
    setEditing(true);
    setPlanId('');
    setAction('');
    setAssetId('');
    resetForm();
    setBusy(true);
    setError('');
    try {
      const next = await window.inheritiTray.editablePlans();
      if (currentGeneration === generation.current) setState(next);
    } catch { if (currentGeneration === generation.current) setError(messages.editUnavailable); }
    finally { setBusy(false); }
  }

  async function submit(event) {
    event.preventDefault();
    if (!planId || busy) return;
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
    if (busy) return;
    const currentGeneration = ++generation.current;
    setAction(next);
    setAssetId('');
    resetForm();
    setError('');
    if (!selectedPlanId) return;
    const changingPlan = state.edit?.planId && state.edit.planId !== selectedPlanId;
    const needsAssets = next === 'replace' && (changingPlan || loadedPlanId.current !== selectedPlanId);
    if (!changingPlan && !needsAssets) return;
    setBusy(true);
    try {
      if (changingPlan) {
        loadedPlanId.current = '';
        const cleared = await window.inheritiTray.discardPlanEdit();
        if (currentGeneration !== generation.current) return;
        setState(cleared);
      }
      if (!needsAssets) return;
      const nextState = await window.inheritiTray.listPlanAssets(selectedPlanId);
      if (currentGeneration === generation.current) {
        if (nextState.edit?.status === 'idle' && nextState.edit.planId === selectedPlanId) loadedPlanId.current = selectedPlanId;
        setState(nextState);
      }
    } catch { if (currentGeneration === generation.current) setError(messages.editUnavailable); }
    finally { if (currentGeneration === generation.current) setBusy(false); }
  }

  async function chooseAsset(id) {
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
    if (!planId || busy) return;
    setBusy(true);
    setError('');
    try {
      const next = await window.inheritiTray.listPlanAssets(planId);
      if (next.edit?.status === 'idle' && next.edit.planId === planId) loadedPlanId.current = planId;
      setState(next);
    } catch { setError(messages.editUnavailable); }
    finally { setBusy(false); }
  }

  async function discard() {
    if (!window.confirm(messages.discardEditWarning)) return;
    setBusy(true);
    try { setState(await window.inheritiTray.discardPlanEdit()); setError(''); close(); }
    catch { setError(messages.editDiscardFailed); }
    finally { setBusy(false); }
  }

  async function cancel() {
    if (canceling) return;
    if (!busy || state.edit?.status !== 'loading') {
      const hasSelectedPlan = Boolean(planId || state.edit?.planId);
      close();
      if (hasSelectedPlan) void window.inheritiTray.cancelPlanEdit().catch(() => {});
      return;
    }
    if ((planId || state.edit?.planId) && !window.confirm(messages.cancelEditWarning)) return;
    generation.current += 1;
    setCanceling(true);
    setError('');
    try {
      setState(await window.inheritiTray.cancelPlanEdit());
      close();
    } catch {
      setError(messages.cancelEditFailed);
    } finally {
      setCanceling(false);
    }
  }

  return { editing, close, cancel, canceling, planId, setPlanId: (id) => { generation.current += 1; setPlanId(id); setAction(''); setAssetId(''); resetForm(); if (id) void chooseAction('replace', id); }, action, assetId, query, setQuery, chooseAction, chooseAsset, form, setForm, busy, error, open, submit, retryAccess, recover, discard };
}
