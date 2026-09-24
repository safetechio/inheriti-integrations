import { BUSINESS_DEPLOYMENTS, BUSINESS_INTERACTIVE_CLIENT_ID, createNodeIntegrationCore, quickPlanAssetCatalog } from '@safetech/inheriti-elements-core/node';
import type { BusinessOrganization, NodeIntegrationCore, QuickPlanInput } from '@safetech/inheriti-elements-core/node';
import { waitForCallback, untilCanceled } from '../../auth/main/oauth-callback.js';
import { TrayQuickPlans } from '../../quick-plan/main/quick-plans.js';
import { TrayPlanEdit } from '../../quick-plan/main/plan-edit.js';
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
  creation?: CreationState;
  edit: PlanEditState;
};

export class TraySession {
  private readonly core: NodeIntegrationCore;
  private organizations: BusinessOrganization[] = [];
  private selectedId: string | undefined;
  private status: TrayState['status'] = 'signed-out';
  private message: string | undefined;
  private authorization: AbortController | undefined;
  private pendingSignIn: Promise<void> | undefined;
  private pendingSelections = 0;
  private readonly quickPlans: TrayQuickPlans;
  private readonly planEdit: TrayPlanEdit;

  constructor(deployment: Deployment) {
    const config = BUSINESS_DEPLOYMENTS[deployment];
    this.core = createNodeIntegrationCore({
      apiUrl: config.apiUrl,
      business: true,
      environment: config.environment,
      liveConfirmation: config.environment,
      masterKey: {},
      configuration: {
        issuer: config.issuer,
        clientId: BUSINESS_INTERACTIVE_CLIENT_ID,
        audience: 'inheriti-integrations-api',
        environment: config.environment,
        redirectUri: 'http://127.0.0.1:53682/oauth/callback',
        scopes: ['openid', 'plan:create', 'plan:configure', 'plan:edit'],
      },
    });
    this.quickPlans = new TrayQuickPlans(config.apiUrl, config.environment, () => this.core.auth.getAccessToken());
    this.planEdit = new TrayPlanEdit(config.apiUrl, config.environment, () => this.core.auth.getAccessToken());
  }

  state(): TrayState {
    const quickPlans = this.quickPlans.state();
    const message = quickPlans.message ?? this.message;
    return {
      status: this.status,
      ...(message ? { message } : {}),
      organizations: this.organizations.map(({ id, name }) => ({ id, name })),
      teams: this.pendingSelections ? [] : quickPlans.teams,
      assetCatalog: quickPlanAssetCatalog,
      ...(this.selectedId && !this.pendingSelections ? { selectedId: this.selectedId } : {}),
      ...(quickPlans.creation ? { creation: quickPlans.creation } : {}),
      edit: this.planEdit.state(),
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
      const started = await untilCanceled(this.core.auth.beginAuthorizationCode(), authorization.signal);
      await this.core.auth.completeAuthorizationCode(await waitForCallback(started.authorizationUrl, openBrowser, authorization.signal));
      if (authorization.signal.aborted) return;
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
    try {
      if (await this.core.auth.getAccessToken()) {
        await this.discover();
        return;
      }
    } catch {}
    this.organizations = [];
    this.quickPlans.clear();
    this.planEdit.reset();
    this.selectedId = undefined;
    this.status = 'signed-out';
    this.message = undefined;
  }

  async select(id: string): Promise<void> {
    if (this.pendingSelections) throw new Error('organization_selection_in_progress');
    if (!this.organizations.some((organization) => organization.id === id)) throw new Error('organization_access_denied');
    this.pendingSelections += 1;
    try {
      this.quickPlans.assertCanSelectOrganization(id);
      await this.planEdit.selectOrganization(id);
      await this.quickPlans.selectOrganization(id);
      this.selectedId = id;
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

  async discardPlanEdit(): Promise<void> { await this.planEdit.discard(); }
  recoverPlanEdit(onChange: () => void): Promise<void> { return this.planEdit.recover(onChange); }
  clearRevealed(): void { this.planEdit.clearRevealed(); }

  async signOut(): Promise<void> {
    if (this.pendingSelections) throw new Error('organization_selection_in_progress');
    this.quickPlans.assertIdle();
    this.planEdit.assertIdle();
    this.authorization?.abort();
    await this.pendingSignIn;
    this.authorization = undefined;
    await this.planEdit.clear();
    await this.core.auth.clear();
    this.organizations = [];
    this.quickPlans.clear();
    this.selectedId = undefined;
    this.status = 'signed-out';
    this.message = undefined;
  }

  private async discover(signal?: AbortSignal): Promise<void> {
    const organizations = await this.core.listOrganizations();
    if (signal?.aborted) return;
    this.organizations = organizations;
    if (!this.organizations.some(({ id }) => id === this.selectedId)) {
      this.quickPlans.clear();
      this.planEdit.reset();
      this.selectedId = this.organizations.length === 1 ? this.organizations[0]?.id : undefined;
    }
    this.status = 'signed-in';
    this.message = this.organizations.length === 0 ? messages.noOrganizations : undefined;
    if (this.selectedId) {
      await this.quickPlans.selectOrganization(this.selectedId);
      await this.planEdit.selectOrganization(this.selectedId);
    }
  }
}
