import { BUSINESS_DEPLOYMENTS, BUSINESS_INTERACTIVE_CLIENT_ID, createNodeIntegrationCore, createOrganizationKeys, quickPlanAssetCatalog } from '@safetech/inheriti-elements-core/node';
import type { BusinessOrganization, NodeIntegrationCore, NodeIntegrationCoreOptions, OperatorSession, QuickPlanInput } from '@safetech/inheriti-elements-core/node';
import { accountNameFromIdToken } from '../../auth/main/account-name.js';
import { waitForCallback, untilCanceled } from '../../auth/main/oauth-callback.js';
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
import { trayMessages as messages } from '../../../messages.js';

export type Deployment = keyof typeof BUSINESS_DEPLOYMENTS;
export type TrayState = {
  status: 'signed-out' | 'authorizing' | 'signed-in' | 'error';
  message?: string;
  organizations: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  assetCatalog: typeof quickPlanAssetCatalog;
  selectedId?: string;
  accountName?: string;
  creation?: CreationState;
  edit: PlanEditState;
  custodianPrompt?: CustodianPromptState;
};

export class TraySession {
  private readonly core: NodeIntegrationCore;
  private readonly configuration: NodeIntegrationCoreOptions['configuration'];
  private organizations: BusinessOrganization[] = [];
  private selectedId: string | undefined;
  private accountName: string | undefined;
  private status: TrayState['status'] = 'signed-out';
  private message: string | undefined;
  private authorization: AbortController | undefined;
  private pendingSignIn: Promise<void> | undefined;
  private pendingAuthorization: ReturnType<NodeIntegrationCore['auth']['beginAuthorizationCode']> | undefined;
  private pendingSelections = 0;
  private readonly quickPlans: TrayQuickPlans;
  private readonly planEdit: TrayPlanEdit;
  private readonly organizationKeys: ReturnType<typeof createOrganizationKeys>;
  private readonly custodianPrompt = new CustodianPrompt();
  private readonly proDevice: ReturnType<typeof createTraySafeKeyPro>;
  private readonly inbox: TrayInbox;
  private inboxPublisher: ((signal?: TrayInboxSignal) => void) | undefined;
  private inboxStatePublisher: (() => void) | undefined;

  constructor(deployment: Deployment, localOverrides?: { apiUrl: string | undefined; issuer: string | undefined }) {
    const config = BUSINESS_DEPLOYMENTS[deployment];
    const apiUrl = deployment === 'local' ? localOverrides?.apiUrl || config.apiUrl : config.apiUrl;
    const issuer = deployment === 'local' ? localOverrides?.issuer || config.issuer : config.issuer;
    this.configuration = {
      issuer,
      clientId: BUSINESS_INTERACTIVE_CLIENT_ID,
      audience: 'inheriti-integrations-api',
      environment: config.environment,
      redirectUri: 'http://127.0.0.1/oauth/callback',
      scopes: ['openid', 'profile'],
    };
    this.core = createNodeIntegrationCore({
      apiUrl,
      business: true,
      environment: config.environment,
      liveConfirmation: config.environment,
      masterKey: {},
      configuration: this.configuration,
    });
    this.organizationKeys = createOrganizationKeys({ apiUrl, environment: config.environment, getBearerToken: () => this.core.auth.getAccessToken() });
    this.inbox = new TrayInbox(apiUrl, config.environment, () => this.core.auth.getAccessToken(),
      (id, signal, onRelaySession) => this.organizationKeys.resolve(id, signal, onRelaySession), () => {
        if (this.pendingSelections || this.status !== 'signed-in' || !this.selectedId) throw new Error('organization_required');
        return this.selectedId;
      }, (signal) => this.inboxPublisher?.(signal), () => this.inboxStatePublisher?.());
    this.proDevice = createTraySafeKeyPro(deployment, this.custodianPrompt);
    this.quickPlans = new TrayQuickPlans(apiUrl, config.environment, () => this.core.auth.getAccessToken(), (id, signal, onRelaySession) => this.organizationKeys.resolve(id, signal, onRelaySession));
    this.planEdit = new TrayPlanEdit(apiUrl, config.environment, () => this.core.auth.getAccessToken(), (id, signal, onRelaySession) => this.organizationKeys.resolve(id, signal, onRelaySession), {
      selectCustodianDevice: () => this.custodianPrompt.choose(!!this.proDevice),
      proDevice: this.proDevice,
    });
  }

  setPublisher(publish: () => void): void { this.custodianPrompt.setPublisher(publish); }
  setInboxPublisher(publish: (signal?: TrayInboxSignal) => void): void { this.inboxPublisher = publish; }
  setInboxStatePublisher(publish: () => void): void { this.inboxStatePublisher = publish; }
  selectCustodianDevice(value: unknown): void { this.custodianPrompt.select(value); }
  submitSafeKeyProPin(value: unknown): void { this.custodianPrompt.submitPin(value); }

  state(): TrayState {
    const quickPlans = this.quickPlans.state();
    const message = quickPlans.message ?? this.message;
    const custodianPrompt = this.custodianPrompt.state();
    return {
      status: this.status,
      ...(message ? { message } : {}),
      organizations: this.organizations.map(({ id, name }) => ({ id, name })),
      teams: this.pendingSelections ? [] : quickPlans.teams,
      assetCatalog: quickPlanAssetCatalog,
      ...(this.selectedId && !this.pendingSelections ? { selectedId: this.selectedId } : {}),
      ...(this.status === 'signed-in' && this.accountName ? { accountName: this.accountName } : {}),
      ...(quickPlans.creation ? { creation: quickPlans.creation } : {}),
      edit: this.planEdit.state(),
      ...(custodianPrompt ? { custodianPrompt } : {}),
    };
  }

  signIn(onChange: () => void, openBrowser: (url: string) => Promise<void>): Promise<void> {
    if (this.pendingSignIn) return this.pendingSignIn;
    const pending = this.runSignIn(onChange, openBrowser);
    this.pendingSignIn = pending.finally(() => {
      this.pendingSignIn = undefined;
    });
    return this.pendingSignIn;
  }

  private async runSignIn(onChange: () => void, openBrowser: (url: string) => Promise<void>): Promise<void> {
    const authorization = new AbortController();
    this.authorization = authorization;
    this.status = 'authorizing';
    this.message = undefined;
    onChange();
    try {
      const callbackUrl = await waitForCallback(async (redirectUri) => {
        if (this.pendingAuthorization) await untilCanceled(this.pendingAuthorization.catch(() => undefined), authorization.signal);
        authorization.signal.throwIfAborted();
        this.configuration.redirectUri = redirectUri;
        const pending = this.core.auth.beginAuthorizationCode();
        this.pendingAuthorization = pending;
        const started = await untilCanceled(pending, authorization.signal);
        authorization.signal.throwIfAborted();
        return started.authorizationUrl;
      }, openBrowser, authorization.signal);
      const session = await this.core.auth.completeAuthorizationCode(callbackUrl) as OperatorSession;
      if (authorization.signal.aborted) return;
      this.accountName = accountNameFromIdToken(session?.idToken);
      await this.discover(authorization.signal);
    } catch (error) {
      if (authorization.signal.aborted) return;
      this.status = 'error';
      this.message = error instanceof Error ? error.message : messages.signInFailed;
    }
    if (this.authorization === authorization) this.authorization = undefined;
    onChange();
  }

  async restore(): Promise<void> {
    this.custodianPrompt.cancel();
    this.proDevice?.clearPin();
    try {
      if (await this.core.auth.getAccessToken()) {
        await this.discover();
        return;
      }
    } catch {}
    this.organizations = [];
    this.inbox.clear();
    await this.organizationKeys.clear();
    this.quickPlans.clear();
    this.planEdit.reset();
    this.selectedId = undefined;
    this.accountName = undefined;
    this.status = 'signed-out';
    this.message = undefined;
  }

  async select(id: string): Promise<void> {
    if (this.pendingSelections) throw new Error('organization_selection_in_progress');
    if (!this.organizations.some((organization) => organization.id === id)) throw new Error('organization_access_denied');
    this.pendingSelections += 1;
    try {
      this.quickPlans.assertCanSelectOrganization(id);
      if (this.selectedId !== id) {
        this.inbox.clear();
        await this.organizationKeys.clear();
      }
      await this.planEdit.selectOrganization(id);
      await this.quickPlans.selectOrganization(id);
      this.selectedId = id;
      this.inbox.listen();
    } finally {
      this.pendingSelections -= 1;
    }
  }

  createQuickPlan(input: { title: string; asset: QuickPlanInput['asset']; teamId?: string }, onChange: () => void): Promise<void> {
    if (this.pendingSelections) throw new Error('organization_selection_in_progress');
    if (this.status !== 'signed-in' || !this.selectedId) throw new Error('organization_required');
    return this.quickPlans.create(input, onChange);
  }

  abandonCreation(): void {
    this.quickPlans.abandon();
  }

  cancelKeyRequest(): void {
    this.quickPlans.cancelKeyRequest();
  }

  loadEditablePlans(onChange: () => void): Promise<void> {
    if (this.pendingSelections || this.status !== 'signed-in' || !this.selectedId) throw new Error('organization_required');
    return this.planEdit.load(onChange);
  }

  addPlanAsset(planId: string, asset: QuickPlanInput['asset'], onChange: () => void): Promise<void> {
    if (this.pendingSelections || this.status !== 'signed-in' || !this.selectedId) throw new Error('organization_required');
    return this.planEdit.add(planId, asset, onChange);
  }

  listPlanAssets(planId: string, onChange: () => void): Promise<void> {
    if (this.pendingSelections || this.status !== 'signed-in' || !this.selectedId) throw new Error('organization_required');
    return this.planEdit.listAssets(planId, onChange);
  }

  getPlanAsset(planId: string, assetId: string) {
    if (this.pendingSelections || this.status !== 'signed-in' || !this.selectedId) throw new Error('organization_required');
    return this.planEdit.getAsset(planId, assetId);
  }

  replacePlanAsset(planId: string, assetId: string, asset: QuickPlanInput['asset'], onChange: () => void): Promise<void> {
    if (this.pendingSelections || this.status !== 'signed-in' || !this.selectedId) throw new Error('organization_required');
    return this.planEdit.replace(planId, assetId, asset, onChange);
  }

  async discardPlanEdit(): Promise<void> { this.custodianPrompt.cancel(); this.proDevice?.clearPin(); await this.planEdit.discard(); }
  async cancelPlanEdit(): Promise<void> { this.custodianPrompt.cancel(); this.proDevice?.clearPin(); await this.planEdit.cancelAccess(); }
  recoverPlanEdit(onChange: () => void): Promise<void> { return this.planEdit.recover(onChange); }
  inboxState(): InboxIdentityState { return this.inbox.state(); }
  registeredInboxMemberId(): Promise<string | undefined> { return this.inbox.registeredMemberId(); }
  prepareInbox(): Promise<InboxIdentityState> { return this.inbox.prepare(); }
  replaceInboxDevice(): Promise<InboxIdentityState> { return this.inbox.replace(); }
  cancelInboxPreparation(): void { this.inbox.cancelPreparation(); }
  listInboxParticipants(input?: { q?: string; limit?: number; offset?: number }) { return this.inbox.listParticipants(input); }
  createInboxConversation(title: string, participantMemberIds: string[]) { return this.inbox.createConversation(title, participantMemberIds); }
  changeInboxParticipants(conversationId: string, input: { action: 'ADD' | 'REMOVE'; memberId: string; expectedRevision: number }) { return this.inbox.changeParticipants(conversationId, input); }
  listInboxConversations(input?: { status?: 'ACTIVE' | 'CLOSED'; limit?: number; offset?: number }) { return this.inbox.listConversations(input); }
  clearInboxHistory(conversationId: string) { return this.inbox.clearHistory(conversationId); }
  listInboxParents(conversationId: string) { return this.inbox.listParents(conversationId); }
  sendInboxParent(conversationId: string, parentId: string, segments: Array<{ text: string } | { protectedText: string; expiresAt: string }>) { return this.inbox.sendParent(conversationId, parentId, segments); }
  revealInboxUnit(conversationId: string, parentId: string, unitId: string) { return this.inbox.revealUnit(conversationId, parentId, unitId); }
  listInboxMessages(conversationId: string, input?: { status?: 'PREPARING' | 'AVAILABLE' | 'FAILED'; limit?: number; offset?: number }) { return this.inbox.listMessages(conversationId, input); }
  prepareNormalInbox(conversationId: string) { return this.inbox.prepareNormal(conversationId); }
  listNormalInboxMetadata(conversationId: string) { return this.inbox.listNormalMetadata(conversationId); }
  listNormalInboxMessages(conversationId: string) { return this.inbox.listNormal(conversationId); }
  sendNormalInboxText(conversationId: string, parentId: string, text: string) { return this.inbox.sendNormal(conversationId, parentId, text); }
  sendInboxText(conversationId: string, text: string, expiresAt: string) { return this.inbox.sendText(conversationId, text, expiresAt); }
  sendInboxFile(conversationId: string, expiresAt: string, progress?: (completed: number, total: number, stage?: string) => void) { return this.inbox.sendFile(conversationId, expiresAt, progress); }
  openInboxText(conversationId: string, messageId: string) { return this.inbox.openText(conversationId, messageId); }
  openInboxFile(conversationId: string, messageId: string, progress?: (completed: number, total: number, stage?: string) => void) { return this.inbox.openFile(conversationId, messageId, progress); }
  cancelInboxTransfer(): void { this.inbox.cancelTransfer(); }
  retryInboxAck(conversationId: string, messageId: string) { return this.inbox.retryAck(conversationId, messageId); }
  hideInboxText(): void { this.inbox.hide(); }
  clearRevealed(): void { this.custodianPrompt.cancel(); this.proDevice?.clearPin(); this.planEdit.clearRevealed(); this.inbox.hide(); }
  clearOnLock(): void { this.clearRevealed(); this.quickPlans.clearResolved(); this.inbox.clear(); void this.organizationKeys.clear(); }

  async signOut(): Promise<void> {
    this.custodianPrompt.cancel();
    this.proDevice?.clearPin();
    if (this.pendingSelections) throw new Error('organization_selection_in_progress');
    this.quickPlans.assertIdle();
    this.planEdit.assertIdle();
    this.inbox.clear();
    this.authorization?.abort();
    await this.pendingSignIn;
    this.authorization = undefined;
    await this.planEdit.clear();
    await this.core.auth.clear();
    await this.organizationKeys.clear();
    this.organizations = [];
    this.quickPlans.clear();
    this.selectedId = undefined;
    this.accountName = undefined;
    this.status = 'signed-out';
    this.message = undefined;
  }

  private async discover(signal?: AbortSignal): Promise<void> {
    const organizations = await this.core.listOrganizations();
    if (signal?.aborted) return;
    this.organizations = organizations;
    if (!this.organizations.some(({ id }) => id === this.selectedId)) {
      this.quickPlans.clear();
      this.inbox.clear();
      this.planEdit.reset();
      this.selectedId = this.organizations.length === 1 ? this.organizations[0]?.id : undefined;
    }
    this.status = 'signed-in';
    this.message = this.organizations.length === 0 ? messages.noOrganizations : undefined;
    if (this.selectedId) {
      await this.quickPlans.selectOrganization(this.selectedId);
      await this.planEdit.selectOrganization(this.selectedId);
      this.inbox.listen();
    }
  }
}
