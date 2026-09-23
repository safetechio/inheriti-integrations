import { SelectField } from '../../_shared/ui/components/Form/Fields.jsx';
import { QuickPlanForm } from '../../quick-plan/ui/QuickPlanForm.jsx';
import { PlanEditPanel } from '../../quick-plan/ui/PlanEditPanel.jsx';
import { usePlanEditFlow } from '../../quick-plan/ui/hooks/usePlanEditFlow.js';
import { ReviewPlan } from '../../quick-plan/ui/ReviewPlan.jsx';
import { ReadyPlan } from '../../quick-plan/ui/ReadyPlan.jsx';
import { useQuickPlanFlow } from '../../quick-plan/ui/hooks/useQuickPlanFlow.js';
import { useTraySession } from './hooks/useTraySession.js';

export function LauncherApp({ messages }) {
  const session = useTraySession(messages);
  const { state } = session;
  const flow = useQuickPlanFlow({ state, setState: session.setState, messages });
  const editFlow = usePlanEditFlow({ state, setState: session.setState, messages });

  if (!state) {
    return <main>
      <h1>{messages.appName}</h1>
      <p id="status" role="status">{session.error}</p>
    </main>;
  }

  const editState = state.edit ?? { plans: [], status: 'idle', available: false };
  const signedIn = state.status === 'signed-in';
  const canCreate = signedIn && !!state.selectedId && !flow.busy && !flow.preparing;
  const status = flow.error || session.error || state.message || ({
    'signed-out': messages.signedOut,
    authorizing: messages.authorizing,
    'signed-in': messages.signedIn,
    error: messages.signInError,
  })[state.status];

  return <main>
    <h1>{messages.appName}</h1>
    <p id="status" role="status">{status}</p>
    {!signedIn && <button
      id="sign-in" type="button" disabled={state.status === 'authorizing'}
      onClick={() => void session.signIn()}
    >{messages.signIn}</button>}
    <SelectField
      id="organization" label={messages.organization} value={state.selectedId || ''}
      onChange={(id) => { editFlow.close(); void flow.selectOrganization(id); }}
      options={[
        { value: '', label: messages.chooseOrganization },
        ...state.organizations.map(({ id, name }) => ({ value: id, label: name })),
      ]}
      disabled={!signedIn || !state.organizations.length || flow.busy || flow.preparing || editFlow.busy || editState.status === 'saving'}
    />
    <section aria-label={messages.actions}>
      <button id="save-plan" type="button" disabled={!canCreate || editFlow.busy} onClick={() => { editFlow.close(); flow.openCapture(); }}>{messages.savePlan}</button>
      <button id="add-asset" type="button" disabled={!signedIn || !state.selectedId || !editState.available || editFlow.busy || flow.busy || flow.preparing || flow.step !== 'actions'} onClick={() => void editFlow.open()}>{messages.addAsset}</button>
    </section>
    {editFlow.editing && flow.step === 'actions' && <PlanEditPanel messages={messages} state={state} flow={editFlow} />}
    {flow.step === 'capture' && <QuickPlanForm
      messages={messages} state={state} form={flow.form} setForm={flow.setForm}
      onReview={flow.reviewCapture} onCancel={() => void flow.cancelCapture()}
      error={flow.error} preparing={flow.preparing}
    />}
    {flow.step === 'review' && <ReviewPlan
      messages={messages} state={state} form={flow.form} busy={flow.busy} error={flow.error}
      onEdit={() => state.creation?.status === 'error' ? void flow.startOver(true) : flow.setStep('capture')}
      onStartOver={() => void flow.startOver(false)}
      onSubmit={() => void flow.submitCapture()}
    />}
    {flow.step === 'ready' && <ReadyPlan
      messages={messages} state={state}
      onNew={() => { flow.clearDraft(); flow.openCapture(); }}
    />}
    <button id="app" type="button" onClick={() => void session.openApp()}>{messages.openApp}</button>
    {(signedIn || state.status === 'authorizing') && <button
      id="sign-out" type="button" disabled={flow.busy || flow.preparing || editFlow.busy || editState.status === 'saving'}
      onClick={() => void flow.signOut()}
    >{state.status === 'authorizing' ? messages.cancelSignIn : messages.signOut}</button>}
  </main>;
}
