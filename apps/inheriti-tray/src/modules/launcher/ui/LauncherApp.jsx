import { SelectField } from '../../_shared/ui/components/Form/Fields.jsx';
import { QuickPlanForm } from '../../quick-plan/ui/QuickPlanForm.jsx';
import { ReviewPlan } from '../../quick-plan/ui/ReviewPlan.jsx';
import { ReadyPlan } from '../../quick-plan/ui/ReadyPlan.jsx';
import { useQuickPlanFlow } from '../../quick-plan/ui/hooks/useQuickPlanFlow.js';
import { useTraySession } from './hooks/useTraySession.js';

export function LauncherApp({ messages }) {
  const session = useTraySession(messages);
  const { state } = session;
  const flow = useQuickPlanFlow({ state, setState: session.setState, messages });

  if (!state) {
    return <main>
      <h1>{messages.appName}</h1>
      <p id="status" role="status">{session.error}</p>
    </main>;
  }

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
      onChange={(id) => void flow.selectOrganization(id)}
      options={[
        { value: '', label: messages.chooseOrganization },
        ...state.organizations.map(({ id, name }) => ({ value: id, label: name })),
      ]}
      disabled={!signedIn || !state.organizations.length || flow.busy || flow.preparing}
    />
    <section aria-label={messages.actions}>
      <button id="save-plan" type="button" disabled={!canCreate} onClick={() => flow.openCapture()}>{messages.savePlan}</button>
      <button type="button" disabled>{messages.editLater}</button>
    </section>
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
      id="sign-out" type="button" disabled={flow.busy || flow.preparing}
      onClick={() => void flow.signOut()}
    >{state.status === 'authorizing' ? messages.cancelSignIn : messages.signOut}</button>}
  </main>;
}
