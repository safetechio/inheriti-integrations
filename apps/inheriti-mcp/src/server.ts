import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  HOST_FEATURE_FLAGS, INTEGRATION_AUTHORITY, businessDeployment, createNodeIntegrationCore, latestIntegrationBuild, selectBusinessOrganization,
  MemoryOperatorSessionStore, readOrganizationPreferences, saveOrganizationPreferences, createAutomationSetupOperations, createAwsSecretPublisher,
} from '@safetech/inheriti-elements-core/node-base';
import { createGoogleSecretPublisher } from '@safetech/inheriti-elements-core/google-secret-publisher';
import type { LocalPlanHints, AutomationProvider, AutomationTrust } from '@safetech/inheriti-elements-core/node-base';
import type { NodeIntegrationCore, NodeIntegrationCoreOptions } from '@safetech/inheriti-elements-core/node-base';
import { beginBrowserLogin } from './browser-login.js';
import { planDetail, planSummary } from './metadata.js';
import { registerTools } from './tools/index.js';
import { coded, lifecycleMessages, safeErrorCode } from './runtime/errors.js';
import { configPath, configuration, lockedDeployment } from './runtime/configuration.js';
import { authFetch } from './runtime/auth-fetch.js';
import type { Configuration } from './runtime/configuration.js';
import {
  listAutomationConnections, listAutomationGrants, githubAutomationUsage, getAutomationRuntimeInstallInstructions, listAutomationMembers,
  createAutomationConnection, changeAutomationTrust, disableAutomationConnection, manageAutomationGrant,
  startAutomationSetup, startAutomationPairing, automationSetupStatus,
} from './runtime/automation.js';
import { pairAwsAutomationService, prepareAutomationEc2 } from './runtime/aws-setup.js';
import { pairGoogleAutomationService } from './runtime/google-pair.js';
import { createPlanWithAssistant, planCreationStatus } from './runtime/plan-assistant.js';
import { applyAutomationRuntime, prepareAutomationRuntime } from './runtime/runtime-setup.js';
import type { CloudTarget } from '@safetech/inheriti-elements-core/node-base';
import { reveal, revealFields, startReveal, revealStatus } from './runtime/reveal.js';
import { registerRevealPlanSecret } from './tools/reveal_plan_secret.js';
import { registerDownloadPlanAsset } from './tools/download_plan_asset.js';
import { registerCheckRevealStatus } from './tools/check_reveal_status.js';

export type AutomationTrustInput = Exclude<AutomationTrust, { method: 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC' }> |
  { method: 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC'; audienceBase: string; serviceAccountSubject: string };
export { lockedDeployment } from './runtime/configuration.js';
const runningVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;

export class MetadataTools {
  private core: NodeIntegrationCore | undefined;
  private authGeneration = 0;
  config: Configuration | undefined;
  private authConfiguration: NodeIntegrationCoreOptions['configuration'] | undefined;
  private initializing: Promise<NodeIntegrationCore> | undefined;
  private authorizing: ReturnType<MetadataTools['authorize']> | undefined;
  private browserLogin: { cancel: () => void } | undefined;
  private scoped: { identity: string; organizationId: string; core: NodeIntegrationCore } | undefined;
  private selecting: ReturnType<MetadataTools['selectCore']> | undefined;
  private sessions = new MemoryOperatorSessionStore();
  job?: { id: string; planId: string; organizationId: string; phase: string; progress?: { revealId?: string; expiresAt?: string; dmsExpiresAt?: string; governanceExpiresAt?: string; governanceGate?: string; approvedModerators?: number; requiredModerators?: number; deniedBy?: string; closedReason?: string }; message?: string; code?: string; status: 'WAITING' | 'DELIVERED' | 'FAILED' | 'CANCELED'; controller: AbortController; done: Promise<void> };
  planJob?: { id: string; status: 'WAITING' | 'CREATED' | 'PENDING' | 'FAILED' | 'CANCELED'; phase: string; planId?: string; controller: AbortController; done: Promise<void> };
  automationJob?: { id: string; status: 'WAITING' | 'COMPLETE' | 'FAILED' | 'CANCELED'; phase: string; controller: AbortController; done: Promise<void> };
  selectionVersion = 0;
  private login: { authorizationUrl: string } | undefined;
  private loginFailure: string | undefined;
  private silentAttempted = false;
  private updateCheck: { at: number; result: Promise<ReturnType<typeof latestIntegrationBuild>> } | undefined;

  async updateAccess(onChallenge: (url: string) => void): Promise<NodeIntegrationCore> {
    const initial = await this.ready(false);
    if ('core' in initial) return initial.core;
    onChallenge(initial.login.authorizationUrl);
    const core = await this.client();
    for (let attempt = 0; attempt < 120; attempt++) {
      if (await core.getAccessToken()) {
        const authorized = await this.authorized();
        if (!('login' in authorized)) return authorized;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw coded('authorization_timed_out');
  }

  async checkUpdate() {
    const version = runningVersion;
    if (!lockedDeployment) return { version, updateAvailable: false, reason: 'Updates require a channel-locked build.' };
    const ready = await this.ready(false); if ('login' in ready) return ready;
    const build = await this.latestUpdate(ready.core);
    return { version, updateAvailable: Boolean(build), latestVersion: build?.version,
      instruction: build ? 'Update required: run inheriti-mcp update --install in a terminal, then restart this MCP server.' : undefined };
  }

  private async latestUpdate(core: NodeIntegrationCore) {
    const now = Date.now();
    if (this.updateCheck && now - this.updateCheck.at < 5 * 60_000) return this.updateCheck.result;
    const version = runningVersion;
    const result = core.listInternalBuilds()
      .then(builds => latestIntegrationBuild(builds, 'mcp', version, `${process.platform}-${process.arch}`))
      .catch(error => {
        if (this.updateCheck?.result === result) this.updateCheck = undefined;
        const failure = error as { status?: unknown; code?: unknown } | null;
        if (failure?.status === 401) throw coded('operator_reauthentication_required');
        if (failure?.status === 403 || ['operator_reauthentication_required', 'operator_not_signed_in', 'reauthentication_required'].includes(String(failure?.code))) throw error;
        throw coded('update_check_unavailable');
      });
    this.updateCheck = { at: now, result };
    return result;
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
        apiUrl: this.config.apiUrl, business: true, businessAuthority: INTEGRATION_AUTHORITY, environment: this.config.environment,
        liveConfirmation: this.config.environment,
        configuration: this.authConfiguration,
        authFetchImpl: authFetch,
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
      try { await core.listOrganizations(); this.assertGeneration(generation); }
      catch (error) {
        this.assertGeneration(generation);
        if ((error as { status?: unknown; code?: unknown })?.status === 403
          && (error as { code?: unknown }).code === 'integration_tester_required') {
          await this.logout();
          throw coded('integration_tester_required');
        }
        throw error;
      }
      this.browserLogin?.cancel();
      this.browserLogin = undefined;
      this.login = undefined;
      this.loginFailure = undefined;
      this.silentAttempted = false;
      return core;
    }
    await this.stopLocalAccess();
    this.assertGeneration(generation);
    if (this.loginFailure) {
      const code = this.loginFailure;
      this.loginFailure = undefined;
      throw coded(code);
    }
    if (!this.silentAttempted && !process.env.INHERITI_ELEMENTS_NO_BROWSER) {
      this.silentAttempted = true;
      let silentToken: string | undefined;
      try {
        const silent = await beginBrowserLogin(core.auth, this.authConfiguration!, undefined, { prompt: 'none', timeoutMs: 30_000 });
        try { this.assertGeneration(generation); }
        catch (error) { silent.cancel(); throw error; }
        this.browserLogin = silent;
        try { await silent.completed; }
        finally { if (this.browserLogin === silent) this.browserLogin = undefined; }
        this.assertGeneration(generation);
        silentToken = await core.getAccessToken();
      } catch (error) {
        this.assertGeneration(generation);
      }
      if (silentToken) {
        try { await core.listOrganizations(); this.assertGeneration(generation); }
        catch (error) {
          this.assertGeneration(generation);
          if ((error as { status?: unknown; code?: unknown })?.status === 403
            && (error as { code?: unknown }).code === 'integration_tester_required') {
            await this.logout();
            throw coded('integration_tester_required');
          }
          throw error;
        }
        return core;
      }
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

  private async ready(requireCurrent = true) {
    const generation = this.authGeneration;
    const result = await this.authorized();
    if ('login' in result) return { login: result.login };
    // shortcut: older installed clients cannot be blocked here, add server enforcement after OAuth clients are separated.
    if (requireCurrent && lockedDeployment) {
      const build = await this.latestUpdate(result);
      this.assertGeneration(generation);
      if (build) throw Object.assign(coded('integration_update_required'), {
        version: runningVersion,
        latestVersion: build.version,
      });
    }
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
    const ready = await this.ready(false); if ('login' in ready) return ready;
    const items = await ready.core.listOrganizations();
    const scopedOrganizationId = this.scoped?.organizationId;
    if (scopedOrganizationId && !items.some(item => item.id === scopedOrganizationId)) await this.stopLocalAccess();
    const preferences = await this.preferences(); const selected = preferences[await this.key()];
    if (selected && !items.some(item => item.id === selected)) {
      await this.stopLocalAccess();
      delete preferences[await this.key()]; await this.save(preferences);
    }
    let update: { required: true; version: string; latestVersion: string; instruction: string } | { checkFailed: true } | undefined;
    if (lockedDeployment) {
      try {
        const build = await this.latestUpdate(ready.core);
        if (build) update = { required: true,
          version: runningVersion,
          latestVersion: build.version,
          instruction: 'Run inheriti-mcp update --install in a terminal, then restart this MCP server.' };
      } catch (error) {
        const failure = error as { status?: unknown; code?: unknown } | null;
        if (failure?.status === 401 || failure?.status === 403 ||
            ['operator_reauthentication_required', 'operator_not_signed_in', 'reauthentication_required'].includes(String(failure?.code))) throw error;
        update = { checkFailed: true };
      }
    }
    return { items: items.map(({ id, name }) => ({ id, name })), selectedId: preferences[await this.key()] ?? (items.length === 1 ? items[0]!.id : null),
      ...(update ? { update } : {}) };
  }
  async selectOrganization(id: string) {
    const access = await this.ready(); if ('login' in access) return access;
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
  selected(skipUpdate = false) {
    if (skipUpdate) return this.selectCore(true);
    if (!this.selecting) {
      const pending = this.selectCore(false).finally(() => { if (this.selecting === pending) this.selecting = undefined; });
      this.selecting = pending;
    }
    return this.selecting;
  }
  private async selectCore(skipUpdate: boolean) {
    const version = this.selectionVersion;
    const generation = this.authGeneration;
    const ready = await this.ready(!skipUpdate);
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
        apiUrl: this.config!.apiUrl, business: true, businessAuthority: INTEGRATION_AUTHORITY, organizationId: id, environment: this.config!.environment,
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
    const retiredCore = this.core;
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
    this.silentAttempted = false;
    this.updateCheck = undefined;
    const job = this.job;
    if (job?.status === 'WAITING') { job.controller.abort(); await job.done; }
    try {
      if (retiredScoped) await retiredScoped.core.forgetMasterKey();
    } finally {
      try { await retiredCore?.auth.clear(); }
      catch { /* Revocation is best effort. */ }
      finally { await retired.clear(); }
    }
    return { signedOut: true, ...(job?.code === 'reveal_cancellation_failed' || job?.code === 'master_key_relay_cancellation_failed'
      ? { cancellation: { code: job.code, message: job.message } } : {}) };
  }
  async abortPlanAccess(planId: string, expectedRevealId?: string) {
    const selected = await this.selected(true);
    if (!('organizationId' in selected)) return selected;
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
  async listMemberLogs(memberId: string, input: { source?: 'MEMBER' | 'AUTOMATION'; from?: string; to?: string; limit?: number; offset?: number }) {
    const selected = await this.selected(); if (!('organizationId' in selected)) return selected;
    return { organizationId: selected.organizationId, ...await selected.core.listMemberLogs(memberId, input) };
  }
  private async cancelPlanJob() {
    const job = this.planJob;
    if (job?.status === 'WAITING') { job.controller.abort(); await job.done; }
  }
  private async cancelAutomationJob() {
    const job = this.automationJob;
    if (job?.status === 'WAITING') { job.controller.abort(); await job.done; }
  }
  localAutomation() {
    const deployment = businessDeployment(this.config?.deployment);
    if (!deployment || !HOST_FEATURE_FLAGS[deployment].automation) throw coded('automation_local_only');
  }
  async automationOperations() {
    const selected = await this.selected(); if (!('organizationId' in selected)) return selected;
    this.localAutomation();
    return { organizationId: selected.organizationId, operations: createAutomationSetupOperations({ apiUrl: this.config!.apiUrl,
      organizationId: selected.organizationId, getBearerToken: () => selected.core.getAccessToken() }) };
  }
  async listAutomationConnections() { return listAutomationConnections.call(this); }
  async getAutomationRuntimeInstallInstructions() { return getAutomationRuntimeInstallInstructions.call(this); }
  async listAutomationGrants(planId: string) { return listAutomationGrants.call(this, planId); }
  async githubAutomationUsage(planId: string, connectionId: string, selector: string) {
    return githubAutomationUsage.call(this, planId, connectionId, selector);
  }
  async listAutomationMembers() { return listAutomationMembers.call(this); }
  async createAutomationConnection(input: { name: string; provider: AutomationProvider; environment: 'TEST' | 'LIVE'; trust: AutomationTrustInput; managingTeamId?: string | undefined }) {
    return createAutomationConnection.call(this, input);
  }
  async changeAutomationTrust(connectionId: string, trust: AutomationTrustInput) { return changeAutomationTrust.call(this, connectionId, trust); }
  async disableAutomationConnection(connectionId: string) { return disableAutomationConnection.call(this, connectionId); }
  async manageAutomationGrant(action: 'create' | 'activate' | 'replace' | 'revoke', planId: string, input: { grantId?: string; connectionId?: string; responsibleMemberId?: string }) {
    return manageAutomationGrant.call(this, action, planId, input);
  }
  async startAutomationSetup(connectionId: string) { return startAutomationSetup.call(this, connectionId); }
  async startAutomationPairing(connectionId: string) { return startAutomationPairing.call(this, connectionId); }
  async pairAwsAutomationService(input: { connectionId: string; region: string; cluster: string; service: string;
    container?: string; image: string; cliPath: string; expectedRevision: string }) {
    return pairAwsAutomationService.call(this, input);
  }
  async pairGoogleAutomationService(input: {
    connectionId: string; project: string; region: string; service: string; expectedRevision: string;
  }) {
    return pairGoogleAutomationService.call(this, input);
  }
  async prepareAutomationEc2(input: { planId: string; connectionId: string; region: string; instanceId: string;
    serviceName: string; runAsUser: string; launcherPath: string; applicationCommand: string[];
    mappings?: ReadonlyArray<{ selector: string; envName: string }>;
    mapAll?: boolean; onlyFields?: readonly string[]; exceptFields?: readonly string[] }) {
    return prepareAutomationEc2.call(this, input);
  }
  async automationSetupStatus(jobId: string, cancel = false) { return automationSetupStatus.call(this, jobId, cancel); }
  async prepareAutomationRuntime(input: { planId: string; connectionId: string; field?: string; environmentVariable?: string;
    mappings?: ReadonlyArray<{ selector: string; envName: string }>;
    mapAll?: boolean; onlyFields?: readonly string[]; exceptFields?: readonly string[];
    target?: CloudTarget; launcherPath?: string }) { return prepareAutomationRuntime.call(this, input); }
  async applyAutomationRuntime(input: { planId: string; connectionId: string; field?: string; environmentVariable?: string;
    mappings?: ReadonlyArray<{ selector: string; envName: string }>;
    target: CloudTarget; image: string; cliPath: string; expectedRevision: string }) {
    return applyAutomationRuntime.call(this, input);
  }
  async createPlanWithAssistant(hints?: LocalPlanHints) {
    const deployment = businessDeployment(this.config?.deployment);
    if (!deployment || !HOST_FEATURE_FLAGS[deployment].planCreation) throw coded('plan_creation_unavailable');
    return createPlanWithAssistant.call(this, hints);
  }
  async planCreationStatus(jobId: string, cancel = false) {
    const deployment = businessDeployment(this.config?.deployment);
    if (!deployment || !HOST_FEATURE_FLAGS[deployment].planCreation) throw coded('plan_creation_unavailable');
    return planCreationStatus.call(this, jobId, cancel);
  }
  async reveal(planId: string, selector: string, kind: 'FIELD' | 'ASSET' = 'FIELD', options?: { openLimit?: number }) { return reveal.call(this, planId, selector, kind, options); }
  async revealFields(planId: string, selection: { selector?: string | undefined; selectors?: string[] | undefined; assets?: string[] | undefined; all?: boolean | undefined }) {
    return revealFields.call(this, planId, selection);
  }
  async startReveal(planId: string, request: { kind: 'ASSET'; asset: string; openLimit?: number } | { kind: 'FIELD'; selectors?: string[] | undefined; assets?: string[] | undefined; all?: boolean | undefined; single: boolean; publication?: { provider: 'AWS'; region: string; expectedAccountId: string; mappings: ReadonlyArray<{ selector: string; key: string }>; secretName?: string; parameterPrefix?: string } | { provider: 'GOOGLE_CLOUD'; projectId: string; secretPrefix: string; mappings: ReadonlyArray<{ selector: string; key: string }> } }) {
    return startReveal.call(this, planId, request);
  }
  async revealStatus(jobId: string, cancel = false) { return revealStatus.call(this, jobId, cancel); }
  async publishPlanFieldsToAws(input: { planId: string; region: string; expectedAccountId: string;
    mappings: Array<{ selector: string; key: string }>; secretName?: string | undefined; parameterPrefix?: string | undefined; apply: boolean }) {
    const { planId, region, expectedAccountId, mappings, secretName, parameterPrefix, apply } = input;
    if (!!secretName === !!parameterPrefix || !mappings.length ||
      mappings.some(({ selector, key }) => !/^[^\s.]+\.[^\s.]+$/.test(selector) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) ||
      new Set(mappings.map(item => item.selector)).size !== mappings.length ||
      new Set(mappings.map(item => item.key)).size !== mappings.length)
      throw coded('automation_aws_publisher_input_invalid');
    const selected = await this.selected();
    if (!('organizationId' in selected)) return selected;
    const plan = await selected.core.getPlan(planId);
    const known = (plan.assets ?? []).filter(asset => !asset.isBinary).flatMap(asset =>
      (asset.fieldNames ?? []).map(field => `${asset.code ?? asset.id}.${field}`));
    if (mappings.some(item => !known.includes(item.selector))) throw coded('asset_field_not_found');
    const publisher = createAwsSecretPublisher({ region, expectedAccountId });
    const targets = secretName ? [secretName] : mappings.map(item => `${parameterPrefix}/${item.key}`);
    const inspection = secretName ? [await publisher.inspectSecret(secretName)] :
      await Promise.all(targets.map(target => publisher.inspectParameter(target)));
    if (!apply) return { planId, region, expectedAccountId, destination: secretName ? 'AWS_SECRETS_MANAGER' : 'AWS_PARAMETER_STORE',
      mappings: mappings.map((item, index) => ({ selector: item.selector, key: item.key, target: secretName ?? targets[index] })),
      inspection, requiresApproval: true };
    return this.startReveal(planId, { kind: 'FIELD', selectors: mappings.map(item => item.selector), single: false,
      publication: { provider: 'AWS', region, expectedAccountId, mappings, ...(secretName ? { secretName } : { parameterPrefix: parameterPrefix! }) } });
  }

  async publishPlanFieldsToGoogleCloud(input: { planId: string; projectId: string; secretPrefix: string;
    mappings: Array<{ selector: string; key: string }>; apply: boolean }) {
    const { planId, projectId, secretPrefix, mappings, apply } = input;
    if (!mappings.length || mappings.some(({ selector, key }) =>
      !/^[^\s.]+\.[^\s.]+$/.test(selector) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) ||
      new Set(mappings.map(item => item.selector)).size !== mappings.length ||
      new Set(mappings.map(item => item.key)).size !== mappings.length)
      throw coded('google_secret_input_invalid');
    const selected = await this.selected();
    if (!('organizationId' in selected)) return selected;
    const plan = await selected.core.getPlan(planId);
    const known = (plan.assets ?? []).filter(asset => !asset.isBinary).flatMap(asset =>
      (asset.fieldNames ?? []).map(field => `${asset.code ?? asset.id}.${field}`));
    if (mappings.some(item => !known.includes(item.selector))) throw coded('asset_field_not_found');
    const publisher = createGoogleSecretPublisher({ projectId });
    const inspection = await Promise.all(mappings.map(item => publisher.inspectSecret(`${secretPrefix}${item.key}`)));
    if (!apply) return { planId, projectId, destination: 'GOOGLE_CLOUD_SECRET_MANAGER',
      mappings: mappings.map((item, index) => ({ selector: item.selector, key: item.key, target: inspection[index]?.target })),
      inspection, requiresApproval: true };
    return this.startReveal(planId, { kind: 'FIELD', selectors: mappings.map(item => item.selector), single: false,
      publication: { provider: 'GOOGLE_CLOUD', projectId, secretPrefix, mappings } });
  }

}

export function safeResult<T>(work: (args: T) => Promise<unknown>) {
  return async (args: T) => {
    try { return { content: [{ type: 'text' as const, text: JSON.stringify(await work(args)) }] }; }
    catch (error) {
      const safe = safeErrorCode(error);
      if (safe === 'integration_update_required') {
        const update = error as { version: string; latestVersion: string };
        const valid = (value: unknown) => typeof value === 'string' && /^\d+\.\d+\.\d+(?:-(?:local|dev|stg)\.\d+)?$/u.test(value);
        if (!valid(update.version) || !valid(update.latestVersion)) return { isError: true, content: [{ type: 'text' as const, text: safe }] };
        const message = `Inheriti MCP ${update.version} must update to ${update.latestVersion}. Run inheriti-mcp update --install in a terminal, then restart this MCP server.`;
        return { isError: true, structuredContent: { code: safe, version: update.version, latestVersion: update.latestVersion, message },
          content: [{ type: 'text' as const, text: message }] };
      }
      if (safe === 'update_check_unavailable') return { isError: true,
        structuredContent: { code: safe, message: 'Could not check for a required MCP update. Check your connection and retry.' },
        content: [{ type: 'text' as const, text: 'Could not check for a required MCP update. Check your connection and retry.' }] };
      if (safe === 'integration_tester_required') return { isError: true, content: [{ type: 'text' as const, text: lifecycleMessages[safe]! }] };
      if (safe === 'plan_governance_reconfiguration_required') return {
        isError: true,
        structuredContent: { code: safe, message: lifecycleMessages[safe] },
        content: [{ type: 'text' as const, text: `${safe}: ${lifecycleMessages[safe]}` }],
      };
      return { isError: true, content: [{ type: 'text' as const, text: safe }] };
    }
  };
}

export function registerRevealTools(server: McpServer, tools: MetadataTools) {
  registerRevealPlanSecret(server, tools);
  registerDownloadPlanAsset(server, tools);
  registerCheckRevealStatus(server, tools);
}

export function createServer() {
  const server = new McpServer({ name: 'inheriti-mcp', version: runningVersion });
  const tools = new MetadataTools();
  registerTools(server, tools);
  return server;
}

export async function runServer() {
  await createServer().connect(new StdioServerTransport());
}
