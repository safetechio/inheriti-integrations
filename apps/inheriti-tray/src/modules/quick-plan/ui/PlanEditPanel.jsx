import { useState } from 'react';
import { ScreenHeader } from '../../_shared/ui/components/ScreenHeader.jsx';
import { ScreenFooter } from '../../_shared/ui/components/ScreenFooter.jsx';
import { EmptyState } from '../../_shared/ui/components/EmptyState.jsx';
import { QuickPlanForm } from './QuickPlanForm.jsx';
import { PlanEditProgress } from './PlanEditProgress.jsx';
import { PlanEditSuccess } from './PlanEditSuccess.jsx';
import { PlanList } from './components/PlanList.jsx';
import './edit-screen.css';

function AssetList({ assets, hasAssets, messages, selectedId, onSelect, disabled }) {
  if (!assets.length) return <p className="edit-asset-empty" role="status">{hasAssets ? 'No assets match your search.' : 'No assets in this plan. Choose Add an asset to continue.'}</p>;
  return <fieldset className="edit-asset-list" disabled={disabled} aria-label={messages.chooseAsset}>
    {assets.map(({ id, name, type }) => <label className="edit-asset-row" key={id} data-selected={selectedId === id}>
      <input type="radio" name="existing-asset" value={id} checked={selectedId === id} onChange={() => void onSelect(id)} />
      <span><strong>{name}</strong><small>{messages.assetTypes[type] || type}</small></span>
    </label>)}
  </fieldset>;
}

function EditConfirmation({ flow, messages }) {
  if (!flow.confirmation) return null;
  const discarding = flow.confirmation === 'discard';
  return <div className="edit-confirmation" role="alertdialog" aria-labelledby="edit-confirmation-title" onKeyDown={(event) => { if (event.key === 'Escape') flow.dismissConfirmation(); }}>
    <strong id="edit-confirmation-title">{discarding ? messages.discardEditWarning : messages.cancelEditWarning}</strong>
    <div>
      <button type="button" className="button-secondary" autoFocus onClick={flow.dismissConfirmation}>Keep editing</button>
      <button type="button" className={discarding ? 'button-danger' : ''} onClick={() => void flow.confirm()}>{discarding ? messages.discardEdit : flow.confirmation === 'back' ? 'Back to plans' : 'Close edit'}</button>
    </div>
  </div>;
}

export function PlanEditPanel({ messages, state, flow, onOpenApp, onSignIn }) {
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [planSearch, setPlanSearch] = useState('');
  const edit = state.edit ?? { plans: [], assets: [], status: 'idle', available: false };
  const picking = flow.stage === 'pick' && edit.status !== 'error' && edit.status !== 'recovery-required' && edit.status !== 'saving';
  const managing = flow.stage === 'manage';
  const blocked = flow.busy || flow.canceling || edit.status === 'saving' || edit.status === 'error' || edit.status === 'recovery-required' || edit.actorMismatch;
  const cancelDisabled = flow.canceling || edit.status === 'saving' || edit.status === 'recovery-required' || (flow.busy && edit.status !== 'loading');
  const progressOnly = edit.status === 'saving';
  const failed = edit.status === 'error' || edit.status === 'recovery-required';
  const formVisible = managing && (flow.action === 'add' || (flow.action === 'replace' && flow.assetId && flow.form.assetType));
  const filteredAssets = (edit.assets || []).filter(({ name, type }) => `${name} ${messages.assetTypes[type] || type}`.toLowerCase().includes(flow.query.toLowerCase()));
  const activeAssetId = filteredAssets.some(({ id }) => id === selectedAssetId) ? selectedAssetId : filteredAssets[0]?.id || '';
  const noEligiblePlans = !flow.busy && edit.status === 'idle' && edit.plans.length === 0;
  const matchingPlans = edit.plans.filter(({ name }) => name.toLocaleLowerCase().includes(planSearch.trim().toLocaleLowerCase()));
  const selectedPlan = edit.plans.find(({ id }) => id === (flow.planId || edit.planId));

  if (edit.status === 'updated') return <PlanEditSuccess messages={messages}
    planId={edit.planId}
    planName={edit.plans.find(({ id }) => id === edit.planId)?.name || messages.plan}
    replaced={flow.action === 'replace'} onBack={flow.close} onOpenApp={onOpenApp} />;

  return <section className="tray-screen edit-screen" aria-label={messages.addOrEditAsset}>
    <ScreenHeader title={messages.addOrEditAsset} onBack={edit.status === 'recovery-required' || edit.actorMismatch ? flow.close : () => void flow.back()} backDisabled={edit.status !== 'recovery-required' && !edit.actorMismatch && cancelDisabled} />
    <div className="tray-scroll edit-scroll">
      {picking && edit.plans.length > 0 && <>
        <div className="edit-plan-heading"><span id="edit-plan-label">Your plans</span><span>{planSearch.trim() ? `${matchingPlans.length} of ${edit.plans.length}` : edit.plans.length} {edit.plans.length === 1 ? 'plan' : 'plans'}</span></div>
        <label className="edit-plan-search-field" htmlFor="edit-plan-search"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="7" cy="7" r="5" /><path d="m11 11 3.5 3.5" /></svg><input id="edit-plan-search" type="search" aria-label="Search plans by name" placeholder="Search plans" value={planSearch} onChange={(event) => { setPlanSearch(event.target.value); flow.setPlanId(''); }} maxLength={100} disabled={blocked || flow.canceling} /></label>
        <PlanList key={planSearch} options={matchingPlans} value={flow.planId} onChange={(id) => { setSelectedAssetId(''); flow.setPlanId(id); }} disabled={blocked || flow.canceling} />
      </>}
      {picking && flow.busy && !edit.plans.length && <p className="edit-picker-loading" role="status">Loading plans…</p>}
      {!picking && selectedPlan && <div className="edit-selected-plan"><small>Selected plan</small><strong>{selectedPlan.name}</strong></div>}
      {!picking && <PlanEditProgress messages={messages} edit={edit} busy={flow.busy} onRetry={() => void flow.retryAccess()} />}
      {picking && noEligiblePlans && <EmptyState title={messages.noEditablePlansTitle} description={messages.noEditablePlans} actionLabel={messages.openApp} onAction={onOpenApp} />}
      {edit.message && !(edit.status === 'error' && edit.phase) && <p role="status">{edit.message}</p>}
      {edit.status === 'recovery-required' && edit.canRecover && <button type="button" disabled={flow.busy} onClick={() => void flow.recover()}>{messages.recoverEdit}</button>}
      {edit.needsSignIn && <button type="button" disabled={flow.busy} onClick={onSignIn}>{messages.signIn}</button>}
      {!edit.needsSignIn && (edit.status === 'error' || edit.status === 'recovery-required') && edit.canDiscard && !flow.confirmation && <button className="button-danger" type="button" disabled={flow.busy} onClick={() => void flow.discard()}>{messages.discardEdit}</button>}
      <EditConfirmation flow={flow} messages={messages} />
      {edit.status === 'error' && !edit.canDiscard && !edit.needsSignIn && <button type="button" disabled={flow.busy} onClick={() => void flow.open()}>{messages.retryLoadingPlans}</button>}
      {managing && !progressOnly && !failed && <div className="edit-mode" role="group" aria-label={messages.addOrEditAsset}>
        <button type="button" className={flow.action === 'add' ? 'active' : ''} aria-pressed={flow.action === 'add'} disabled={blocked} onClick={() => void flow.chooseAction('add')}>{messages.addAsset}</button>
        <button type="button" className={flow.action === 'replace' ? 'active' : ''} aria-pressed={flow.action === 'replace'} disabled={blocked} onClick={() => void flow.chooseAction('replace')}>{messages.editAsset}</button>
      </div>}
      {managing && flow.action === 'replace' && !progressOnly && !formVisible && !failed && <>
        <label className="edit-search" htmlFor="asset-search"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg><input id="asset-search" type="search" placeholder={messages.findAsset} aria-label={messages.findAsset} value={flow.query} onChange={(event) => flow.setQuery(event.target.value)} /></label>
        <AssetList assets={filteredAssets} hasAssets={Boolean(edit.assets?.length)} messages={messages} selectedId={activeAssetId} onSelect={setSelectedAssetId} disabled={blocked} />
      </>}
      {formVisible && !progressOnly && !failed && <QuickPlanForm messages={messages} state={state} form={flow.form} setForm={flow.setForm}
        onReview={(event) => void flow.submit(event)} onCancel={() => void flow.cancel()}
        error={flow.error} preparing={blocked} editMode replaceMode={flow.action === 'replace'} />}
      {flow.error && !formVisible && <p className="error" role="alert">{flow.error}</p>}
    </div>
    {!formVisible && !progressOnly && !failed && <ScreenFooter>
      <button className="button-secondary" type="button" disabled={cancelDisabled} onClick={() => void flow.cancel()}>{flow.canceling ? messages.cancelingEdit : messages.cancel}</button>
      {picking && !noEligiblePlans && <button type="button" disabled={blocked || !flow.planId || !matchingPlans.some(({ id }) => id === flow.planId)} onClick={() => void flow.continueToAssets()}>Continue</button>}
      {managing && <button type="button" disabled={blocked || (flow.action === 'replace' && !activeAssetId)} onClick={() => flow.action === 'replace' ? void flow.chooseAsset(activeAssetId) : void flow.chooseAction('add')}>{flow.action === 'replace' ? messages.editAssetAction : messages.addAsset}</button>}
    </ScreenFooter>}
  </section>;
}
