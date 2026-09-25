import { ScreenHeader } from '../../_shared/ui/components/ScreenHeader.jsx';
import { ScreenFooter } from '../../_shared/ui/components/ScreenFooter.jsx';
import { PlanSummary } from './components/PlanSummary.jsx';
import { ProtectionChecklist } from './components/ProtectionChecklist.jsx';

export function ReviewPlan({ messages, state, form, busy, error, onEdit, onStartOver, onSubmit, onCancelRequest }) {
  const organizationName = state.organizations.find(({ id }) => id === state.selectedId)?.name || '';
  const audience = form.audience === 'team'
    ? state.teams.find(({ id }) => id === form.teamId)?.name || messages.teamAudience
    : messages.privateAudience;
  const creation = state.creation;
  const keyWaiting = busy && (creation?.status === 'preparing-key' || creation?.status === 'awaiting-key');
  const problem = error || (creation?.status === 'error' ? creation.message || messages.secureError : '');
  const phaseLabel = messages.creationSteps[creation?.phase];
  const status = problem || (busy && !keyWaiting ? phaseLabel || messages.securing : '');

  return <section id="review" className="tray-screen plan-review" aria-labelledby="review-heading">
    <ScreenHeader title={messages.reviewPlan} organizationName={organizationName} onBack={onEdit} backDisabled={busy} step={2} />
    <div className="tray-scroll">
      <h2 id="review-heading" className="visually-hidden">{messages.reviewPlan}</h2>
      <PlanSummary title={form.title} assetName={form.assetName} assetType={messages.assetTypes[form.assetType] || form.assetType} audience={audience} messages={messages} />
      {(keyWaiting || creation?.status === 'error') && <div className="plan-key-banner" role={problem ? 'alert' : 'status'} aria-live={problem ? 'assertive' : 'polite'}><strong>{messages.releaseKey || 'Release the Organisation Key'}</strong><span>{keyWaiting ? messages.waitingSafeKey || 'Open SafeKey Mobile and confirm the release. Waiting for confirmation…' : problem}</span></div>}
      {status && <p id="creation-status" className={problem ? 'plan-status error' : 'plan-status'} role={problem ? 'alert' : 'status'} aria-live="polite">{status}</p>}
      <ProtectionChecklist messages={messages} creation={creation} busy={busy} />
    </div>
    <ScreenFooter><div className="buttons plan-review-actions">
      {keyWaiting ? <button className="button-secondary" id="cancel-key-request" type="button" onClick={onCancelRequest}>{messages.cancel}</button>
        : <button className="button-secondary" id="edit-capture" type="button" disabled={busy} onClick={onEdit}>{messages.edit}</button>}
      {creation?.status === 'error' && <button className="button-secondary" id="start-over" type="button" disabled={busy} onClick={onStartOver}>{messages.startOver}</button>}
      <button id="submit-capture" type="button" disabled={busy} onClick={onSubmit}>{busy ? messages.securing : creation?.status === 'error' ? messages.review : messages.savePlan}</button>
    </div></ScreenFooter>
  </section>;
}
