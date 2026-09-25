import { SignedOut } from './components/SignedOut.jsx';
import { Home } from './components/Home.jsx';
import { QuickPlanForm } from '../../quick-plan/ui/QuickPlanForm.jsx';
import { PlanEditPanel } from '../../quick-plan/ui/PlanEditPanel.jsx';
import { CustodianPrompt } from '../../quick-plan/ui/CustodianPrompt.jsx';
import { usePlanEditFlow } from '../../quick-plan/ui/hooks/usePlanEditFlow.js';
import { ReviewPlan } from '../../quick-plan/ui/ReviewPlan.jsx';
import { ReadyPlan } from '../../quick-plan/ui/ReadyPlan.jsx';
import { useQuickPlanFlow } from '../../quick-plan/ui/hooks/useQuickPlanFlow.js';
import { useTraySession } from './hooks/useTraySession.js';

export function LauncherApp({ messages }) {
  const session = useTraySession(messages);
  const { state } = session;
  const editFlow = usePlanEditFlow({ state, setState: session.setState, messages });
  const flow = useQuickPlanFlow({ state, setState: session.setState, messages,
    canHandleAction: !editFlow.editing,
    onEditAction: () => { if (state?.edit?.available && !editFlow.busy) void editFlow.open(); },
  });

  if (!state) {
    return <main className="tray-screen"><p id="status" role="status">{session.error}</p></main>;
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

  if (!signedIn) return <SignedOut messages={messages} status={status} authorizing={state.status === 'authorizing'} onSignIn={() => void session.signIn()} onCancelSignIn={() => void flow.signOut()} onOpenApp={() => void session.openApp()} />;

  if (state.custodianPrompt) return <CustodianPrompt prompt={state.custodianPrompt} onCancel={() => void window.inheritiTray.cancelPlanEdit().catch(() => {})} />;

  if (flow.step === 'actions' && !editFlow.editing) return <Home
    messages={messages} organizations={state.organizations} selectedId={state.selectedId}
    onOrganizationChange={(id) => { editFlow.close(); void flow.selectOrganization(id); }}
    canCreate={canCreate && !editFlow.busy}
    canEdit={!!state.selectedId && editState.available && !editFlow.busy && !flow.busy && !flow.preparing}
    onCreate={() => { editFlow.close(); flow.openCapture(); }} onEdit={() => void editFlow.open()}
    onOpenApp={() => void session.openApp()} onSignOut={() => void flow.signOut()}
    signOutDisabled={flow.busy || flow.preparing || editFlow.busy || editState.status === 'saving'} status={messages.signedIn}
    notice={status !== messages.signedIn ? status : ''} accountName={state.accountName}
  />;

  return <main className="tray-screen">
    <p id="status" className="sr-only" role="status">{status}</p>
    {signedIn && state.selectedId && editFlow.editing && flow.step === 'actions' && <PlanEditPanel messages={messages} state={state} flow={editFlow} onOpenApp={() => void session.openApp(state.edit?.planId)} onSignIn={() => void session.signIn()} />}
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
      onCancelRequest={() => void flow.cancelKeyRequest()}
    />}
    {flow.step === 'ready' && <ReadyPlan
      messages={messages} state={state} readySummary={flow.readySummary} onOpenApp={() => void session.openApp(state.creation?.planId)}
      onNew={() => { flow.clearDraft(); flow.openCapture(); }}
      onHome={flow.clearDraft}
    />}
  </main>;
}
