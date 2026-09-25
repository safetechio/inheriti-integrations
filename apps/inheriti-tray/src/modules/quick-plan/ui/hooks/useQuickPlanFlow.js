import { useEffect, useRef, useState } from 'react';
import { buildAsset } from '../asset-input.js';
import { assetFormError } from '../asset-form-rules.js';

const blankForm = (teams = []) => ({
  title: '',
  audience: teams.length ? 'team' : 'private',
  teamId: teams[0]?.id || '',
  assetType: '',
  assetName: '',
  fields: {},
  file: null,
});

export function useQuickPlanFlow({ state, setState, messages, canHandleAction, onEditAction }) {
  const [step, setStep] = useState('actions');
  const [form, setForm] = useState(() => blankForm(state?.teams));
  const [draft, setDraft] = useState(null);
  const [readySummary, setReadySummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);

  useEffect(() => {
    if (state?.status === 'signed-out') clearDraft();
  }, [state?.status]);

  useEffect(() => window.inheritiTray.onAction((action) => {
    if (!canHandleAction || step !== 'actions' || !state?.selectedId || state.status !== 'signed-in' || busy || preparing) return;
    if (action === messages.addOrEditAsset) {
      onEditAction();
      return;
    }
    if (action === messages.shareWithTeam) {
      openCapture('team');
      return;
    }
    if (action === messages.savePrivately) {
      openCapture('private');
      return;
    }
    if (action === messages.savePlan) {
      openCapture();
      return;
    }
    setError(messages.comingLater(action));
  }), [state?.selectedId, state?.status, busy, preparing, step, canHandleAction, onEditAction, messages]);

  function clearDraft() {
    generation.current += 1;
    setForm(blankForm(state?.teams));
    setDraft(null);
    setReadySummary(null);
    setStep('actions');
    setBusy(false);
    setPreparing(false);
    setError('');
  }

  function openCapture(audience = state?.teams?.length ? 'team' : 'private') {
    setForm((current) => ({ ...current, audience, teamId: current.teamId || state?.teams?.[0]?.id || '' }));
    setStep('capture');
    setError('');
  }

  async function abandon() {
    if (state?.creation?.planId && !window.confirm(messages.abandonWarning)) return false;
    try {
      setState(await window.inheritiTray.abandonCreation());
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : messages.retryError);
      return false;
    }
  }

  async function cancelCapture() {
    generation.current += 1;
    if (state?.creation?.status === 'error' && !(await abandon())) return;
    clearDraft();
  }

  async function reviewCapture(event) {
    event.preventDefault();
    if (preparing) return;
    const currentGeneration = generation.current;
    setPreparing(true);
    try {
      const definition = state.assetCatalog.find(({ id }) => id === form.assetType);
      const input = { title: form.title.trim(), asset: await buildAsset(form, definition) };
      if (generation.current !== currentGeneration) return;
      if (form.audience === 'team') input.teamId = form.teamId;
      setDraft(input);
      setError('');
      setStep('review');
    } catch (cause) {
      if (generation.current === currentGeneration) {
        setError(assetFormError(cause, messages) || messages.fileReadError);
      }
    } finally {
      if (generation.current === currentGeneration) setPreparing(false);
    }
  }

  async function startOver(keepForm) {
    generation.current += 1;
    if (!(await abandon())) return;
    if (!keepForm) setForm(blankForm(state?.teams));
    setDraft(null);
    setError('');
    setStep('capture');
  }

  async function submitCapture() {
    if (busy || !draft) return;
    const currentGeneration = generation.current;
    setBusy(true);
    setError('');
    try {
      const next = await window.inheritiTray.createQuickPlan(draft);
      if (generation.current !== currentGeneration) return;
      setState(next);
      if (next.creation?.status === 'ready') {
        setReadySummary({ title: form.title, assetName: form.assetName, assetType: form.assetType, audience: form.audience, teamId: form.teamId });
        setDraft(null);
        setForm(blankForm(state?.teams));
        setStep('ready');
      }
    } catch (cause) {
      if (generation.current === currentGeneration) {
        setError(cause instanceof Error ? cause.message : messages.retryError);
      }
    } finally {
      if (generation.current === currentGeneration) setBusy(false);
    }
  }

  async function cancelKeyRequest() {
    try {
      await window.inheritiTray.cancelKeyRequest();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : messages.retryError);
    }
  }

  async function signOut() {
    if (state?.creation?.planId && state.creation.status !== 'ready' && !window.confirm(messages.abandonWarning)) return;
    generation.current += 1;
    try {
      setState(await window.inheritiTray.signOut());
      clearDraft();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : messages.retryError);
    }
  }

  async function selectOrganization(id) {
    if (!id) return;
    generation.current += 1;
    if (state?.creation?.planId && !(await abandon())) return;
    try {
      setState(await window.inheritiTray.select(id));
      clearDraft();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : messages.retryError);
    }
  }

  return {
    step, form, setForm, readySummary, busy, preparing, error,
    openCapture, clearDraft, cancelCapture, reviewCapture,
    startOver, submitCapture, cancelKeyRequest, signOut, selectOrganization, setStep,
  };
}
