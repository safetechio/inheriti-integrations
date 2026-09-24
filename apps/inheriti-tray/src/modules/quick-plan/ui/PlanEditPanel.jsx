import { SelectField } from '../../_shared/ui/components/Form/Fields.jsx';
import { QuickPlanForm } from './QuickPlanForm.jsx';

export function PlanEditPanel({ messages, state, flow }) {
  const edit = state.edit ?? { plans: [], assets: [], status: 'idle', available: false };
  const filteredAssets = (edit.assets || []).filter(({ name, type }) => `${name} ${messages.assetTypes[type] || type}`.toLowerCase().includes(flow.query.toLowerCase()));
  return <section aria-label={messages.addOrEditAsset}>
    {(flow.busy || edit.status === 'loading' || edit.status === 'saving') && <p role="status">{edit.status === 'saving' ? messages.savingEdit : messages.loadingPlans}</p>}
    <SelectField id="edit-plan" label={messages.choosePlan} value={flow.planId}
      onChange={flow.setPlanId} disabled={flow.busy || edit.status === 'saving' || edit.status === 'recovery-required' || edit.actorMismatch}
      options={[{ value: '', label: messages.choosePlan }, ...edit.plans.map(({ id, name }) => ({ value: id, label: name }))]} />
    {edit.status === 'idle' && edit.plans.length === 0 && <p role="status">{messages.noEditablePlans}</p>}
    {edit.message && <p role="status">{edit.message}</p>}
    {edit.status === 'updated' && <p role="status">{messages.assetAdded}</p>}
    {edit.status === 'recovery-required' && edit.canRecover && <button type="button" disabled={flow.busy} onClick={() => void flow.recover()}>{messages.recoverEdit}</button>}
    {(edit.status === 'error' || edit.status === 'recovery-required') && <button type="button" disabled={flow.busy} onClick={() => void flow.discard()}>{messages.discardEdit}</button>}
    {flow.planId && edit.status !== 'recovery-required' && edit.status !== 'updated' && <div className="buttons">
      <button type="button" disabled={flow.busy} onClick={() => void flow.chooseAction('add')}>{messages.addAsset}</button>
      <button type="button" disabled={flow.busy} onClick={() => void flow.chooseAction('replace')}>{messages.editAsset}</button>
    </div>}
    {flow.action === 'replace' && edit.status !== 'recovery-required' && <>
      <label htmlFor="asset-search">{messages.findAsset}</label>
      <input id="asset-search" type="search" value={flow.query} onChange={(event) => flow.setQuery(event.target.value)} />
      <SelectField id="existing-asset" label={messages.chooseAsset} value={flow.assetId}
        onChange={(id) => void flow.chooseAsset(id)} disabled={flow.busy || edit.status === 'saving'}
        options={[{ value: '', label: messages.chooseAsset }, ...filteredAssets.map(({ id, name, type }) => ({ value: id, label: `${name} (${messages.assetTypes[type] || type})` }))]} />
    </>}
    {(flow.action === 'add' || (flow.action === 'replace' && flow.assetId && flow.form.assetType)) && edit.status !== 'updated' && <QuickPlanForm messages={messages} state={state} form={flow.form} setForm={flow.setForm}
      onReview={(event) => void flow.submit(event)} onCancel={() => void flow.discard()}
      error={flow.error} preparing={flow.busy || edit.status === 'saving' || edit.status === 'recovery-required' || edit.actorMismatch} editMode replaceMode={flow.action === 'replace'} />}
    {flow.error && !flow.form.assetType && <p className="error" role="alert">{flow.error}</p>}
  </section>;
}
