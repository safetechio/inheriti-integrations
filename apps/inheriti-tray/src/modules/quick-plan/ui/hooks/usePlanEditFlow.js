import { useState } from 'react';
import { buildAsset } from '../asset-input.js';

export function usePlanEditFlow({ state, setState, messages }) {
  const [editing, setEditing] = useState(false);
  const [planId, setPlanId] = useState('');
  const [form, setForm] = useState({ assetType: '', assetName: '', fields: {}, file: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function open() {
    setEditing(true);
    setBusy(true);
    setError('');
    try { setState(await window.inheritiTray.editablePlans()); }
    catch { setError(messages.editUnavailable); }
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
      setState(await window.inheritiTray.addPlanAsset(planId, asset));
    } catch { setError(messages.editFailed); }
    finally { setBusy(false); }
  }

  async function recover() {
    setBusy(true);
    try { setState(await window.inheritiTray.recoverPlanEdit()); }
    catch { setError(messages.editRecoveryRequired); }
    finally { setBusy(false); }
  }

  async function discard() {
    if (!window.confirm(messages.discardEditWarning)) return;
    setBusy(true);
    try { setState(await window.inheritiTray.discardPlanEdit()); setError(''); setEditing(false); }
    catch { setError(messages.editRecoveryRequired); }
    finally { setBusy(false); }
  }

  return { editing, close: () => setEditing(false), planId, setPlanId, form, setForm, busy, error, open, submit, recover, discard };
}
