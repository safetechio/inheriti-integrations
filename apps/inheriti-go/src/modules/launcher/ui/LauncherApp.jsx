import { useCallback, useEffect, useRef, useState } from 'react';
import { SignedOut } from './components/SignedOut.jsx';
import { sessionErrorMessage } from '../../../messages.js';
import { AccountActionDialog } from './components/AccountActionDialog.jsx';
import { accountDisplayName } from './components/account-display-name.js';
import { Home, organizationDisplayName } from './components/Home.jsx';
import { AccountAvatar } from '../../_shared/ui/components/AccountAvatar.jsx';
import { useAppVersion } from './hooks/useAppVersion.js';
import { QuickPlanForm } from '../../quick-plan/ui/QuickPlanForm.jsx';
import { PlanEditPanel } from '../../quick-plan/ui/PlanEditPanel.jsx';
import { CustodianPrompt } from '../../quick-plan/ui/CustodianPrompt.jsx';
import { usePlanEditFlow } from '../../quick-plan/ui/hooks/usePlanEditFlow.js';
import { ReviewPlan } from '../../quick-plan/ui/ReviewPlan.jsx';
import { ReadyPlan } from '../../quick-plan/ui/ReadyPlan.jsx';
import { useQuickPlanFlow } from '../../quick-plan/ui/hooks/useQuickPlanFlow.js';
import { useTraySession } from './hooks/useTraySession.js';
import { InboxPanel } from '../../inbox/ui/InboxPanel.jsx';
import { useInboxState } from '../../inbox/ui/useInboxState.js';
import { clearInboxPresence, rememberInboxPresence } from '../../inbox/ui/hooks/useInboxPanel.js';
import { clearInboxConversationCache } from '../../inbox/ui/hooks/useInboxConversations.js';

const deployment = typeof __INHERITI_DEPLOYMENT__ === 'undefined' ? 'dev' : __INHERITI_DEPLOYMENT__;

export function LauncherApp({ messages }) {
  const version = useAppVersion();
  useEffect(() => { document.title = `${messages.appName}${deployment === 'prod' ? '' : ` · ${deployment.toUpperCase()}`}${version ? ` · v${version}` : ''}`; }, [messages, version]);
  const session = useTraySession(messages);
  const [updateProgress, setUpdateProgress] = useState(null);
  useEffect(() => {
    let received = false;
    const stop = window.inheritiTray.onUpdateProgress?.((progress) => { received = true; setUpdateProgress(progress); });
    void window.inheritiTray.updateProgress?.().then((progress) => { if (!received) setUpdateProgress(progress); }).catch(() => {});
    return stop;
  }, []);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inboxRequested, setInboxRequested] = useState(null);
  const [inboxHasNew, setInboxHasNew] = useState(false);
  const [inboxTarget, setInboxTarget] = useState(null);
  const [pendingInboxAction, setPendingInboxAction] = useState(null);
  const [targetInboxAction, setTargetInboxAction] = useState(null);
  const [targetInboxStatus, setTargetInboxStatus] = useState('');
  const [targetSelectionVersion, setTargetSelectionVersion] = useState(0);
  const targetInboxRef = useRef(null);
  const [inboxSwitchBlocked, setInboxSwitchBlocked] = useState(false);
  const [pendingPlanAction, setPendingPlanAction] = useState(null);
  const [pendingAccountSwitch, setPendingAccountSwitch] = useState(null);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [pendingAccountRemoval, setPendingAccountRemoval] = useState(null);
  const [removingAccount, setRemovingAccount] = useState(false);
  const [confirmSignOutAll, setConfirmSignOutAll] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);
  const switchingOrganization = useRef(false);
  const blockedInboxSwitch = useRef(false);
  const previousAccount = useRef(null);
  const closeInbox = useCallback(() => { setInboxOpen(false); setInboxTarget(null); }, []);
  const { state } = session;
  const accountGeneration = useRef({ subject: state?.activeSubject, value: 0 });
  if (accountGeneration.current.subject !== state?.activeSubject) {
    accountGeneration.current = { subject: state?.activeSubject, value: accountGeneration.current.value + 1 };
  }
  const currentAction = (pending) => !!pending && pending.subject === state?.activeSubject && pending.generation === accountGeneration.current.value;
  const queueAction = (action) => ({ action, subject: state?.activeSubject, generation: accountGeneration.current.value });
  const inboxIdentity = useInboxState(state?.status === 'signed-in' ? state.selectedId : undefined);
  useEffect(() => { clearInboxPresence(); clearInboxConversationCache(); }, [state?.status, state?.activeSubject, state?.selectedId]);
  useEffect(() => window.inheritiTray.onAction((action) => {
    if (action === messages.openSecureInbox) setInboxRequested(queueAction(action));
    if (action === messages.savePrivately || action === messages.shareWithTeam) setPendingPlanAction(queueAction(action));
    if (action?.kind === 'OPEN_INBOX' && typeof action.organizationId === 'string' && action.organizationId.length > 0 && action.organizationId.length <= 200 &&
      (action.conversationId === undefined || (typeof action.conversationId === 'string' && action.conversationId.length > 0 && action.conversationId.length <= 200))) {
      if (action.accountSubject === undefined) setPendingInboxAction(queueAction(action));
      else if (typeof action.accountSubject === 'string' && action.accountSubject.length > 0 && action.accountSubject.length <= 500) {
        const target = { accountSubject: action.accountSubject, organizationId: action.organizationId, conversationId: action.conversationId };
        targetInboxRef.current = target;
        setTargetInboxAction(target);
        setTargetInboxStatus('');
        setPendingAccountSwitch(null);
      }
      blockedInboxSwitch.current = false;
      setInboxSwitchBlocked(false);
    }
  }), [messages, state?.assetCatalog?.length, state?.activeSubject]);
  useEffect(() => window.inheritiTray.onInboxChanged?.((signal) => {
    rememberInboxPresence(signal);
    if (signal?.kind === 'NEW_MESSAGE' && !inboxOpen) setInboxHasNew(true);
  }), [inboxOpen]);
  useEffect(() => {
    if (!inboxRequested) return;
    if (!currentAction(inboxRequested)) { setInboxRequested(null); return; }
    if (state?.status !== 'signed-in' || !state.selectedId) return;
    setInboxOpen(true);
    setInboxRequested(null);
  }, [inboxRequested, state?.status, state?.selectedId, state?.activeSubject]);
  const editFlow = usePlanEditFlow({ state, setState: session.setState, messages });
  const flow = useQuickPlanFlow({ state, setState: session.setState, messages,
    canHandleAction: !editFlow.editing && !!state?.assetCatalog?.length,
    onEditAction: () => { if (state?.edit?.available && !editFlow.busy) void editFlow.open(); },
    onReturnToInbox: () => setInboxOpen(true),
  });
  useEffect(() => {
    if (previousAccount.current && previousAccount.current !== state?.activeSubject) {
      closeInbox();
      flow.clearDraft();
      editFlow.close();
      setInboxHasNew(false);
      setInboxRequested(null);
      setPendingInboxAction(null);
      setPendingPlanAction(null);
    }
    previousAccount.current = state?.activeSubject;
  }, [state?.activeSubject]);
  const chooseAccount = (account, organization) => setPendingAccountSwitch({ account, organization });
  const confirmAccountSwitch = async () => {
    if (!pendingAccountSwitch) return;
    const { account, organization, targetAction } = pendingAccountSwitch;
    setSwitchingAccount(true);
    closeInbox();
    flow.clearDraft();
    editFlow.close();
    try {
      const activated = await session.activateAccount(account.subject, organization?.id);
      if (!activated) { if (targetAction && targetInboxRef.current === targetAction) setTargetInboxStatus('This organisation is no longer available for this account.'); return; }
      setInboxHasNew(false);
      setInboxRequested(null);
      setPendingInboxAction(null);
      setPendingPlanAction(null);
      clearInboxPresence();
      clearInboxConversationCache();
      if ((targetAction && targetInboxRef.current === targetAction) || (!targetAction && targetInboxRef.current?.accountSubject === account.subject)) {
        setTargetInboxStatus('');
      }
    } finally { setSwitchingAccount(false); setPendingAccountSwitch(null); }
  };
  useEffect(() => {
    if (!pendingPlanAction) return;
    if (!currentAction(pendingPlanAction)) { setPendingPlanAction(null); return; }
    if (state?.status !== 'signed-in' || !state.selectedId || flow.busy || flow.preparing || editFlow.busy) return;
    if (!state.assetCatalog?.length) { setPendingPlanAction(null); return; }
    if ((flow.step === 'actions' || flow.step === 'capture') && !editFlow.editing) {
      closeInbox();
      flow.openCapture(pendingPlanAction.action === messages.savePrivately ? 'private' : 'team');
    }
    setPendingPlanAction(null);
  }, [pendingPlanAction, state?.status, state?.selectedId, state?.activeSubject, flow, editFlow.busy, editFlow.editing, closeInbox, messages]);
  useEffect(() => {
    if (!pendingInboxAction) return;
    if (!currentAction(pendingInboxAction)) { setPendingInboxAction(null); return; }
    if (state?.status !== 'signed-in' || switchingOrganization.current || blockedInboxSwitch.current) return;
    const action = pendingInboxAction.action;
    const belongsToAccount = state.organizations?.some(({ id }) => id === action.organizationId);
    if (belongsToAccount && state.selectedId !== action.organizationId) {
      if (flow.busy || flow.preparing || editFlow.busy) return;
      switchingOrganization.current = true;
      void flow.selectOrganization(action.organizationId).then((selected) => {
        if (!currentAction(pendingInboxAction)) return;
        if (selected) {
          setInboxTarget(action.conversationId ? { conversationId: action.conversationId } : null);
          setInboxOpen(true);
          setInboxHasNew(false);
          setPendingInboxAction(null);
        } else { blockedInboxSwitch.current = true; setInboxSwitchBlocked(true); }
      }).finally(() => { switchingOrganization.current = false; setTargetSelectionVersion((version) => version + 1); });
      return;
    }
    if (!state.selectedId) { setPendingInboxAction(null); return; }
    setInboxTarget(belongsToAccount && action.conversationId ? { conversationId: action.conversationId } : null);
    setInboxOpen(true);
    setInboxHasNew(false);
    setPendingInboxAction(null);
  }, [pendingInboxAction, state, flow, editFlow.busy, inboxSwitchBlocked]);
  useEffect(() => {
    if (!targetInboxAction || targetInboxStatus || pendingAccountSwitch || switchingAccount || !state) return;
    const account = state.accounts?.find(({ subject }) => subject === targetInboxAction.accountSubject);
    if (state.activeSubject !== targetInboxAction.accountSubject || state.status !== 'signed-in') {
      if (account?.status !== 'ready') { setTargetInboxStatus(account ? 'Sign in again to open this Secure Chat notification.' : 'This account is no longer saved. Add the account to open this Secure Chat notification.'); return; }
      const organization = account.organizations?.find(({ id }) => id === targetInboxAction.organizationId);
      setPendingAccountSwitch({ account, organization: organization || { id: targetInboxAction.organizationId, name: 'Unavailable' }, targetAction: targetInboxAction });
      return;
    }
    if (!state.organizations?.some(({ id }) => id === targetInboxAction.organizationId)) { setTargetInboxStatus('This organisation is no longer available for this account.'); return; }
    if (state.selectedId !== targetInboxAction.organizationId) {
      if (flow.busy || flow.preparing || editFlow.busy || switchingOrganization.current) return;
      switchingOrganization.current = true;
      void flow.selectOrganization(targetInboxAction.organizationId).then((selected) => {
        if (!selected && targetInboxRef.current === targetInboxAction) setTargetInboxStatus('This organisation is no longer available for this account.');
      }).finally(() => { switchingOrganization.current = false; setTargetSelectionVersion((version) => version + 1); });
      return;
    }
    if (targetInboxRef.current !== targetInboxAction) return;
    targetInboxRef.current = null;
    setInboxTarget(targetInboxAction.conversationId ? { conversationId: targetInboxAction.conversationId } : null);
    setInboxOpen(true);
    setInboxHasNew(false);
    setTargetInboxAction(null);
  }, [targetInboxAction, targetInboxStatus, pendingAccountSwitch, switchingAccount, state, flow, editFlow.busy, targetSelectionVersion]);
  const recoverTargetInbox = async () => {
    const target = targetInboxRef.current;
    const next = await session.addAccount();
    if (!target || targetInboxRef.current !== target || !next) return;
    if (next.activeSubject !== target.accountSubject) { setTargetInboxStatus('A different account was added. Add the requested account to open this notification.'); return; }
    setTargetInboxStatus('');
  };
  const signOutAll = async () => {
    setSigningOutAll(true);
    try {
      if (!(await session.signOutAll())) return;
      closeInbox();
      flow.clearDraft();
      editFlow.close();
      setInboxHasNew(false);
      setInboxRequested(null);
      setPendingInboxAction(null);
      targetInboxRef.current = null;
      setTargetInboxAction(null);
      setTargetInboxStatus('');
      setPendingPlanAction(null);
      setPendingAccountSwitch(null);
      clearInboxPresence();
      clearInboxConversationCache();
      setConfirmSignOutAll(false);
    } finally { setSigningOutAll(false); }
  };
  const removeAccount = async () => {
    if (!pendingAccountRemoval) return;
    setRemovingAccount(true);
    try {
      if (!await session.removeAccount(pendingAccountRemoval.subject)) return;
      if (pendingAccountRemoval.subject === state.activeSubject) {
        closeInbox();
        flow.clearDraft();
        editFlow.close();
        setInboxHasNew(false);
        setInboxRequested(null);
        setPendingInboxAction(null);
        setPendingPlanAction(null);
        targetInboxRef.current = null;
        setTargetInboxAction(null);
        setTargetInboxStatus('');
        clearInboxPresence();
        clearInboxConversationCache();
      }
      setPendingAccountRemoval(null);
    } finally { setRemovingAccount(false); }
  };
  const pendingInboxControls = <>
    {currentAction(pendingInboxAction) && inboxSwitchBlocked && <p role="status">Secure Chat notification pending. <button type="button" onClick={() => { blockedInboxSwitch.current = false; setInboxSwitchBlocked(false); }}>Retry</button> <button type="button" onClick={() => setPendingInboxAction(null)}>Dismiss</button></p>}
    {targetInboxAction && targetInboxStatus && <p role="status">{targetInboxStatus} <button type="button" onClick={() => void recoverTargetInbox()}>Add account</button> <button type="button" onClick={() => { targetInboxRef.current = null; setTargetInboxAction(null); setTargetInboxStatus(''); }}>Dismiss</button></p>}
  </>;
  const createPlanFromSecret = (suggestion) => {
    if (!flow.openInboxSuggestion(suggestion)) return;
    setInboxOpen(false);
    setInboxHasNew(false);
  };
  const createPlanFromFile = (file) => {
    if (!flow.openInboxFile(file)) return false;
    setInboxOpen(false);
    setInboxHasNew(false);
    return true;
  };

  if (updateProgress) return <main className="tray-screen tray-update" aria-label="Inheriti Go update">
    <img src="tray.png" alt="" className="tray-sign-in-logo" />
    <h1>Updating Inheriti Go</h1>
    <p role="status">{updateProgress.phase === 'downloading' ? `Downloading version ${updateProgress.version}…` :
      updateProgress.phase === 'installing' ? 'Installing the update…' : 'Restarting Inheriti Go…'}</p>
    {updateProgress.phase === 'downloading' && <div className="tray-update-progress">
      <progress max="100" value={updateProgress.percent ?? 0} aria-label="Download progress" />
      <strong>{updateProgress.percent ?? 0}%</strong>
    </div>}
  </main>;

  const screen = !state ? <main className="tray-screen"><p id="status" role="status">{session.error}</p></main> : null;
  if (screen) return screen;

  const editState = state.edit ?? { plans: [], status: 'idle', available: false };
  const pendingAccountName = pendingAccountSwitch && accountDisplayName(pendingAccountSwitch.account,
    Math.max(0, state.accounts?.findIndex(({ subject }) => subject === pendingAccountSwitch.account.subject) ?? 0));
  const withAccountDialog = (content) => <>{content}{pendingAccountRemoval
    ? <AccountActionDialog title="Unlink account?" confirmLabel="Unlink account" danger busy={removingAccount} progressLabel="Unlinking account…"
      onCancel={() => setPendingAccountRemoval(null)} onConfirm={() => void removeAccount()}>
      <section className="tray-account-confirmation-card"><div className="tray-account-confirmation-person"><AccountAvatar name={accountDisplayName(pendingAccountRemoval)} />
        <div><span>Account: </span><strong>{accountDisplayName(pendingAccountRemoval)}</strong></div></div></section>
      <p>This removes this saved login and its organisation keys from this device.{pendingAccountRemoval.subject === state.activeSubject && state.accounts.length > 1 ? ' Choose another saved account or add one after unlinking.' : ''}</p>
      {session.error && <p role="alert" className="error">{session.error}</p>}
    </AccountActionDialog>
    : confirmSignOutAll
    ? <AccountActionDialog title="Sign out all accounts?" confirmLabel="Sign out all" danger busy={signingOutAll} progressLabel="Signing out…"
      onCancel={() => setConfirmSignOutAll(false)} onConfirm={() => void signOutAll()}>
      <p>This removes every saved account and its organisation keys from this device. You will need to sign in again to use them.</p>
      {session.error && <p role="alert" className="error">{session.error}</p>}
    </AccountActionDialog>
    : pendingAccountSwitch && <AccountActionDialog title="Switch account" confirmLabel="Switch account" busy={switchingAccount}
      onCancel={() => { if (pendingAccountSwitch.targetAction) setTargetInboxStatus('Secure Chat notification pending for this account.'); setPendingAccountSwitch(null); }}
      onConfirm={() => void confirmAccountSwitch()}>
      <section className="tray-account-confirmation-card">
        <div className="tray-account-confirmation-person"><AccountAvatar name={pendingAccountName} />
          <div><span>Account: </span><strong>{pendingAccountName}</strong></div>
        </div>
        <div className="tray-account-confirmation-organization"><span>Organisation: </span><strong>{pendingAccountSwitch.organization
          ? organizationDisplayName(pendingAccountSwitch.organization, pendingAccountSwitch.account.organizations)
          : 'Choose after switching'}</strong></div>
      </section>
      <p className="tray-account-confirmation-note">Your current account will stay saved. Active work must finish before switching.</p>
      {session.error && <p role="alert" className="error">{session.error}</p>}
    </AccountActionDialog>}</>;
  if (switchingAccount || state.status === 'restoring') return withAccountDialog(<main className="tray-screen tray-restoring"><div className="tray-restoring-content" role="status"><img src="tray.png" alt="" className="tray-sign-in-logo" /><span>Checking session…</span><span className="tray-restoring-track" aria-hidden="true"><span /></span></div></main>);
  const signedIn = state.status === 'signed-in';
  const canCreate = signedIn && !!state.selectedId && !flow.busy && !flow.preparing;
  const status = flow.error || session.error || state.message || (state.status === 'signed-out' && !state.activeSubject && state.accounts.length
    ? 'Choose another saved account or add one to continue.' : '') || ({
    'signed-out': messages.signedOut,
    'session-unavailable': messages.sessionUnavailable,
    authorizing: messages.authorizing,
    'signed-in': messages.signedIn,
    error: messages.signInError,
  })[state.status];

  if (!signedIn) return withAccountDialog(<>{pendingInboxControls}<SignedOut messages={messages} status={sessionErrorMessage(new Error(status), status)} authorizing={state.status === 'authorizing'} sessionUnavailable={state.status === 'session-unavailable'}
    accounts={state.accounts} activeSubject={state.activeSubject} onChooseAccount={chooseAccount} onRemoveAccount={setPendingAccountRemoval}
    onRestore={() => void session.restore()} onSignIn={() => void session.signIn()} onCancelSignIn={() => void session.cancelAccountAuthorization()}
    onSignOutAll={() => setConfirmSignOutAll(true)} onOpenApp={() => void session.openApp()} /></>);

  if (state.custodianPrompt) return withAccountDialog(<CustodianPrompt prompt={state.custodianPrompt} onCancel={() => void window.inheritiTray.cancelPlanEdit().catch(() => {})} />);

  if (inboxOpen) return withAccountDialog(<InboxPanel key={`${state.activeSubject || 'no-account'}:${state.selectedId || 'no-organization'}`} onClose={closeInbox}
    identity={inboxIdentity} organizationId={state.selectedId} targetConversation={inboxTarget}
    onCreatePlanFromSecret={undefined} onCreatePlanFromFile={undefined} />);

  if (flow.step === 'actions' && !editFlow.editing) return withAccountDialog(<Home
    messages={messages} organizations={state.organizations} selectedId={state.selectedId}
    accounts={state.accounts} activeSubject={state.activeSubject} onChooseAccount={chooseAccount} onRemoveAccount={setPendingAccountRemoval} onAddAccount={() => void session.addAccount()}
    pendingInboxControls={pendingInboxControls}
    showPlanActions={state.assetCatalog?.length > 0}
    onOrganizationChange={(id) => { closeInbox(); setInboxHasNew(false); editFlow.close(); void flow.selectOrganization(id); }}
    canCreate={canCreate && state.assetCatalog?.length > 0 && !editFlow.busy}
    canEdit={!!state.selectedId && state.assetCatalog?.length > 0 && editState.available && !editFlow.busy && !flow.busy && !flow.preparing}
    onCreate={() => { editFlow.close(); flow.openCapture(); }} onEdit={() => void editFlow.open()}
    onOpenInbox={() => { setInboxHasNew(false); setInboxOpen(true); }} inboxHasNew={inboxHasNew}
    onOpenApp={() => void session.openApp()}
    onSignOut={() => { closeInbox(); setInboxHasNew(false); setPendingInboxAction(null); void flow.signOut(); }}
    onSignOutAll={() => setConfirmSignOutAll(true)}
    signOutDisabled={flow.busy || flow.preparing || editFlow.busy || editState.status === 'saving'} status={messages.signedIn}
    notice={status !== messages.signedIn ? status : ''} accountName={state.accountName} accountRole={state.accountRole}
  />);

  return withAccountDialog(<main className="tray-screen">
    {pendingInboxControls}
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
      messages={messages} state={state} readySummary={flow.readySummary} returnToInbox={flow.fromInbox}
      onOpenApp={() => void session.openApp(state.creation?.planId)}
      onNew={() => { flow.clearDraft(); flow.openCapture(); }}
      onHome={() => flow.clearDraft(true)}
    />}
  </main>);
}
