import { BUSINESS_DEPLOYMENTS, PROTECTED_FILE_FLAGS, HOST_FEATURE_FLAGS, createOrganizationKeys, latestIntegrationBuild, quickPlanAssetCatalog } from '@safetech/inheriti-elements-core/node';
import type { InternalBuild, NodeIntegrationCore, QuickPlanInput } from '@safetech/inheriti-elements-core/node';
import { TrayQuickPlans } from '../../quick-plan/main/quick-plans.js';
import { TrayPlanEdit } from '../../quick-plan/main/plan-edit.js';
import { CustodianPrompt } from '../../quick-plan/main/custodian-prompt.js';
import type { CustodianPromptState } from '../../quick-plan/main/custodian-prompt.js';
import { createTraySafeKeyPro } from '../../quick-plan/main/safekey-pro.js';
import { TrayInbox } from '../../inbox/main/inbox.js';
import type { TrayInboxSignal } from '../../inbox/main/inbox.js';
import type { InboxIdentityState } from '../../inbox/main/identity.js';
import type { PlanEditState } from '../../quick-plan/main/plan-edit.js';
import type { CreationState } from '../../quick-plan/main/quick-plans.js';
import type { OperatorSession } from '@safetech/inheriti-elements-core/node';
import { sessionErrorMessage, trayMessages as messages } from '../../../messages.js';
import { OrganizationKeyVault } from './organization-key-vault.js';
import { TrayAccountSwitcher } from './tray-account-switcher.js';
import { TrayAuthRuntime } from './tray-auth-runtime.js';
import type { SavedAccountSummary } from './operator-session-store.js';
import { TrayOrganizationContext } from './tray-organization-context.js';
import { TrayInboxAccess } from './tray-inbox-access.js';

export type Deployment = keyof typeof BUSINESS_DEPLOYMENTS;
export type TrayState = {
  status: 'restoring' | 'session-unavailable' | 'signed-out' | 'authorizing' | 'signed-in' | 'error';
  message?: string;
  organizations: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  assetCatalog: typeof quickPlanAssetCatalog;
  selectedId?: string;
  accountName?: string;
  accountRole?: string;
  accounts: Array<SavedAccountSummary & { organizations: { id: string; name: string }[] }>;
  activeSubject?: string;
  creation?: CreationState;
  edit: PlanEditState;
  custodianPrompt?: CustodianPromptState;
};

export class TraySession {
  private get planCreationEnabled(): boolean { return this.deployment === 'local' || HOST_FEATURE_FLAGS[this.deployment].planCreation; }
  private readonly auth: TrayAuthRuntime;
  private readonly organization: TrayOrganizationContext;
  private readonly inboxAccess: TrayInboxAccess;
  private readonly accountSwitcher: TrayAccountSwitcher;
  private accountName: string | undefined;
  private status: TrayState['status'] = 'restoring';
  private message: string | undefined;
  private authorization: AbortController | undefined;
  private authorizationCommitting = false;
  private pendingSignIn: Promise<void> | undefined;
  private restoreInFlight = false;
  private signingOut = false;
  private authenticationRevision = 0;
  private readonly quickPlans: TrayQuickPlans;
  private readonly planEdit: TrayPlanEdit;
  private readonly organizationKeys: ReturnType<typeof createOrganizationKeys>;
  private readonly organizationKeyVault: OrganizationKeyVault;
  private readonly custodianPrompt = new CustodianPrompt();
  private readonly proDevice: ReturnType<typeof createTraySafeKeyPro>;
  private readonly inbox: TrayInbox;
  private inboxPublisher: ((signal?: TrayInboxSignal) => void) | undefined;
  private inboxStatePublisher: (() => void) | undefined;

  constructor(private readonly deployment: Deployment, localOverrides?: { apiUrl: string | undefined; issuer: string | undefined }) {
    const config = BUSINESS_DEPLOYMENTS[deployment];
    const apiUrl = deployment === 'local' ? localOverrides?.apiUrl || config.apiUrl : config.apiUrl;
    const issuer = deployment === 'local' ? localOverrides?.issuer || config.issuer : config.issuer;
    this.auth = new TrayAuthRuntime(deployment, apiUrl, issuer, config.environment);
    this.organizationKeyVault = new OrganizationKeyVault(deployment, async () => (await this.auth.sessions.load())?.principal, issuer);
    this.organizationKeys = createOrganizationKeys({ apiUrl, environment: config.environment, getBearerToken: () => this.auth.getAccessToken(),
      keyVault: this.organizationKeyVault });
    this.inbox = new TrayInbox(apiUrl, config.environment, () => this.auth.getAccessToken(),
      async () => (await this.auth.sessions.load())?.principal,
      (id, signal, onRelaySession) => this.organizationKeys.resolve(id, signal, onRelaySession), () => {
        if (this.organization.pendingSelections || this.status !== 'signed-in' || !this.organization.selectedId) throw new Error('organization_required');
        return this.organization.selectedId;
      }, (signal) => this.inboxPublisher?.(signal), () => this.inboxStatePublisher?.());
    this.proDevice = createTraySafeKeyPro(deployment, this.custodianPrompt);
    this.quickPlans = new TrayQuickPlans(apiUrl, config.environment, () => this.auth.getAccessToken(), (id, signal, onRelaySession) => this.organizationKeys.resolve(id, signal, onRelaySession));
    this.planEdit = new TrayPlanEdit(apiUrl, config.environment, () => this.auth.getAccessToken(),
      async () => (await this.auth.sessions.load())?.principal, (id, signal, onRelaySession) => this.organizationKeys.resolve(id, signal, onRelaySession), {
      selectCustodianDevice: () => this.custodianPrompt.choose(!!this.proDevice),
      proDevice: this.proDevice,
    });
    this.inboxAccess = new TrayInboxAccess(() => ({ selectedId: this.organization.selectedId,
      selecting: !!this.organization.pendingSelections, signedIn: this.status === 'signed-in' }),
    (id, signal) => this.organizationKeys.resolve(id, signal));
    this.organization = new TrayOrganizationContext(this.auth, this.quickPlans, this.planEdit, this.inbox,
      () => this.organizationKeys.clear(), () => this.inboxAccess.reset(),
      () => this.status === 'signed-in', () => this.signingOut);
    this.accountSwitcher = new TrayAccountSwitcher(this.auth, this.organization, this.inboxAccess, this.inbox,
      this.quickPlans, this.planEdit, this.organizationKeys, this.custodianPrompt, this.proDevice, () => this.signingOut);
  }

  setPublisher(publish: () => void): void { this.custodianPrompt.setPublisher(publish); }
  setInboxPublisher(publish: (signal?: TrayInboxSignal) => void): void { this.inboxPublisher = publish; }
  setInboxStatePublisher(publish: () => void): void { this.inboxStatePublisher = publish; }
  inboxSessionRevision(): number { return this.authenticationRevision; }
  async availableUpdate(version: string): Promise<InternalBuild | undefined> {
    if (this.status !== 'signed-in') throw new Error('sign_in_required');
    const platform = `${process.platform}-${process.arch}${process.platform === 'darwin' ? '-update' : ''}`;
    return latestIntegrationBuild(await this.auth.core.listInternalBuilds(), 'tray', version, platform);
  }
  requestUpdateDownload(id: string): ReturnType<NodeIntegrationCore['requestInternalBuildDownload']> {
    if (this.status !== 'signed-in') throw new Error('sign_in_required');
    return this.auth.core.requestInternalBuildDownload(id);
  }
  selectCustodianDevice(value: unknown): void { this.custodianPrompt.select(value); }
  submitSafeKeyProPin(value: unknown): void { this.custodianPrompt.submitPin(value); }

  state(): TrayState {
    const quickPlans = this.quickPlans.state();
    const message = quickPlans.message ?? this.message;
    const custodianPrompt = this.custodianPrompt.state();
    const accounts = this.accountSwitcher.snapshot;
    return {
      status: this.status,
      ...(message ? { message } : {}),
      organizations: this.organization.organizations.map(({ id, name }) => ({ id, name })),
      teams: this.organization.pendingSelections ? [] : quickPlans.teams,
      assetCatalog: this.planCreationEnabled ? quickPlanAssetCatalog : [],
      ...(this.organization.selectedId && !this.organization.pendingSelections ? { selectedId: this.organization.selectedId } : {}),
      ...(this.status === 'signed-in' && this.accountName ? { accountName: this.accountName } : {}),
      ...(this.status === 'signed-in' && this.organization.selectedRole ? { accountRole: this.organization.selectedRole } : {}),
      accounts: accounts.accounts,
      ...(accounts.activeSubject ? { activeSubject: accounts.activeSubject } : {}),
      ...(quickPlans.creation ? { creation: quickPlans.creation } : {}),
      edit: this.planEdit.state(),
      ...(custodianPrompt ? { custodianPrompt } : {}),
    };
  }

  signIn(onChange: () => void, openBrowser: (url: string) => Promise<void>): Promise<void> {
    if (this.signingOut || this.accountSwitcher.isSwitching) return Promise.reject(new Error('account_transition_in_progress'));
    if (this.status === 'restoring') return Promise.resolve();
    if (this.pendingSignIn) return this.pendingSignIn;
    const pending = this.status === 'session-unavailable' && !this.auth.sessions.isRetired
      ? this.runAddAccount(onChange, openBrowser)
      : this.runSignIn(onChange, openBrowser);
    this.pendingSignIn = pending.finally(() => {
      this.pendingSignIn = undefined;
    });
    return this.pendingSignIn;
  }

  addAccount(onChange: () => void, openBrowser: (url: string) => Promise<void>): Promise<void> {
    if (this.restoreInFlight) return Promise.reject(new Error('restore_in_progress'));
    if (this.signingOut || this.accountSwitcher.isSwitching) return Promise.reject(new Error('account_transition_in_progress'));
    if (this.pendingSignIn) return this.pendingSignIn;
    const pending = this.runAddAccount(onChange, openBrowser);
    this.pendingSignIn = pending.finally(() => { this.pendingSignIn = undefined; });
    return this.pendingSignIn;
  }

  async cancelAccountAuthorization(): Promise<void> {
    if (this.accountSwitcher.isSwitching) throw new Error('account_transition_in_progress');
    if (this.authorizationCommitting) throw new Error('authorization_committing');
    this.authorization?.abort();
    await this.pendingSignIn;
  }

  private async runAddAccount(onChange: () => void, openBrowser: (url: string) => Promise<void>): Promise<void> {
    this.accountSwitcher.assertCanSwitch();
    const previousStatus = this.status;
    const authorization = new AbortController();
    this.authorization = authorization;
    this.status = 'authorizing';
    this.message = undefined;
    onChange();
    let transitioning = false;
    try {
      const { session, organizations } = await this.auth.authorizeAdditional(openBrowser, authorization.signal);
      authorization.signal.throwIfAborted();
      this.accountSwitcher.rememberOrganizations(session.principal.subject, organizations);
      await this.transitionAccount(session.principal.subject, session, () => { transitioning = true; });
    } catch (error) {
      if (!transitioning) {
        this.status = previousStatus;
        if (!authorization.signal.aborted) this.message = sessionErrorMessage(error, messages.signInFailed);
      }
    } finally {
      if (this.authorization === authorization) this.authorization = undefined;
      onChange();
    }
  }

  async activateAccount(subject: string): Promise<void> {
    if (this.restoreInFlight) throw new Error('restore_in_progress');
    if (this.pendingSignIn) throw new Error('authorization_in_progress');
    await this.transitionAccount(subject);
  }

  private async transitionAccount(subject: string, session?: OperatorSession, onStart?: () => void): Promise<void> {
    let started = false;
    try {
      await this.accountSwitcher.transition(subject, session,
        () => { started = true; onStart?.(); ++this.authenticationRevision; this.status = 'restoring'; this.message = undefined; this.accountName = undefined; },
        (name, message) => { this.accountName = name; this.status = 'signed-in'; this.message = message; });
    } catch (error) {
      if (!started) throw error;
      this.organization.reset();
      this.accountName = undefined;
      this.status = 'session-unavailable';
      this.message = sessionErrorMessage(error, messages.signInFailed);
      await this.refreshAccountSummaries();
      throw error;
    }
  }

  private async runSignIn(onChange: () => void, openBrowser: (url: string) => Promise<void>): Promise<void> {
    const previousStatus = this.status;
    ++this.authenticationRevision;
    const authorization = new AbortController();
    this.authorization = authorization;
    this.auth.renewIfRetired();
    this.status = 'authorizing';
    this.message = undefined;
    onChange();
    let committed = false;
    try {
      const session = await this.auth.authorizeFresh(openBrowser, authorization.signal);
      authorization.signal.throwIfAborted();
      this.authorizationCommitting = true;
      this.status = 'restoring';
      onChange();
      await this.auth.sessions.save(session);
      committed = true;
      this.accountName = session.principal.subject;
      await this.discover(authorization.signal);
      await this.refreshAccountSummaries();
    } catch (error) {
      if (authorization.signal.aborted) return;
      if ((error as { status?: unknown; code?: unknown })?.status === 403
        && (error as { code?: unknown }).code === 'integration_tester_required') {
        if (committed) {
          try { await this.auth.core.auth.clear(); } catch { /* Clear the saved session even if SDK cleanup fails. */ }
          await this.auth.sessions.clear();
          this.inbox.clear();
          this.organization.reset();
          this.accountName = undefined;
          this.status = 'error';
        } else {
          if (previousStatus !== 'signed-in') this.accountName = undefined;
          this.status = previousStatus === 'signed-in' ? previousStatus : 'error';
        }
        this.message = 'You are not an integration tester. Contact developer support.';
        return;
      }
      this.status = 'error';
      this.message = sessionErrorMessage(error, messages.signInFailed);
    } finally {
      if (authorization.signal.aborted && !this.signingOut) {
        this.status = previousStatus;
        this.message = undefined;
      }
      if (this.authorization === authorization) this.authorization = undefined;
      this.authorizationCommitting = false;
      await this.refreshAccountSummaries();
      onChange();
    }
  }

  async restore(): Promise<void> {
    if (this.restoreInFlight) return;
    this.restoreInFlight = true;
    try {
    const revision = ++this.authenticationRevision;
    const core = this.auth.core;
    this.organization.invalidate();
    this.status = 'restoring';
    let hasSavedSession = false;
    this.inboxAccess.reset();
    this.custodianPrompt.cancel();
    this.proDevice?.clearPin();
    try {
      if (await core.auth.getAccessToken()) {
        if (revision !== this.authenticationRevision || core !== this.auth.core) return;
        const saved = await this.auth.sessions.load();
        if (revision !== this.authenticationRevision || core !== this.auth.core) return;
        this.accountName = saved?.principal.subject;
        await this.discover();
        if (revision !== this.authenticationRevision || core !== this.auth.core) return;
        await this.refreshAccountSummaries();
        return;
      }
    } catch {
      if (revision !== this.authenticationRevision || core !== this.auth.core) return;
      try { hasSavedSession = !!await this.auth.sessions.load(); } catch { /* A damaged checkpoint cannot be retried. */ }
    }
    if (revision !== this.authenticationRevision || core !== this.auth.core) return;
    this.inbox.clear();
    await this.organizationKeys.clear();
    this.quickPlans.clear();
    this.planEdit.reset();
    this.organization.reset();
    this.accountName = undefined;
    this.status = hasSavedSession ? 'session-unavailable' : 'signed-out';
    this.message = undefined;
    await this.refreshAccountSummaries();
    } finally {
      this.restoreInFlight = false;
    }
  }

  select(id: string): Promise<void> {
    if (this.signingOut) return Promise.reject(new Error('sign_out_in_progress'));
    if (this.accountSwitcher.isSwitching || this.status !== 'signed-in') return Promise.reject(new Error('account_transition_in_progress'));
    return this.organization.select(id);
  }

  createQuickPlan(input: { title: string; asset: QuickPlanInput['asset']; teamId?: string }, onChange: () => void): Promise<void> {
    if (this.signingOut) throw new Error('sign_out_in_progress');
    if (!this.planCreationEnabled) throw new Error('plan_creation_unavailable');
    if (this.organization.pendingSelections) throw new Error('organization_selection_in_progress');
    if (this.status !== 'signed-in' || !this.organization.selectedId) throw new Error('organization_required');
    return this.quickPlans.create(input, onChange);
  }

  abandonCreation(): void {
    this.quickPlans.abandon();
  }

  cancelKeyRequest(): void {
    this.quickPlans.cancelKeyRequest();
  }

  loadEditablePlans(onChange: () => void): Promise<void> {
    if (!this.planCreationEnabled) throw new Error('plan_creation_unavailable');
    if (this.organization.pendingSelections || this.status !== 'signed-in' || !this.organization.selectedId) throw new Error('organization_required');
    return this.planEdit.load(onChange);
  }

  addPlanAsset(planId: string, asset: QuickPlanInput['asset'], onChange: () => void): Promise<void> {
    if (!this.planCreationEnabled) throw new Error('plan_creation_unavailable');
    if (this.organization.pendingSelections || this.status !== 'signed-in' || !this.organization.selectedId) throw new Error('organization_required');
    return this.planEdit.add(planId, asset, onChange);
  }

  listPlanAssets(planId: string, onChange: () => void): Promise<void> {
    if (!this.planCreationEnabled) throw new Error('plan_creation_unavailable');
    if (this.organization.pendingSelections || this.status !== 'signed-in' || !this.organization.selectedId) throw new Error('organization_required');
    return this.planEdit.listAssets(planId, onChange);
  }

  getPlanAsset(planId: string, assetId: string) {
    if (!this.planCreationEnabled) throw new Error('plan_creation_unavailable');
    if (this.organization.pendingSelections || this.status !== 'signed-in' || !this.organization.selectedId) throw new Error('organization_required');
    return this.planEdit.getAsset(planId, assetId);
  }

  replacePlanAsset(planId: string, assetId: string, asset: QuickPlanInput['asset'], onChange: () => void): Promise<void> {
    if (!this.planCreationEnabled) throw new Error('plan_creation_unavailable');
    if (this.organization.pendingSelections || this.status !== 'signed-in' || !this.organization.selectedId) throw new Error('organization_required');
    return this.planEdit.replace(planId, assetId, asset, onChange);
  }

  async discardPlanEdit(): Promise<void> { this.custodianPrompt.cancel(); this.proDevice?.clearPin(); await this.planEdit.discard(); }
  async cancelPlanEdit(): Promise<void> { this.custodianPrompt.cancel(); this.proDevice?.clearPin(); await this.planEdit.cancelAccess(); }
  recoverPlanEdit(onChange: () => void): Promise<void> {
    if (this.status !== 'signed-in') throw new Error('organization_required');
    return this.planEdit.recover(onChange);
  }
  protectedFilesEnabled(): boolean { return PROTECTED_FILE_FLAGS[this.deployment]; }
  inboxState(): InboxIdentityState & { protectedFileEnabled: boolean } {
    return { ...this.inbox.state(), protectedFileEnabled: this.protectedFilesEnabled() };
  }
  registeredInboxMemberId(): Promise<string | undefined> { return this.inbox.registeredMemberId(); }
  async prepareInbox(): Promise<InboxIdentityState & { protectedFileEnabled: boolean }> {
    await this.inbox.prepare();
    return this.inboxState();
  }
  prepareInboxAccess(requestId: number): Promise<void> { return this.inboxAccess.prepare(requestId); }
  cancelInboxAccess(requestId?: number): void { this.inboxAccess.cancel(requestId); }
  async replaceInboxDevice(): Promise<InboxIdentityState & { protectedFileEnabled: boolean }> {
    await this.inbox.replace();
    return this.inboxState();
  }
  cancelInboxPreparation(): void { this.inbox.cancelPreparation(); }
  listInboxParticipants(input?: { q?: string; limit?: number; offset?: number }) { return this.inbox.listParticipants(input); }
  listInboxMembers(input?: { q?: string; limit?: number; offset?: number }) { return this.inbox.listMembers(input); }
  createInboxConversation(title: string, participantMemberIds: string[]) { return this.inbox.createConversation(title, participantMemberIds); }
  changeInboxParticipants(conversationId: string, input: { action: 'ADD' | 'REMOVE'; memberId: string; expectedRevision: number }) { return this.inbox.changeParticipants(conversationId, input); }
  listInboxConversations(input?: { status?: 'ACTIVE' | 'CLOSED'; limit?: number; offset?: number }) { return this.inbox.listConversations(input); }
  listOrganizationInboxConversations(organizationId: string, input?: { status?: 'ACTIVE' | 'CLOSED'; limit?: number; offset?: number }) {
    if (this.status !== 'signed-in' || this.signingOut || !this.organization.organizations.some(({ id }) => id === organizationId))
      throw new Error('organization_access_denied');
    return this.inbox.listOrganizationConversations(organizationId, input);
  }
  clearInboxHistory(conversationId: string) { return this.inbox.clearHistory(conversationId); }
  listInboxParents(conversationId: string) { return this.inbox.listParents(conversationId); }
  listInboxParentMetadata(conversationId: string) { return this.inbox.listParentMetadata(conversationId); }
  sendInboxParent(conversationId: string, parentId: string, segments: Array<{ text: string } | { protectedText: string; expiresAt: string }>, progress?: (completed: number, total: number) => void) { return this.inbox.sendParent(conversationId, parentId, segments, progress); }
  revealInboxUnit(conversationId: string, parentId: string, unitId: string) { return this.inbox.revealUnit(conversationId, parentId, unitId); }
  listInboxMessages(conversationId: string, input?: { status?: 'PREPARING' | 'AVAILABLE' | 'FAILED'; limit?: number; offset?: number }) { return this.inbox.listMessages(conversationId, input); }
  prepareNormalInbox(conversationId: string) { return this.inbox.prepareNormal(conversationId); }
  listNormalInboxMetadata(conversationId: string) { return this.inbox.listNormalMetadata(conversationId); }
  listNormalInboxMessages(conversationId: string) { return this.inbox.listNormal(conversationId); }
  sendNormalInboxText(conversationId: string, parentId: string, text: string) { return this.inbox.sendNormal(conversationId, parentId, text); }
  sendInboxText(conversationId: string, text: string, expiresAt: string) { return this.inbox.sendText(conversationId, text, expiresAt); }
  sendInboxFile(conversationId: string, expiresAt: string, progress?: (completed: number, total: number, stage?: string) => void) { return this.inbox.sendFile(conversationId, expiresAt, progress); }
  openInboxText(conversationId: string, messageId: string) { return this.inbox.openText(conversationId, messageId); }
  openInboxFile(conversationId: string, messageId: string, progress?: (completed: number, total: number, stage?: string) => void) {
    if (this.protectedFilesEnabled()) throw new Error('protected_file_required');
    return this.inbox.openFile(conversationId, messageId, progress);
  }
  listInboxProtectedFilePlans() {
    if (!this.protectedFilesEnabled()) throw new Error('protected_file_unavailable');
    return this.inbox.listProtectedFilePlans();
  }
  openInboxProtectedFile(input: { conversationId: string; messageId: string; planId: string;
    copyId: string; envelopeId: string; openLimit: number | null },
    progress?: (completed: number, total: number, stage?: string) => void) {
    if (!this.protectedFilesEnabled()) throw new Error('protected_file_unavailable');
    return this.inbox.openProtectedFile(input, progress);
  }
  openInboxFileForPlan(conversationId: string, messageId: string, deliver: (file: { name: string; mimeType: string; bytes: Uint8Array }) => void, progress?: (completed: number, total: number, stage?: string) => void) { return this.inbox.openFileForPlan(conversationId, messageId, deliver, progress); }
  acceptInboxFileForPlan(conversationId: string, messageId: string): void { this.inbox.acceptFileForPlan(conversationId, messageId); }
  cancelInboxTransfer(): void { this.inbox.cancelTransfer(); }
  retryInboxAck(conversationId: string, messageId: string) { return this.inbox.retryAck(conversationId, messageId); }
  hideInboxText(): void { this.inbox.hide(); }
  clearRevealed(): void { this.custodianPrompt.cancel(); this.proDevice?.clearPin(); this.planEdit.clearRevealed(); this.inbox.hide(); }
  clearOnLock(): void { this.clearRevealed(); this.quickPlans.clearResolved(); this.inbox.clear(); this.inboxAccess.reset(); void this.organizationKeys.clear(); }

  signOut(): Promise<void> { return this.clearSession(false); }
  signOutAll(): Promise<void> { return this.clearSession(true); }

  async removeAccount(subject: string): Promise<void> {
    if (this.restoreInFlight || this.pendingSignIn || this.signingOut || this.accountSwitcher.isSwitching) throw new Error('account_transition_in_progress');
    if (!this.accountSwitcher.snapshot.accounts.some((account) => account.subject === subject)) throw new Error('operator_account_not_found');
    if (this.accountSwitcher.snapshot.activeSubject === subject) return this.clearSession(false);
    this.signingOut = true;
    try {
      this.organizationKeyVault.forgetSubject(subject);
      await this.auth.remove(subject);
      await this.refreshAccountSummaries();
    } finally { this.signingOut = false; }
  }

  private async clearSession(allAccounts: boolean): Promise<void> {
    if (this.signingOut || this.accountSwitcher.isSwitching) throw new Error('account_transition_in_progress');
    if (this.organization.pendingSelections) throw new Error('organization_selection_in_progress');
    this.quickPlans.assertIdle();
    this.planEdit.assertIdle();
    this.inbox.beginAccountTransition();
    this.signingOut = true;
    ++this.authenticationRevision;
    const previousStatus = this.status;
    this.status = 'restoring';
    try {
      this.organization.invalidate();
      this.inboxAccess.reset();
      this.custodianPrompt.cancel();
      this.proDevice?.clearPin();
      this.inbox.clear();
      this.authorization?.abort();
      await this.pendingSignIn;
      this.authorization = undefined;
      await this.planEdit.clear();
      if (allAccounts) {
        await this.auth.clearAll([this.organizationKeyVault.allAccountScope]);
        await this.organizationKeys.clear();
      } else {
        const subject = this.accountSwitcher.snapshot.activeSubject;
        if (subject) {
          this.organizationKeyVault.forgetSubject(subject);
          await this.organizationKeys.clear();
          await this.auth.remove(subject);
        } else {
          await this.organizationKeys.forget();
          try { await this.auth.core.auth.clear(); } catch {}
          await this.auth.sessions.clear();
        }
        this.auth.renew();
      }
      this.quickPlans.clear();
      this.organization.reset();
      this.accountName = undefined;
      this.status = 'signed-out';
      this.message = undefined;
      await this.refreshAccountSummaries();
    } catch (error) {
      this.status = previousStatus;
      if (this.status === 'signed-in' && this.organization.selectedId) this.inbox.listen();
      throw error;
    } finally {
      this.inbox.endAccountTransition();
      this.signingOut = false;
    }
  }

  private discover(signal?: AbortSignal): Promise<void> {
    return this.organization.discover(signal, (message) => { this.status = 'signed-in'; this.message = message; });
  }

  private async refreshAccountSummaries(): Promise<void> {
    await this.accountSwitcher.refresh(this.status === 'signed-in');
  }

  async refreshOrganizations(): Promise<boolean> {
    const result = await this.organization.refresh();
    if (result.changed) {
      this.message = result.message;
      await this.refreshAccountSummaries();
    }
    return result.changed;
  }
}
