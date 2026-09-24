import { useEffect, useRef, useState } from 'react';
import { buildAsset } from '../asset-input.js';

export function usePlanEditFlow({ state, setState, messages }) {
  const [editing, setEditing] = useState(false);
  const [planId, setPlanId] = useState('');
  const [action, setAction] = useState('');
  const [assetId, setAssetId] = useState('');
  const [query, setQuery] = useState('');
  const [form, setForm] = useState({ assetType: '', assetName: '', fields: {}, file: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const activeOrganization = useRef(null);
  const session = useRef(null);
  session.current = { status: state?.status, organizationId: state?.selectedId };

  function close() {
    generation.current += 1;
    activeOrganization.current = null;
    setEditing(false);
    setAssetId('');
    setAction('');
    setForm({ assetType: '', assetName: '', fields: {}, file: null });
  }

  useEffect(() => window.inheritiTray.onHidden(() => {
    generation.current += 1;
    setEditing(false);
    setAssetId('');
    setAction('');
    setForm({ assetType: '', assetName: '', fields: {}, file: null });
  }), []);

  useEffect(() => {
    if (activeOrganization.current && (state?.status !== 'signed-in' || state?.selectedId !== activeOrganization.current)) close();
  }, [state?.status, state?.selectedId]);

  async function open() {
    const currentGeneration = ++generation.current;
    activeOrganization.current = state?.selectedId;
    setEditing(true);
    setPlanId('');
    setAction('');
    setAssetId('');
    setForm({ assetType: '', assetName: '', fields: {}, file: null });
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
      setForm({ assetType: '', assetName: '', fields: {}, file: null });
      setAssetId('');
    } catch { setError(messages.editFailed); }
    finally { setBusy(false); }
  }

  async function chooseAction(next) {
    const currentGeneration = ++generation.current;
    setAction(next);
    setAssetId('');
    setForm({ assetType: '', assetName: '', fields: {}, file: null });
    setError('');
    if (next !== 'replace' || !planId) return;
    setBusy(true);
    try {
      const nextState = await window.inheritiTray.listPlanAssets(planId);
      if (currentGeneration === generation.current) setState(nextState);
    } catch { if (currentGeneration === generation.current) setError(messages.editUnavailable); }
    finally { setBusy(false); }
  }

  async function chooseAsset(id) {
    const currentGeneration = ++generation.current;
    setAssetId(id);
    setBusy(true);
    setError('');
    try {
      const asset = await window.inheritiTray.getPlanAsset(planId, id);
      if (currentGeneration !== generation.current || session.current.status !== 'signed-in' || session.current.organizationId !== activeOrganization.current) return;
      const fields = {};
      for (const [field, value] of Object.entries(asset.secret || {})) {
        if (field === 'data' || field === 'mimeType' || field === 'fileName') continue;
        fields[field] = Array.isArray(value) ? value.join(' ') : String(value);
      }
      setForm({ assetType: asset.type, assetName: asset.meta.name, fields, file: null });
    } catch { if (currentGeneration === generation.current) { setAssetId(''); setError(messages.editUnavailable); } }
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
    try { setState(await window.inheritiTray.discardPlanEdit()); setError(''); close(); }
    catch { setError(messages.editRecoveryRequired); }
    finally { setBusy(false); }
  }

  return { editing, close, planId, setPlanId: (id) => { generation.current += 1; setPlanId(id); setAction(''); setAssetId(''); setForm({ assetType: '', assetName: '', fields: {}, file: null }); }, action, assetId, query, setQuery, chooseAction, chooseAsset, form, setForm, busy, error, open, submit, recover, discard };
}
