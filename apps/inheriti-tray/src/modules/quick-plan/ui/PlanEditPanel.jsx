import { useState } from 'react';
import { ScreenHeader } from '../../_shared/ui/components/ScreenHeader.jsx';
import { ScreenFooter } from '../../_shared/ui/components/ScreenFooter.jsx';
import { QuickPlanForm } from './QuickPlanForm.jsx';
import { PlanEditProgress } from './PlanEditProgress.jsx';
import { PlanEditSuccess } from './PlanEditSuccess.jsx';
import { PlanPicker } from './components/PlanPicker.jsx';
import './edit-screen.css';

function AssetList({ assets, messages, selectedId, onSelect, disabled }) {
  return <fieldset className="edit-asset-list" disabled={disabled} aria-label={messages.chooseAsset}>
    {assets.map(({ id, name, type }) => <label className="edit-asset-row" key={id} data-selected={selectedId === id}>
      <input type="radio" name="existing-asset" value={id} checked={selectedId === id} onChange={() => void onSelect(id)} />
      <span><strong>{name}</strong><small>{messages.assetTypes[type] || type}</small></span>
    </label>)}
  </fieldset>;
}

export function PlanEditPanel({ messages, state, flow, onOpenApp, onSignIn }) {
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const edit = state.edit ?? { plans: [], assets: [], status: 'idle', available: false };
  const blocked = flow.busy || edit.status === 'saving' || edit.status === 'error' || edit.status === 'recovery-required' || edit.actorMismatch;
  const cancelDisabled = flow.canceling || edit.status === 'saving' || (flow.busy && (!flow.planId || edit.status !== 'loading'));
  const accessingAssets = flow.action === 'replace' && flow.busy && edit.status === 'loading' && Boolean(flow.planId);
  const progressOnly = edit.status === 'saving';
  const failed = edit.status === 'error' || edit.status === 'recovery-required';
  const formVisible = flow.action === 'add' || (flow.action === 'replace' && flow.assetId && flow.form.assetType);
  const filteredAssets = (edit.assets || []).filter(({ name, type }) => `${name} ${messages.assetTypes[type] || type}`.toLowerCase().includes(flow.query.toLowerCase()));
  const activeAssetId = filteredAssets.some(({ id }) => id === selectedAssetId) ? selectedAssetId : filteredAssets[0]?.id || '';

  if (edit.status === 'updated') return <PlanEditSuccess messages={messages}
    planId={edit.planId}
    planName={edit.plans.find(({ id }) => id === edit.planId)?.name || messages.plan}
    replaced={flow.action === 'replace'} onBack={flow.close} onOpenApp={onOpenApp} />;

  return <section className="tray-screen edit-screen" aria-label={messages.addOrEditAsset}>
    <ScreenHeader title={messages.addOrEditAsset} onBack={edit.status === 'recovery-required' || edit.status === 'updated' || edit.actorMismatch ? flow.close : () => void flow.cancel()} backDisabled={cancelDisabled} />
    <div className="tray-scroll edit-scroll">
      {!progressOnly && edit.plans.length > 0 && <PlanPicker plans={edit.plans} value={flow.planId} onChange={(id) => { setSelectedAssetId(''); flow.setPlanId(id); }} disabled={blocked || flow.canceling} label={messages.plan || 'Plan'} placeholder={messages.choosePlan} />}
      <PlanEditProgress messages={messages} edit={edit} busy={flow.busy} />
      {edit.status === 'idle' && edit.plans.length === 0 && <p role="status">{messages.noEditablePlans}</p>}
      {edit.message && <p role="status">{edit.message}</p>}
      {edit.status === 'recovery-required' && edit.canRecover && <button type="button" disabled={flow.busy} onClick={() => void flow.recover()}>{messages.recoverEdit}</button>}
      {edit.needsSignIn && <button type="button" disabled={flow.busy} onClick={onSignIn}>{messages.signIn}</button>}
      {!edit.needsSignIn && (edit.status === 'error' || edit.status === 'recovery-required') && edit.canDiscard && <button className="button-danger" type="button" disabled={flow.busy} onClick={() => void flow.discard()}>{messages.discardEdit}</button>}
      {edit.status === 'error' && !edit.canDiscard && !edit.needsSignIn && <button type="button" disabled={flow.busy} onClick={() => void flow.open()}>{messages.retryLoadingPlans}</button>}
      {flow.planId && !accessingAssets && !progressOnly && !failed && <div className="edit-mode" role="group" aria-label={messages.addOrEditAsset}>
        <button type="button" className={flow.action === 'add' ? 'active' : ''} aria-pressed={flow.action === 'add'} disabled={blocked} onClick={() => void flow.chooseAction('add')}>{messages.addAsset}</button>
        <button type="button" className={flow.action === 'replace' ? 'active' : ''} aria-pressed={flow.action === 'replace'} disabled={blocked} onClick={() => void flow.chooseAction('replace')}>{messages.editAsset}</button>
      </div>}
      {flow.action === 'replace' && !accessingAssets && !progressOnly && !formVisible && !failed && <>
        <label className="edit-search" htmlFor="asset-search"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg><input id="asset-search" type="search" placeholder={messages.findAsset} aria-label={messages.findAsset} value={flow.query} onChange={(event) => flow.setQuery(event.target.value)} /></label>
        <AssetList assets={filteredAssets} messages={messages} selectedId={activeAssetId} onSelect={setSelectedAssetId} disabled={blocked} />
      </>}
      {formVisible && !progressOnly && !failed && <QuickPlanForm messages={messages} state={state} form={flow.form} setForm={flow.setForm}
        onReview={(event) => void flow.submit(event)} onCancel={() => void flow.cancel()}
        error={flow.error} preparing={blocked} editMode replaceMode={flow.action === 'replace'} />}
      {flow.error && (failed || !flow.form.assetType) && <p className="error" role="alert">{flow.error}</p>}
    </div>
    {!formVisible && !progressOnly && !failed && <ScreenFooter>
      <button className="button-secondary" type="button" disabled={cancelDisabled} onClick={() => void flow.cancel()}>{flow.canceling ? messages.cancelingEdit : messages.cancel}</button>
      {!accessingAssets && <button type="button" disabled={blocked || !flow.planId || (flow.action === 'replace' && !activeAssetId)} onClick={() => flow.action === 'replace' ? void flow.chooseAsset(activeAssetId) : void flow.chooseAction('add')}>{flow.action === 'replace' ? messages.editAssetAction : messages.addAsset}</button>}
    </ScreenFooter>}
  </section>;
}
