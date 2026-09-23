import { SelectField } from '../../_shared/ui/components/Form/Fields.jsx';
import { QuickPlanForm } from './QuickPlanForm.jsx';

export function PlanEditPanel({ messages, state, flow }) {
  const edit = state.edit ?? { plans: [], status: 'idle', available: false };
  return <section aria-label={messages.addAsset}>
    {(flow.busy || edit.status === 'loading' || edit.status === 'saving') && <p role="status">{edit.status === 'saving' ? messages.savingEdit : messages.loadingPlans}</p>}
    <SelectField id="edit-plan" label={messages.choosePlan} value={flow.planId}
      onChange={flow.setPlanId} disabled={flow.busy || edit.status === 'saving' || edit.status === 'recovery-required' || edit.actorMismatch}
      options={[{ value: '', label: messages.choosePlan }, ...edit.plans.map(({ id, name }) => ({ value: id, label: name }))]} />
    {edit.status === 'idle' && edit.plans.length === 0 && <p role="status">{messages.noEditablePlans}</p>}
    {edit.message && <p role="status">{edit.message}</p>}
    {edit.status === 'updated' && <p role="status">{messages.assetAdded}</p>}
    {edit.status === 'recovery-required' && edit.canRecover && <button type="button" disabled={flow.busy} onClick={() => void flow.recover()}>{messages.recoverEdit}</button>}
    {(edit.status === 'error' || edit.status === 'recovery-required') && <button type="button" disabled={flow.busy} onClick={() => void flow.discard()}>{messages.discardEdit}</button>}
    <QuickPlanForm messages={messages} state={state} form={flow.form} setForm={flow.setForm}
      onReview={(event) => void flow.submit(event)} onCancel={flow.close}
      error={flow.error} preparing={flow.busy || edit.status === 'saving' || edit.status === 'recovery-required' || edit.actorMismatch} editMode />
  </section>;
}
