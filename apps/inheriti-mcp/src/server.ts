import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BUSINESS_DEPLOYMENTS, BUSINESS_INTERACTIVE_CLIENT_ID, businessDeployment, createNativeWindowSession, createNodeIntegrationCore, latestIntegrationBuild, selectBusinessOrganization, MemoryOperatorSessionStore, readOrganizationPreferences, saveOrganizationPreferences, createQuickPlanOperations, quickPlanAssetCatalog, localPlanAssetLimit, runLocalPlanBrowser, createAutomationSetupOperations, githubAutomationWorkflow, githubAutomationWorkflowLocation, isGithubAutomationSelector, runLocalAutomationProofBrowser, LlamaPlanModel } from '@safetech/inheriti-elements-core/node-base';
import type { LocalPlanHints, AutomationProvider, AutomationTrust } from '@safetech/inheriti-elements-core/node-base';
import type { NodeIntegrationCore, NodeIntegrationCoreOptions } from '@safetech/inheriti-elements-core/node-base';
import { beginBrowserLogin } from './browser-login.js';
import { planDetail, planSummary } from './metadata.js';
import { revealModeOf, revealProgressMessage } from '@safetech/inheriti-elements-core/node-base';
import { deliverAssetInBrowser, deliverFieldsInBrowser, deliverSelectionInBrowser, deliverInBrowser } from './local-browser.js';
import { openSafeKeyProPrompt } from './safekey-pro.js';
import { ensureLocalAssistant } from './plan-assistant.js';

const configPath = () => {
  const base = process.env.XDG_CONFIG_HOME ?? resolve(homedir(), '.config');
  const current = resolve(base, 'inheriti', 'config.json');
  const legacy = resolve(base, 'inheriti-elements', 'config.json');
  return existsSync(current) || !existsSync(legacy) ? current : legacy;
};
const coded = (code: string) => Object.assign(new Error(code), { code });
type AutomationTrustInput = Exclude<AutomationTrust, { method: 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC' }> |
  { method: 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC'; audienceBase: string; serviceAccountSubject: string };
const automationTrust = (input: AutomationTrustInput, connectionId: string): AutomationTrust => input.method === 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC'
  ? { method: input.method, audience: `${input.audienceBase.replace(/\/$/, '')}/${connectionId}`, serviceAccountSubject: input.serviceAccountSubject } : input;
declare const __INHERITI_PRODUCTION_BUILD__: boolean;
declare const __INHERITI_DEPLOYMENT__: string;
const developmentBuild = typeof __INHERITI_PRODUCTION_BUILD__ !== 'boolean' || !__INHERITI_PRODUCTION_BUILD__;
export const lockedDeployment = typeof __INHERITI_DEPLOYMENT__ === 'string'
  ? businessDeployment(__INHERITI_DEPLOYMENT__) : undefined;

type Configuration = { apiUrl: string; issuer: string; clientId: string; environment: 'TEST' | 'LIVE'; redirectUri: string; deployment?: string };
async function configuration(): Promise<Configuration> {
  if (lockedDeployment) {
    return { ...BUSINESS_DEPLOYMENTS[lockedDeployment], deployment: lockedDeployment, clientId: BUSINESS_INTERACTIVE_CLIENT_ID,
      redirectUri: 'http://127.0.0.1:53682/oauth/callback' };
  }
  const raw: unknown = JSON.parse(await readFile(configPath(), 'utf8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw coded('configuration_invalid');
  const value = raw as Record<string, unknown>;
  if (value.deployment !== undefined) {
    const deployment = businessDeployment(value.deployment);
    if (!deployment || value.business !== true) throw coded('configuration_invalid');
    if (deployment === 'prod' && developmentBuild) throw coded('live_environment_unavailable_in_development_build');
    return { ...BUSINESS_DEPLOYMENTS[deployment], deployment, clientId: BUSINESS_INTERACTIVE_CLIENT_ID,
      redirectUri: typeof value.redirectUri === 'string' ? value.redirectUri : 'http://127.0.0.1:53682/oauth/callback' };
  }
  if (typeof value.apiUrl !== 'string' || typeof value.issuer !== 'string' || typeof value.clientId !== 'string' || !['TEST', 'LIVE'].includes(String(value.environment))) throw coded('configuration_invalid');
  if (value.environment === 'LIVE' && developmentBuild) throw coded('live_environment_unavailable_in_development_build');
  return { apiUrl: value.apiUrl, issuer: value.issuer, clientId: value.clientId, environment: value.environment as 'TEST' | 'LIVE', redirectUri: typeof value.redirectUri === 'string' ? value.redirectUri : 'http://127.0.0.1:53682/oauth/callback' };
}

export class MetadataTools {
  private core: NodeIntegrationCore | undefined;
  private authGeneration = 0;
  private config: Configuration | undefined;
  private authConfiguration: NodeIntegrationCoreOptions['configuration'] | undefined;
  private initializing: Promise<NodeIntegrationCore> | undefined;
  private authorizing: ReturnType<MetadataTools['authorize']> | undefined;
  private browserLogin: { cancel: () => void } | undefined;
  private scoped: { identity: string; organizationId: string; core: NodeIntegrationCore } | undefined;
  private selecting: ReturnType<MetadataTools['selectCore']> | undefined;
  private sessions = new MemoryOperatorSessionStore();
  private job?: { id: string; planId: string; organizationId: string; phase: string; progress?: { revealId?: string; expiresAt?: string; dmsExpiresAt?: string; governanceExpiresAt?: string; governanceGate?: string; approvedModerators?: number; requiredModerators?: number; deniedBy?: string; closedReason?: string }; message?: string; code?: string; status: 'WAITING' | 'DELIVERED' | 'FAILED' | 'CANCELED'; controller: AbortController; done: Promise<void> };
  private planJob?: { id: string; status: 'WAITING' | 'CREATED' | 'PENDING' | 'FAILED' | 'CANCELED'; phase: string; planId?: string; controller: AbortController; done: Promise<void> };
  private automationJob?: { id: string; status: 'WAITING' | 'COMPLETE' | 'FAILED' | 'CANCELED'; phase: string; controller: AbortController; done: Promise<void> };
  private selectionVersion = 0;
  private login: { authorizationUrl: string } | undefined;
  private loginFailure: string | undefined;

  async updateAccess(onChallenge: (url: string) => void): Promise<NodeIntegrationCore> {
    const initial = await this.ready();
    if ('core' in initial) return initial.core;
    onChallenge(initial.login.authorizationUrl);
    const core = await this.client();
    for (let attempt = 0; attempt < 120; attempt++) {
      if (await core.getAccessToken()) return core;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw coded('authorization_timed_out');
  }

  async checkUpdate() {
    const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;
    if (!lockedDeployment) return { version, updateAvailable: false, reason: 'Updates require a channel-locked build.' };
    const ready = await this.ready(); if ('login' in ready) return ready;
    const build = latestIntegrationBuild(await ready.core.listInternalBuilds(), 'mcp', version, `${process.platform}-${process.arch}`);
    return { version, updateAvailable: Boolean(build), latestVersion: build?.version,
      instruction: build ? 'Ask the operator to run inheriti-mcp update --install in a terminal, then restart this MCP server.' : undefined };
  }

  private client(): Promise<NodeIntegrationCore> {
    if (!this.initializing) {
      const pending = this.initializeClient().catch(error => { if (this.initializing === pending) this.initializing = undefined; throw error; });
      this.initializing = pending;
    }
    return this.initializing;
  }

  private async initializeClient(): Promise<NodeIntegrationCore> {
    const generation = this.authGeneration;
    if (!this.core) {
      const config = await configuration();
      this.assertGeneration(generation);
      this.config = config;
      this.authConfiguration = { issuer: config.issuer, clientId: config.clientId, audience: 'inheriti-integrations-api',
        environment: config.environment, redirectUri: config.redirectUri, scopes: ['openid'] };
      this.core = createNodeIntegrationCore({
        apiUrl: this.config.apiUrl, business: true, environment: this.config.environment,
        liveConfirmation: this.config.environment,
        configuration: this.authConfiguration,
        sessions: this.sessions,
      });
    }
    return this.core;
  }

  private authorized() {
    if (!this.authorizing) {
      const pending = this.authorize().finally(() => { if (this.authorizing === pending) this.authorizing = undefined; });
      this.authorizing = pending;
    }
    return this.authorizing;
  }

  private async authorize(): Promise<NodeIntegrationCore | { login: { authorizationUrl: string } }> {
    const generation = this.authGeneration;
    const core = await this.client();
    this.assertGeneration(generation);
    let accessToken: string | undefined;
    try { accessToken = await core.getAccessToken(); }
    catch (error) {
      this.assertGeneration(generation);
      if (!(await this.sessions.load())) await this.stopLocalAccess();
      throw error;
    }
    this.assertGeneration(generation);
    if (accessToken) {
      this.browserLogin?.cancel();
      this.browserLogin = undefined;
      this.login = undefined;
      this.loginFailure = undefined;
      return core;
    }
    await this.stopLocalAccess();
    this.assertGeneration(generation);
    if (this.loginFailure) {
      const code = this.loginFailure;
      this.loginFailure = undefined;
      throw coded(code);
    }
    if (!this.login) {
      const started = await beginBrowserLogin(core.auth, this.authConfiguration!);
      try { this.assertGeneration(generation); }
      catch (error) { started.cancel(); throw error; }
      this.login = { authorizationUrl: started.authorizationUrl };
      const challengeShown = this.login;
      this.browserLogin = started;
      void started.completed.then(
        () => { if (this.login === challengeShown) { this.login = undefined; this.browserLogin = undefined; } },
        error => {
          if (this.login !== challengeShown) return;
          this.loginFailure = safeErrorCode(error);
          this.login = undefined;
          this.browserLogin = undefined;
        },
      );
    }
    return { login: this.login };
  }

  private async ready() {
    const result = await this.authorized();
    if ('login' in result) return { login: result.login };
    return { core: result };
  }

  private preferencePath() { return resolve(dirname(configPath()), 'mcp-organizations.json'); }
  private async key() {
    const config = this.config;
    const session = await this.sessions.load();
    if (!session || !config) throw coded('operator_reauthentication_required');
    return JSON.stringify([config.issuer, config.environment, session.principal.subject]);
  }
  private preferences() { return readOrganizationPreferences(this.preferencePath()); }
  private save(value: Record<string, string>) { return saveOrganizationPreferences(this.preferencePath(), value); }
  private async stopLocalAccess() {
    if (!this.scoped && this.job?.status !== 'WAITING' && this.planJob?.status !== 'WAITING' && this.automationJob?.status !== 'WAITING') return;
    this.selectionVersion++;
    await this.cancelPlanJob();
    await this.cancelAutomationJob();
    const job = this.job;
    if (job?.status === 'WAITING') { job.controller.abort(); await job.done; }
    await this.clearScoped();
  }
  private async clearScoped() {
    const scoped = this.scoped;
    this.scoped = undefined;
    if (scoped) await scoped.core.forgetMasterKey();
  }
  async listOrganizations() {
    const ready = await this.ready(); if ('login' in ready) return ready;
    const items = await ready.core.listOrganizations();
    const scopedOrganizationId = this.scoped?.organizationId;
    if (scopedOrganizationId && !items.some(item => item.id === scopedOrganizationId)) await this.stopLocalAccess();
    const preferences = await this.preferences(); const selected = preferences[await this.key()];
    if (selected && !items.some(item => item.id === selected)) {
      await this.stopLocalAccess();
      delete preferences[await this.key()]; await this.save(preferences);
    }
    return { items: items.map(({ id, name }) => ({ id, name })), selectedId: preferences[await this.key()] ?? (items.length === 1 ? items[0]!.id : null) };
  }
  async selectOrganization(id: string) {
    const generation = this.authGeneration;
    const version = ++this.selectionVersion;
    await this.cancelPlanJob();
    await this.cancelAutomationJob();
    const active = this.job;
    const canceling = active?.status === 'WAITING';
    if (active?.status === 'WAITING') active.controller.abort();
    const ready = await this.ready(); if ('login' in ready) return ready;
    const items = await ready.core.listOrganizations();
    const selectedId = selectBusinessOrganization(items, id);
    if (active?.status === 'WAITING') await active.done;
    if (canceling && (active?.code === 'reveal_cancellation_failed' || active?.code === 'master_key_relay_cancellation_failed')) throw coded(active.code);
    this.assertGeneration(generation);
    if (version !== this.selectionVersion) throw coded('organization_selection_changed');
    await this.clearScoped();
    const preferences = await this.preferences();
    const key = await this.key();
    this.assertGeneration(generation);
    if (version !== this.selectionVersion) throw coded('organization_selection_changed');
    preferences[key] = selectedId; await this.save(preferences);
    return { selectedId };
  }
  private selected() {
    if (!this.selecting) {
      const pending = this.selectCore().finally(() => { if (this.selecting === pending) this.selecting = undefined; });
      this.selecting = pending;
    }
    return this.selecting;
  }
  private async selectCore() {
    const version = this.selectionVersion;
    const generation = this.authGeneration;
    const ready = await this.ready();
    this.assertGeneration(generation); if ('login' in ready) return ready;
    const items = await ready.core.listOrganizations();
    const scopedOrganizationId = this.scoped?.organizationId;
    if (scopedOrganizationId && !items.some(item => item.id === scopedOrganizationId)) await this.stopLocalAccess();
    const preferences = await this.preferences(); const saved = preferences[await this.key()];
    if (saved && !items.some(item => item.id === saved)) {
      await this.stopLocalAccess();
      delete preferences[await this.key()]; await this.save(preferences);
      throw coded('organization_access_denied');
    }
    const id = selectBusinessOrganization(items, saved);
    if (version !== this.selectionVersion) throw coded('organization_selection_changed');
    const session = await this.sessions.load();
    if (!session) throw coded('operator_reauthentication_required');
    this.assertGeneration(generation);
    const identity = JSON.stringify([this.config!.issuer, this.config!.environment, session.principal.subject, session.principal.sessionId]);
    if (this.scoped?.identity !== identity || this.scoped.organizationId !== id) {
      if (this.scoped && (this.job?.status === 'WAITING' || this.planJob?.status === 'WAITING' || this.automationJob?.status === 'WAITING')) {
        this.selectionVersion++;
        await this.cancelPlanJob();
        await this.cancelAutomationJob();
        if (this.job?.status === 'WAITING') { this.job.controller.abort(); await this.job.done; }
        await this.clearScoped();
        throw coded('organization_selection_changed');
      }
      await this.clearScoped();
      this.assertGeneration(generation);
      if (version !== this.selectionVersion) throw coded('organization_selection_changed');
      const core = createNodeIntegrationCore({
        apiUrl: this.config!.apiUrl, business: true, organizationId: id, environment: this.config!.environment,
        liveConfirmation: this.config!.environment, auth: ready.core.auth,
        configuration: { issuer: this.config!.issuer, clientId: this.config!.clientId, audience: 'inheriti-integrations-api', environment: this.config!.environment, redirectUri: this.config!.redirectUri, scopes: ['openid'] },
        sessions: this.sessions,
      });
      this.scoped = { identity, organizationId: id, core };
    }
    return { core: this.scoped.core, organizationId: id };
  }
  private assertGeneration(generation: number) {
    if (generation !== this.authGeneration) throw coded('operator_reauthentication_required');
  }
  async logout() {
    this.selectionVersion++;
    this.authGeneration++;
    await this.cancelPlanJob();
    await this.cancelAutomationJob();
    this.browserLogin?.cancel();
    const retired = this.sessions;
    const retiredScoped = this.scoped;
    this.scoped = undefined;
    this.sessions = new MemoryOperatorSessionStore();
    this.core = undefined;
    this.config = undefined;
    this.authConfiguration = undefined;
    this.initializing = undefined;
    this.authorizing = undefined;
    this.selecting = undefined;
    this.login = undefined;
    this.browserLogin = undefined;
    this.loginFailure = undefined;
    const job = this.job;
    if (job?.status === 'WAITING') { job.controller.abort(); await job.done; }
    if (retiredScoped) await retiredScoped.core.forgetMasterKey();
    await retired.clear();
    return { signedOut: true, ...(job?.code === 'reveal_cancellation_failed' || job?.code === 'master_key_relay_cancellation_failed'
      ? { cancellation: { code: job.code, message: job.message } } : {}) };
  }
  async abortPlanAccess(planId: string, expectedRevealId?: string) {
    const selected = await this.selected(); if (!('organizationId' in selected)) return selected;
    const job = this.job;
    if (job?.status === 'WAITING' && job.organizationId === selected.organizationId && job.planId === planId) {
      job.controller.abort();
      await job.done;
    }
    const { aborted } = await selected.core.abortPlanAccess(planId, expectedRevealId);
    return { organizationId: selected.organizationId, aborted };
  }
  async listPlans(cursor?: string) {
    const selected = await this.selected(); if (!('organizationId' in selected)) return selected;
    const page = await selected.core.listPlans(cursor ? { cursor, limit: 50 } : { limit: 50 });
    return { organizationId: selected.organizationId, items: page.items.map(planSummary), nextCursor: page.nextCursor };
  }
  async getPlan(id: string) {
    const selected = await this.selected(); if (!('organizationId' in selected)) return selected;
    return { organizationId: selected.organizationId, plan: planDetail(await selected.core.getPlan(id)) };
  }
  async listPlanLogs(planId: string, limit?: number, offset?: number) {
    const selected = await this.selected(); if (!('organizationId' in selected)) return selected;
    const page = await selected.core.listPlanLogs(planId, {
      ...(limit === undefined ? {} : { limit }),
      ...(offset === undefined ? {} : { offset }),
    });
    return { organizationId: selected.organizationId, ...page };
  }
  private async cancelPlanJob() {
    const job = this.planJob;
    if (job?.status === 'WAITING') { job.controller.abort(); await job.done; }
  }
  private async cancelAutomationJob() {
    const job = this.automationJob;
    if (job?.status === 'WAITING') { job.controller.abort(); await job.done; }
  }
  private localAutomation() {
    const url = this.config?.apiUrl;
    const parsed = url ? new URL(url) : undefined;
    const hostname = parsed?.hostname ?? '';
    if (!['localhost', '127.0.0.1'].includes(hostname) && !hostname.endsWith('.localhost') && parsed?.href !== BUSINESS_DEPLOYMENTS.dev.apiUrl) throw coded('automation_local_only');
  }
  private async automationOperations() {
    const selected = await this.selected(); if (!('organizationId' in selected)) return selected;
    this.localAutomation();
    return { organizationId: selected.organizationId, operations: createAutomationSetupOperations({ apiUrl: this.config!.apiUrl,
      organizationId: selected.organizationId, getBearerToken: () => selected.core.getAccessToken() }) };
  }
  async listAutomationConnections() {
    const selected = await this.automationOperations(); if (!('operations' in selected)) return selected;
    const items = await selected.operations.listConnections();
    return { organizationId: selected.organizationId, items: items.map(({ id, name, provider, environment, status }) => ({ id, name, provider, environment, status })) };
  }
  async listAutomationGrants(planId: string) {
    const selected = await this.automationOperations(); if (!('operations' in selected)) return selected;
    const items = await selected.operations.listGrants(planId);
    return { organizationId: selected.organizationId, planId, items: items.map(({ id, connectionId, responsibleMemberId, status }) => ({ id, connectionId, responsibleMemberId, status })) };
  }
  async githubAutomationUsage(planId: string, connectionId: string, selector: string) {
    const selected = await this.automationOperations(); if (!('operations' in selected)) return selected;
    const grants = await selected.operations.listGrants(planId);
    if (!grants.some(grant => grant.connectionId === connectionId && grant.status === 'ACTIVE')) throw coded('automation_active_grant_required');
    const connection = await selected.operations.getConnection(connectionId);
    if (connection.provider !== 'GITHUB' || connection.status !== 'VERIFIED' || connection.trust.method !== 'GITHUB_ACTIONS_OIDC') throw coded('automation_verified_github_required');
    const location = githubAutomationWorkflowLocation(connection.trust.repositoryName, connection.trust.workflow);
    const release = await selected.operations.getVerifiedGithubRelease();
    return { organizationId: selected.organizationId, planId, connectionId, location, workflow: githubAutomationWorkflow({ release, environment: connection.trust.environment, planId, connectionId, selector }), instruction: `Save this YAML in ${location.repository}/${location.path} on branch ${location.branch}. The file and branch must match the verified connection. Find asset.field in the plan Data tab; the default run only checks injection.` };
  }
  async listAutomationMembers() {
    const selected = await this.automationOperations(); if (!('operations' in selected)) return selected;
    const items = await selected.operations.listMembers();
    return { organizationId: selected.organizationId, items: items.map(({ id, firstName, lastName, status }) => ({
      id, displayName: [firstName, lastName].filter(Boolean).join(' ') || id, status,
    })) };
  }
  async createAutomationConnection(input: { name: string; provider: AutomationProvider; environment: 'TEST' | 'LIVE'; trust: AutomationTrustInput; managingTeamId?: string | undefined }) {
    const selected = await this.automationOperations(); if (!('operations' in selected)) return selected;
    const id = crypto.randomUUID();
    const trust = automationTrust(input.trust, id);
    await selected.operations.createConnection({ id, name: input.name, provider: input.provider, environment: input.environment,
      trust, ...(input.managingTeamId ? { managingTeamId: input.managingTeamId } : {}) });
    return { organizationId: selected.organizationId, connectionId: id, status: 'PENDING_VERIFICATION',
      ...(trust.method === 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC' ? { expectedAudience: trust.audience } : input.provider === 'GITHUB' ? { expectedAudience: `urn:inheriti:automation:connection:${id}` } : {}),
      instruction: 'Open the secure window with this connectionId to enter identity proof.' };
  }
  async changeAutomationTrust(connectionId: string, trust: AutomationTrustInput) {
    const selected = await this.automationOperations(); if (!('operations' in selected)) return selected;
    const value = automationTrust(trust, connectionId);
    await selected.operations.changeTrust(connectionId, value);
    return { organizationId: selected.organizationId, connectionId, updated: true,
      ...(value.method === 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC' ? { expectedAudience: value.audience } : value.method === 'GITHUB_ACTIONS_OIDC' ? { expectedAudience: `urn:inheriti:automation:connection:${connectionId}` } : {}),
      instruction: 'Open the secure window with this connectionId to verify the new identity.' };
  }
  async disableAutomationConnection(connectionId: string) {
    const selected = await this.automationOperations(); if (!('operations' in selected)) return selected;
    await selected.operations.disableConnection(connectionId);
    return { organizationId: selected.organizationId, connectionId, disabled: true };
  }
  async manageAutomationGrant(action: 'create' | 'activate' | 'replace' | 'revoke', planId: string, input: { grantId?: string; connectionId?: string; responsibleMemberId?: string }) {
    const selected = await this.automationOperations(); if (!('operations' in selected)) return selected;
    const grantId = action === 'create' ? crypto.randomUUID() : input.grantId!;
    if (action === 'create') await selected.operations.createGrant(planId, { id: grantId, connectionId: input.connectionId!, responsibleMemberId: input.responsibleMemberId! });
    else if (action === 'activate') await selected.operations.activateGrant(planId, grantId);
    else if (action === 'replace') await selected.operations.replaceResponsibleMember(planId, grantId, input.responsibleMemberId!);
    else await selected.operations.revokeGrant(planId, grantId);
    return { organizationId: selected.organizationId, planId, grantId, action };
  }
  async startAutomationSetup(connectionId: string) {
    const version = this.selectionVersion;
    const selected = await this.selected(); if (!('organizationId' in selected)) return selected;
    if (version !== this.selectionVersion) throw coded('organization_selection_changed');
    this.localAutomation();
    if (this.automationJob?.status === 'WAITING') throw coded('automation_setup_in_progress');
    const controller = new AbortController();
    let unavailable = false;
    const window = createNativeWindowSession(reason => { unavailable = reason === 'unavailable'; controller.abort(); });
    const job: NonNullable<typeof this.automationJob> = { id: crypto.randomUUID(), status: 'WAITING', phase: 'WINDOW', controller, done: Promise.resolve() };
    this.automationJob = job;
    job.done = (async () => {
      const operations = createAutomationSetupOperations({ apiUrl: this.config!.apiUrl, organizationId: selected.organizationId,
        getBearerToken: () => selected.core.getAccessToken() });
      const result = await runLocalAutomationProofBrowser({ operations, connectionId, open: url => window.open(url), signal: controller.signal });
      if (controller.signal.aborted || version !== this.selectionVersion) throw coded('automation_setup_canceled');
      job.status = result.action === 'verified' ? 'COMPLETE' : 'CANCELED'; job.phase = job.status;
    })().catch(() => { job.status = unavailable ? 'FAILED' : controller.signal.aborted ? 'CANCELED' : 'FAILED'; job.phase = unavailable ? 'WINDOW_UNAVAILABLE' : job.status; })
      .finally(() => { if (job.status === 'COMPLETE') window.complete(); else window.close(); });
    return { jobId: job.id, status: job.status };
  }
  async automationSetupStatus(jobId: string, cancel = false) {
    const job = this.automationJob;
    if (!job || job.id !== jobId) throw coded('automation_setup_not_found');
    if (cancel && job.status === 'WAITING') { job.controller.abort(); await job.done; }
    return { jobId: job.id, status: job.status, phase: job.phase };
  }
  async createPlanWithAssistant(hints?: LocalPlanHints) {
    const version = this.selectionVersion;
    const selected = await this.selected(); if (!('organizationId' in selected)) return selected;
    if (version !== this.selectionVersion) throw coded('organization_selection_changed');
    if (this.planJob?.status === 'WAITING') throw coded('plan_creation_in_progress');
    const controller = new AbortController();
    let windowUnavailable = false;
    const window = createNativeWindowSession(reason => { windowUnavailable = reason === 'unavailable'; controller.abort(); });
    const job: NonNullable<typeof this.planJob> = { id: crypto.randomUUID(), status: 'WAITING', phase: 'SETUP', controller, done: Promise.resolve() };
    this.planJob = job;
    job.done = (async () => {
      const installed = await ensureLocalAssistant(controller.signal, url => window.open(url));
      if (controller.signal.aborted || version !== this.selectionVersion) throw coded('local_plan_canceled');
      const model = new LlamaPlanModel(installed.executablePath, installed.modelPath);
      const operations = createQuickPlanOperations({ apiUrl: this.config!.apiUrl, environment: this.config!.environment,
        organizationId: selected.organizationId, getBearerToken: () => selected.core.getAccessToken() });
      let masterKeySource: { resolve: () => Promise<string> } | undefined;
      let planContext: Awaited<ReturnType<typeof operations.createContext>> | undefined;
      let inputFingerprint: string | undefined;
      let creationFlight: ReturnType<typeof operations.createMany> | undefined;
      const teams = (await operations.teams()).teams;
      if (controller.signal.aborted || version !== this.selectionVersion) throw coded('local_plan_canceled');
      job.phase = 'WINDOW';
      try {
        await runLocalPlanBrowser({ model, signal: controller.signal, teams, ...(hints ? { hints } : {}), fontFile: new URL('./assets/font-app.ttf', import.meta.url),
          open: url => window.open(url),
          create: async input => {
            if (controller.signal.aborted || version !== this.selectionVersion) throw coded('local_plan_canceled');
            const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
            if (inputFingerprint && inputFingerprint !== fingerprint) throw coded('plan_creation_input_changed');
            inputFingerprint = fingerprint;
            if (!masterKeySource) {
              job.phase = 'ACQUIRING_KEY';
              const key = await operations.acquireKey(controller.signal, () => { job.phase = 'AWAITING_KEY'; });
              if (!key) throw coded('master_key_required');
              masterKeySource = { resolve: async () => key };
            }
            if (controller.signal.aborted || version !== this.selectionVersion) throw coded('local_plan_canceled');
            job.phase = 'CREATING';
            planContext ??= await operations.createContext();
            if (controller.signal.aborted || version !== this.selectionVersion) {
              await operations.abandon(planContext.planId);
              throw coded('local_plan_canceled');
            }
            job.planId = planContext.planId;
            creationFlight = operations.createMany({ context: planContext, ...input, masterKeySource });
            const created = await creationFlight;
            job.status = created.status === 'READY' ? 'CREATED' : 'PENDING';
            return created;
          },
        });
      } catch (error) {
        if (creationFlight) await creationFlight.catch(() => undefined);
        if (job.status === 'WAITING') throw error;
      } finally { model.stop(); }
      if (job.status === 'WAITING') job.status = 'CREATED';
      job.phase = 'COMPLETE';
    })().catch(() => { job.status = windowUnavailable ? 'FAILED' : controller.signal.aborted && !job.planId ? 'CANCELED' : 'FAILED'; job.phase = windowUnavailable ? 'WINDOW_UNAVAILABLE' : job.status; }).finally(() => {
      if (job.status === 'CREATED' || job.status === 'PENDING') window.complete(); else window.close();
    });
    return { jobId: job.id, status: job.status };
  }
  async planCreationStatus(jobId: string, cancel = false) {
    const job = this.planJob;
    if (!job || job.id !== jobId) throw coded('plan_creation_not_found');
    if (cancel && job.status === 'WAITING') { job.controller.abort(); await job.done; }
    return { jobId: job.id, status: job.status, phase: job.phase, ...(job.planId ? { planId: job.planId } : {}) };
  }
  async reveal(planId: string, selector: string, kind: 'FIELD' | 'ASSET' = 'FIELD') {
    return this.startReveal(planId, kind === 'ASSET' ? { kind, asset: selector } : { kind, selectors: [selector], single: true });
  }
  async revealFields(planId: string, selection: { selector?: string | undefined; selectors?: string[] | undefined; assets?: string[] | undefined; all?: boolean | undefined }) {
    const choices = Number(selection.selector !== undefined) + Number(selection.selectors !== undefined || selection.assets !== undefined) + Number(selection.all !== undefined);
    if (choices !== 1 || (selection.all !== undefined && selection.all !== true)) throw coded('asset_selector_invalid');
    if (selection.selector !== undefined) return this.reveal(planId, selection.selector);
    return this.startReveal(planId, { kind: 'FIELD', selectors: selection.selectors, assets: selection.assets, all: selection.all, single: false });
  }
  private async startReveal(planId: string, request: { kind: 'ASSET'; asset: string } | { kind: 'FIELD'; selectors?: string[] | undefined; assets?: string[] | undefined; all?: boolean | undefined; single: boolean }) {
    const kind = request.kind;
    if (request.kind === 'ASSET') {
      if (!/^[^\s.]+$/.test(request.asset)) throw coded('asset_selector_invalid');
    }
    if (request.kind === 'FIELD' && !request.all) {
      if (!request.selectors?.length && !request.assets?.length) throw coded('asset_selector_invalid');
      if (request.selectors !== undefined && (!request.selectors.length || request.selectors.some(selector => !/^[^\s.]+\.[^\s.]+$/.test(selector)))) throw coded('asset_selector_invalid');
      if (request.assets !== undefined && (!request.assets.length || request.assets.some(asset => !/^[^\s.]+$/.test(asset)))) throw coded('asset_selector_invalid');
    }
    const version = this.selectionVersion;
    const selected = await this.selected(); if (!('organizationId' in selected)) return selected;
    if (version !== this.selectionVersion) throw coded('organization_selection_changed');
    if (this.job?.status === 'WAITING') throw coded('reveal_in_progress');
    const controller = new AbortController();
    let windowUnavailable = false;
    const window = createNativeWindowSession(reason => { windowUnavailable = reason === 'unavailable'; controller.abort(); });
    const job: NonNullable<typeof this.job> = { id: crypto.randomUUID(), planId, organizationId: selected.organizationId, phase: 'STARTING', status: 'WAITING', controller, done: Promise.resolve() };
    this.job = job;
    job.done = (async () => {
      const plan = await selected.core.getPlan(planId);
      const knownSelectors = (plan.assets ?? []).filter(asset => !asset.isBinary)
        .flatMap(asset => (asset.fieldNames ?? []).map(field => `${asset.code ?? asset.id}.${field}`));
      const selectors = request.kind === 'FIELD'
        ? Array.from(new Set(request.all ? knownSelectors : request.selectors ?? [])) : [];
      const binaryAssets = (plan.assets ?? []).filter(asset => asset.isBinary);
      const knownAssets = binaryAssets.map(asset => asset.code ?? asset.id);
      const assets = request.kind === 'FIELD' ? Array.from(new Set(request.all ? knownAssets : (request.assets ?? []).map(selector => {
        const asset = binaryAssets.find(asset => asset.id === selector || asset.code === selector);
        return asset?.code ?? asset?.id ?? selector;
      }))) : [];
      if (request.kind === 'FIELD') {
        if (!selectors.length && !assets.length) throw coded('asset_selector_invalid');
        if (plan.assets && selectors.some(selector => !knownSelectors.includes(selector))) throw coded('asset_field_not_found');
        if (plan.assets && assets.some(asset => !knownAssets.includes(asset))) throw coded('asset_not_found');
      }
      const selector = request.kind === 'ASSET' ? request.asset : selectors.concat(assets).join(', ');
      const moderators = (plan.participants ?? [])
        .filter(participant => participant.lifecycle === 'ACTIVE' && participant.relationships.includes('MODERATOR'));
      const moderatorNamesById = new Map(moderators.map(participant => [participant.id, participant.displayName]));
      if (controller.signal.aborted || version !== this.selectionVersion || this.job !== job) throw coded('organization_selection_changed');
      const prompt = await openSafeKeyProPrompt(this.config?.deployment, process.env.INHERITI_SAFEKEY_PRO_DEVICE,
        { organizationId: selected.organizationId, planId, selector, kind: request.kind === 'FIELD' && !request.single ? 'SELECTION' : kind }, controller.signal,
        url => window.open(url));
      let completed = false;
      try { await selected.core.withReveal(planId, {
        mode: revealModeOf(plan), signal: controller.signal,
        selectCustodianDevice: prompt.selectCustodianDevice,
        ...(prompt.proDevice ? { proDevice: prompt.proDevice } : {}),
        onProgress: progress => {
          job.phase = progress.phase;
          const session = progress.session;
          job.progress = session ? {
            revealId: session.id, expiresAt: session.expiresAt,
            ...(session.dmsExpiresAt === undefined ? {} : { dmsExpiresAt: session.dmsExpiresAt }),
            ...(session.governanceExpiresAt === undefined ? {} : { governanceExpiresAt: session.governanceExpiresAt }),
            ...(session.governanceGate === undefined ? {} : { governanceGate: session.governanceGate }),
            ...(session.approvedModerators === undefined ? {} : { approvedModerators: session.approvedModerators }),
            ...(session.requiredModerators === undefined ? {} : { requiredModerators: session.requiredModerators }),
            ...(session.deniedBy === undefined ? {} : { deniedBy: session.deniedBy }),
            ...(session.closedReason === undefined ? {} : { closedReason: session.closedReason }),
          } : {};
          job.message = revealProgressMessage(progress, { moderators: moderators.map(participant => participant.displayName), moderatorNamesById, keyOwner: 'Organisation' });
        },
      }, async reveal => {
        const deliveryTimeout = () => {
          const timeoutMs = Math.min(300_000, Date.parse(reveal.session.expiresAt) - Date.now());
          if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw coded('local_delivery_expired');
          return timeoutMs;
        };
        if (kind === 'ASSET') {
          await reveal.exportAsset(selector, async asset => {
            if (controller.signal.aborted || version !== this.selectionVersion || this.job !== job) throw coded('local_delivery_canceled');
            job.message = 'Confirm the file download in the secure window to finish delivery.';
            await deliverAssetInBrowser(asset.fileName ?? 'asset.bin', asset.bytes, { signal: controller.signal, timeoutMs: deliveryTimeout(), open: url => window.open(url), ...(asset.mimeType ? { mimeType: asset.mimeType } : {}) });
          });
        } else {
          const deliver = async (fields: ReadonlyArray<{ selector: string; value: unknown }>) => {
            const downloaded: Array<{ selector: string; fileName: string; bytes: Uint8Array; mimeType?: string }> = [];
            const exportNext = async (index: number): Promise<void> => {
              if (index < assets.length) {
                const assetSelector = assets[index]!;
                await reveal.exportAsset(assetSelector, async asset => {
                  const download = { selector: assetSelector, fileName: asset.fileName ?? 'asset.bin', bytes: asset.bytes };
                  downloaded.push(asset.mimeType ? { selector: download.selector, fileName: download.fileName, bytes: download.bytes, mimeType: asset.mimeType } : download);
                  await exportNext(index + 1);
                });
                return;
              }
              if (controller.signal.aborted || version !== this.selectionVersion || this.job !== job) throw coded('local_delivery_canceled');
              const timeoutMs = deliveryTimeout();
              job.message = assets.length
                ? 'Confirm the selection and download each file in the secure window to finish delivery.'
                : 'Confirm the selected fields in the secure window to finish delivery.';
              if (assets.length) {
                await deliverSelectionInBrowser(fields, downloaded, { signal: controller.signal, timeoutMs, open: url => window.open(url) });
                return;
              }
              if (request.kind === 'FIELD' && request.single) {
                await deliverInBrowser(selectors[0]!, fields[0]!.value, { signal: controller.signal, timeoutMs, open: url => window.open(url) });
                return;
              }
              await deliverFieldsInBrowser(fields, { signal: controller.signal, timeoutMs, open: url => window.open(url) });
            };
            await exportNext(0);
          };
          if (selectors.length) {
            await reveal.consumeFields(selectors.map(selector => ({ selector, options: { action: 'DELIVER_FIELD', destination: 'LOCAL_BROWSER' } })),
              fields => deliver(fields.map((field, index) => ({ selector: selectors[index]!, value: field.value }))));
          } else {
            await deliver([]);
          }
        }
      }); completed = true; } finally { prompt.close(completed ? 'complete' : controller.signal.aborted ? 'canceled' : 'failed'); }
    })().then(() => { job.status = 'DELIVERED'; job.message = 'Delivered securely.'; }).catch(error => {
      const failureCode = safeErrorCode(error);
      const code = failureCode === 'reveal_cancellation_failed' || failureCode === 'master_key_relay_cancellation_failed'
        ? failureCode : windowUnavailable ? 'local_window_unavailable' : failureCode;
      if (code !== 'request_failed') job.code = code;
      if (code === 'reveal_cancellation_failed' || code === 'master_key_relay_cancellation_failed') {
        job.status = 'FAILED';
        job.message = code === 'master_key_relay_cancellation_failed'
          ? 'Could not confirm cancellation in SafeKey Mobile. The key release request may still be pending; wait for it to expire before trying again.'
          : 'Server cancellation could not be confirmed. Use abort_plan_access to close the interrupted request before retrying.';
        return;
      }
      job.status = !windowUnavailable && (controller.signal.aborted || code === 'local_delivery_canceled') ? 'CANCELED' : 'FAILED';
      if (job.status === 'CANCELED') { job.message = 'Reveal canceled.'; return; }
      if ((error as { message?: unknown } | null)?.message === 'SAFEKEY_NO_SPACE') {
        job.message = 'SafeKey PRO has no free space. Download SafeKey Desktop Tool at https://safekey.be/tools/safekey-desktop/ to free space, then start a new reveal.';
        return;
      }
      if ((error as { message?: unknown } | null)?.message === 'SAFEKEY_DEVICE_INFO_MISSING') { job.message = 'Could not set up SafeKey PRO. Retry the reveal.'; return; }
      if (code === 'reveal_restart_required') {
        job.message = 'This plan has an interrupted open request. Use abort_plan_access or finish it in Inheriti® Business, then start a new reveal.';
        return;
      }
      if (lifecycleMessages[code] && !['DENIED', 'STOPPED_BY_DMS', 'EXPIRED', 'PARTICIPANT_REVOKED', 'RECONCILIATION_REQUIRED'].includes(job.phase)) { job.message = lifecycleMessages[code]; return; }
      if (!['DENIED', 'STOPPED_BY_DMS', 'EXPIRED', 'PARTICIPANT_REVOKED', 'RECONCILIATION_REQUIRED'].includes(job.phase)) job.message = 'Reveal could not continue.';
    }).finally(() => { if (job.status === 'DELIVERED') window.complete(); else window.close(); });
    const expiry = setTimeout(() => controller.abort(), 10 * 60_000);
    void job.done.finally(() => clearTimeout(expiry));
    return { jobId: job.id, status: job.status, phase: job.phase, ...(job.progress ? { progress: job.progress } : {}), ...(job.message === undefined ? {} : { message: job.message }), ...(job.code ? { code: job.code } : {}), ...(job.status === 'WAITING' ? { instruction: pendingJobInstruction } : {}) };
  }
  async revealStatus(jobId: string, cancel = false) {
    const job = this.job;
    if (!job || job.id !== jobId) throw coded('reveal_not_found');
    if (cancel && job.status === 'WAITING') { job.controller.abort(); await job.done; }
    return { jobId: job.id, status: job.status, phase: job.phase, ...(job.progress ? { progress: job.progress } : {}), ...(job.message === undefined ? {} : { message: job.message }), ...(job.code ? { code: job.code } : {}), ...(job.status === 'WAITING' ? { instruction: pendingJobInstruction } : {}), ...(job.status === 'DELIVERED' ? { delivered: true } : {}) };
  }

}

const pendingJobInstruction = 'While WAITING, call check_reveal_status with this jobId every few seconds until status is DELIVERED, FAILED, or CANCELED. Relay each required user action and the final outcome to the user. This server cannot automatically wake the assistant.';

const lifecycleMessages: Record<string, string> = {
  local_window_unavailable: 'The secure window could not open. Check the desktop installation, then start a new reveal.',
  local_delivery_expired: 'The local delivery page expired before confirmation. Start a new reveal and confirm it in the secure window in time.',
  local_delivery_canceled: 'Local delivery canceled.',
  master_key_required: 'The plan key is not available from SafeKey Mobile for this account.',
  master_key_relay_timed_out: 'Nobody released the organisation key in SafeKey Mobile in time.',
  master_key_relay_expired: 'The key release request expired. Start the reveal again.',
  master_key_relay_unavailable: 'No device holds the organisation key for this operator.',
  custodian_share_timed_out: 'Nobody approved the custodian request on SafeKey Mobile in time.',
  custodian_share_unavailable: 'The custodian share is unavailable or does not match this plan and device.',
  reveal_stopped_by_dms: "The dead man's switch subject stopped this reveal. Nothing was released.",
  reveal_authorization_ended: 'This reveal ended before authorization. Nothing was released.',
  reveal_expired: 'This reveal expired. Start it again.',
  reveal_denied: 'A participant denied this reveal. Nothing was released.',
  reveal_participant_revoked: 'A participant on this plan was revoked.',
  reveal_reconciliation_required: 'This plan is being reconciled with its source. Try again shortly.',
  plan_key_unwrap_failed: 'The organisation key could not open this plan.',
  plan_share_decryption_failed: 'A released plan share could not be decrypted.',
  plan_share_reconstruction_failed: 'The released shares could not reconstruct this plan.',
  plan_reconstruction_failed: 'The plan could not be reconstructed from the released shares.',
};
const namedCodes: Record<string, string> = { MasterKeyRequired: 'master_key_required', MasterKeyRelayTimedOut: 'master_key_relay_timed_out', MasterKeyRelayExpired: 'master_key_relay_expired' };
const safeCodes = new Set([
  'organization_required', 'organization_selection_required', 'organization_access_denied', 'organization_preference_invalid',
  'organization_selection_changed', 'plan_not_found', 'operator_reauthentication_required', 'reauthentication_required',
  'operator_token_expired', 'expired_token', 'access_denied', 'invalid_client', 'unauthorized_client',
  'plan_request_rate_limited', 'reveal_restart_required', 'reveal_cancellation_failed', 'master_key_relay_cancellation_failed',
  'asset_selector_invalid', 'asset_not_found', 'asset_field_not_found', 'action_not_allowed', 'reveal_in_progress', 'reveal_not_found',
  'plan_creation_in_progress', 'plan_creation_not_found',
  'plan_creation_input_changed', 'automation_local_only', 'automation_setup_in_progress', 'automation_setup_not_found',
  'automation_setup_authentication_required', 'automation_setup_permission_denied', 'automation_setup_request_failed',
  'automation_verified_release_unavailable', 'automation_active_grant_required', 'automation_verified_github_required',
  'automation_github_workflow_ref_invalid',
]);
function safeErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && (safeCodes.has(code) || Object.hasOwn(lifecycleMessages, code))) return code;
  const name = (error as { name?: unknown } | null)?.name;
  if (typeof name === 'string' && Object.hasOwn(namedCodes, name)) return namedCodes[name]!;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && Object.hasOwn(lifecycleMessages, message) ? message : 'request_failed';
}

export function safeResult<T>(work: (args: T) => Promise<unknown>) {
  return async (args: T) => {
    try { return { content: [{ type: 'text' as const, text: JSON.stringify(await work(args)) }] }; }
    catch (error) {
      const safe = safeErrorCode(error);
      return { isError: true, content: [{ type: 'text' as const, text: safe }] };
    }
  };
}

export function registerRevealTools(server: McpServer, tools: MetadataTools) {
  server.registerTool('reveal_plan_secret', { description: 'Open the secure window to reveal selected plan fields and files. Use selector, selectors and assets, or all: true. ' + pendingJobInstruction, inputSchema: z.object({ planId: z.string().min(1), selector: z.string().min(3).optional(), selectors: z.array(z.string().min(3)).min(1).optional(), assets: z.array(z.string().min(1)).min(1).optional(), all: z.literal(true).optional() }) }, safeResult(({ planId, selector, selectors, assets, all }: { planId: string; selector?: string | undefined; selectors?: string[] | undefined; assets?: string[] | undefined; all?: boolean | undefined }) => tools.revealFields(planId, { selector, selectors, assets, all })));
  server.registerTool('download_plan_asset', { description: 'Open the secure window to download a plan file. ' + pendingJobInstruction, inputSchema: z.object({ planId: z.string().min(1), asset: z.string().min(1) }) }, safeResult(({ planId, asset }: { planId: string; asset: string }) => tools.reveal(planId, asset, 'ASSET')));
  server.registerTool('check_reveal_status', { description: 'Check or cancel a pending local delivery. ' + pendingJobInstruction, inputSchema: z.object({ jobId: z.string().uuid(), cancel: z.boolean().optional() }) }, safeResult(({ jobId, cancel }: { jobId: string; cancel?: boolean | undefined }) => tools.revealStatus(jobId, cancel)));
}

export function createServer() {
  const server = new McpServer({ name: 'inheriti-mcp', version: JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version });
  const tools = new MetadataTools();
  const trustSchema = z.discriminatedUnion('method', [
    z.object({ method: z.literal('GITHUB_ACTIONS_OIDC'), repositoryName: z.string().min(1).describe('GitHub owner/repository, e.g. acme/deploy.'), environment: z.string().min(1).describe('GitHub Actions environment name bound to this identity.'), workflow: z.string().min(1).describe('Full GitHub workflow_ref claim, e.g. acme/deploy/.github/workflows/release.yml@refs/heads/main; find it in the workflow OIDC token claims.') }),
    z.object({ method: z.literal('GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC'), audienceBase: z.string().min(1).describe('Workload identity audience base from the Google Cloud provider configuration; the connection ID is appended automatically.'), serviceAccountSubject: z.string().regex(/^\d+$/).describe('Numeric service account unique ID from Google Cloud service account details, not its email address.') }),
    z.object({ method: z.literal('AWS_IAM_ROLE'), roleArn: z.string().min(1).describe('AWS IAM task role ARN used by the automation; find it in the task definition or IAM role details.') }),
    z.object({ method: z.literal('PORTABLE_SIGNED_ASSERTION'), keyId: z.string().min(1).describe('Identifier of the runner public key.'), publicKey: z.string().min(1).describe('Runner public key in PEM format. Never send its private key.'), runnerSubject: z.string().min(1).describe('Nonsecret identity name asserted by the runner.'), environment: z.string().min(1).describe('Runner environment bound to this identity.') }),
  ]);
  server.registerTool('list_organizations', { description: 'List available organizations and the current selection. May return a browser sign-in URL.', inputSchema: z.object({}) }, safeResult(() => tools.listOrganizations()));
  server.registerTool('check_update', { description: 'Check this MCP server version and whether an update exists in its locked channel. Does not expose a download URL.', inputSchema: z.object({}) }, safeResult(() => tools.checkUpdate()));
  server.registerTool('select_organization', { description: 'Select an organization by ID from list_organizations.', inputSchema: z.object({ id: z.string().min(1) }) }, safeResult(({ id }: { id: string }) => tools.selectOrganization(id)));
  server.registerTool('list_backup_plans', { description: 'List plan metadata in the selected organization. May return a browser sign-in URL.', inputSchema: z.object({ cursor: z.string().optional() }) }, safeResult(({ cursor }: { cursor?: string | undefined }) => tools.listPlans(cursor)));
  server.registerTool('get_backup_plan', { description: 'Get safe metadata for one plan in the selected organization.', inputSchema: z.object({ id: z.string().min(1) }) }, safeResult(({ id }: { id: string }) => tools.getPlan(id)));
  server.registerTool('list_backup_plan_logs', { description: 'List safe plan activity fields and total count in the selected organization.', inputSchema: z.object({ planId: z.string().min(1), limit: z.number().int().min(1).max(100).optional(), offset: z.number().int().nonnegative().safe().optional() }) }, safeResult(({ planId, limit, offset }: { planId: string; limit?: number | undefined; offset?: number | undefined }) => tools.listPlanLogs(planId, limit, offset)));
  server.registerTool('logout', { description: 'Cancel local work, forget held keys, and clear this MCP session.', inputSchema: z.object({}) }, safeResult(() => tools.logout()));
  server.registerTool('abort_plan_access', { description: 'Cancel an interrupted plan access in the selected organization.', inputSchema: z.object({ planId: z.string().min(1), expectedRevealId: z.string().min(1).optional() }) }, safeResult(({ planId, expectedRevealId }: { planId: string; expectedRevealId?: string | undefined }) => tools.abortPlanAccess(planId, expectedRevealId)));
  server.registerTool('create_plan_with_assistant', { description: 'Open the secure window to create a plan with suggestions from the local model. Optional title, description, and assetTypes prefill the single editable plan text; derive them from non-secret user context only. The user can edit that text and enter exact secret values in the window. Review before saving, then check_plan_creation_status.', inputSchema: z.object({
    title: z.string().trim().min(1).max(200).optional(), description: z.string().trim().max(1000).optional(),
    assetTypes: z.array(z.string().refine(type => quickPlanAssetCatalog.some(({ id }) => id === type), 'Unknown asset type')).max(localPlanAssetLimit).describe(`Possible types: ${quickPlanAssetCatalog.map(({ id }) => id).join(', ')}`).optional(),
  }) }, safeResult(({ title, description, assetTypes }: { title?: string | undefined; description?: string | undefined; assetTypes?: string[] | undefined }) => tools.createPlanWithAssistant({
    ...(title !== undefined ? { title } : {}), ...(description !== undefined ? { description } : {}), ...(assetTypes ? { assetTypes } : {}),
  })));
  server.registerTool('check_plan_creation_status', { description: 'Check or cancel local assisted plan creation.', inputSchema: z.object({ jobId: z.string().uuid(), cancel: z.boolean().optional() }) }, safeResult(({ jobId, cancel }: { jobId: string; cancel?: boolean | undefined }) => tools.planCreationStatus(jobId, cancel)));
  server.registerTool('start_automation_setup', { description: 'Open the local secure window for a human to enter identity proof for an existing automation connection. The proof stays in the window; never pass it as a tool argument or in conversation. Then check_automation_setup_status.', inputSchema: z.object({ connectionId: z.string().min(1) }) }, safeResult(({ connectionId }: { connectionId: string }) => tools.startAutomationSetup(connectionId)));
  server.registerTool('check_automation_setup_status', { description: 'Check or cancel local automation setup. Report the status to the human; this server cannot wake the assistant.', inputSchema: z.object({ jobId: z.string().uuid(), cancel: z.boolean().optional() }) }, safeResult(({ jobId, cancel }: { jobId: string; cancel?: boolean | undefined }) => tools.automationSetupStatus(jobId, cancel)));
  server.registerTool('list_automation_connections', { description: 'List safe automation connection metadata in the selected organization, when Business permits. Identity proof is never returned.', inputSchema: z.object({}) }, safeResult(() => tools.listAutomationConnections()));
  server.registerTool('list_automation_grants', { description: 'List safe automation grant metadata for an editable plan in the selected organization, when Business permits.', inputSchema: z.object({ planId: z.string().min(1) }) }, safeResult(({ planId }: { planId: string }) => tools.listAutomationGrants(planId)));
  server.registerTool('github_automation_usage', { description: 'Generate copyable GitHub Actions YAML for an active plan grant and verified GitHub connection using the Business verified Action and CLI release. Ask for asset.field from the plan Data tab when missing; do not guess it or request a secret. The generated command only checks that injection worked.', inputSchema: z.object({ planId: z.string().min(1), connectionId: z.string().min(1), field: z.string().refine(isGithubAutomationSelector, 'Use a valid asset.field selector from the plan Data tab.').describe('Nonsecret asset.field selector from the plan Data tab.') }) }, safeResult(({ planId, connectionId, field }: { planId: string; connectionId: string; field: string }) => tools.githubAutomationUsage(planId, connectionId, field)));
  server.registerTool('list_automation_members', { description: 'List member IDs, display names, and status in the selected organization for choosing a responsible member on an automation grant, when Business permits. No email or credentials are returned.', inputSchema: z.object({}) }, safeResult(() => tools.listAutomationMembers()));
  server.registerTool('create_automation_connection', { description: 'Create a connection from nonsecret provider and runner trust metadata supplied by the human. Ask for the exact provider values described in the trust fields. Do not include private keys or identity proof. After creation, use start_automation_setup with the returned connectionId for human proof.', inputSchema: z.object({ name: z.string().trim().min(1), provider: z.enum(['GITHUB', 'GOOGLE_CLOUD', 'AWS', 'PORTABLE']), environment: z.enum(['TEST', 'LIVE']), trust: trustSchema, managingTeamId: z.string().min(1).optional() }) }, safeResult((input: { name: string; provider: AutomationProvider; environment: 'TEST' | 'LIVE'; trust: AutomationTrustInput; managingTeamId?: string | undefined }) => tools.createAutomationConnection(input)));
  server.registerTool('change_automation_trust', { description: 'Replace nonsecret trust metadata for an automation connection. Ask for the exact provider values described in the trust fields. Never include a private key or identity proof. The human must reverify identity in start_automation_setup.', inputSchema: z.object({ connectionId: z.string().min(1), trust: trustSchema }) }, safeResult(({ connectionId, trust }: { connectionId: string; trust: AutomationTrustInput }) => tools.changeAutomationTrust(connectionId, trust)));
  server.registerTool('disable_automation_connection', { description: 'Disable an automation connection in the selected organization.', inputSchema: z.object({ connectionId: z.string().min(1) }) }, safeResult(({ connectionId }: { connectionId: string }) => tools.disableAutomationConnection(connectionId)));
  server.registerTool('create_automation_grant', { description: 'Create a plan grant using IDs supplied by the human; Business enforces plan editor permission. Activate it separately after review.', inputSchema: z.object({ planId: z.string().min(1), connectionId: z.string().min(1), responsibleMemberId: z.string().min(1) }) }, safeResult(({ planId, connectionId, responsibleMemberId }: { planId: string; connectionId: string; responsibleMemberId: string }) => tools.manageAutomationGrant('create', planId, { connectionId, responsibleMemberId })));
  server.registerTool('activate_automation_grant', { description: 'Activate an existing plan grant after the human confirms the intended connection and responsible member.', inputSchema: z.object({ planId: z.string().min(1), grantId: z.string().min(1) }) }, safeResult(({ planId, grantId }: { planId: string; grantId: string }) => tools.manageAutomationGrant('activate', planId, { grantId })));
  server.registerTool('replace_automation_responsible_member', { description: 'Replace the responsible member for an existing plan grant.', inputSchema: z.object({ planId: z.string().min(1), grantId: z.string().min(1), responsibleMemberId: z.string().min(1) }) }, safeResult(({ planId, grantId, responsibleMemberId }: { planId: string; grantId: string; responsibleMemberId: string }) => tools.manageAutomationGrant('replace', planId, { grantId, responsibleMemberId })));
  server.registerTool('revoke_automation_grant', { description: 'Revoke an existing plan grant.', inputSchema: z.object({ planId: z.string().min(1), grantId: z.string().min(1) }) }, safeResult(({ planId, grantId }: { planId: string; grantId: string }) => tools.manageAutomationGrant('revoke', planId, { grantId })));
  registerRevealTools(server, tools);
  return server;
}

export async function runServer() {
  await createServer().connect(new StdioServerTransport());
}
