import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BUSINESS_DEPLOYMENTS, BUSINESS_DEVICE_CLIENT_ID, businessDeployment, createNativeWindowSession, createNodeIntegrationCore, latestIntegrationBuild, selectBusinessOrganization, MemoryOperatorSessionStore, readOrganizationPreferences, saveOrganizationPreferences, createQuickPlanOperations, quickPlanAssetCatalog, localPlanAssetLimit, runLocalPlanBrowser, LlamaPlanModel } from '@safetech/inheriti-elements-core/node-base';
import type { LocalPlanHints } from '@safetech/inheriti-elements-core/node-base';
import type { NodeIntegrationCore } from '@safetech/inheriti-elements-core/node-base';
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
declare const __INHERITI_PRODUCTION_BUILD__: boolean;
declare const __INHERITI_DEPLOYMENT__: string;
const developmentBuild = typeof __INHERITI_PRODUCTION_BUILD__ !== 'boolean' || !__INHERITI_PRODUCTION_BUILD__;
export const lockedDeployment = typeof __INHERITI_DEPLOYMENT__ === 'string'
  ? businessDeployment(__INHERITI_DEPLOYMENT__) : undefined;

type Configuration = { apiUrl: string; issuer: string; clientId: string; environment: 'TEST' | 'LIVE'; redirectUri: string; deployment?: string };
async function configuration(): Promise<Configuration> {
  if (lockedDeployment) {
    return { ...BUSINESS_DEPLOYMENTS[lockedDeployment], deployment: lockedDeployment, clientId: BUSINESS_DEVICE_CLIENT_ID,
      redirectUri: 'http://127.0.0.1:53682/oauth/callback' };
  }
  const raw: unknown = JSON.parse(await readFile(configPath(), 'utf8'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw coded('configuration_invalid');
  const value = raw as Record<string, unknown>;
  if (value.deployment !== undefined) {
    const deployment = businessDeployment(value.deployment);
    if (!deployment || value.business !== true) throw coded('configuration_invalid');
    if (deployment === 'prod' && developmentBuild) throw coded('live_environment_unavailable_in_development_build');
    return { ...BUSINESS_DEPLOYMENTS[deployment], deployment, clientId: BUSINESS_DEVICE_CLIENT_ID,
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
  private initializing: Promise<NodeIntegrationCore> | undefined;
  private authorizing: ReturnType<MetadataTools['authorize']> | undefined;
  private polling?: AbortController;
  private scoped: { identity: string; organizationId: string; core: NodeIntegrationCore } | undefined;
  private selecting: ReturnType<MetadataTools['selectCore']> | undefined;
  private sessions = new MemoryOperatorSessionStore();
  private job?: { id: string; planId: string; organizationId: string; phase: string; progress?: { revealId?: string; expiresAt?: string; dmsExpiresAt?: string; governanceExpiresAt?: string; governanceGate?: string; approvedModerators?: number; requiredModerators?: number; deniedBy?: string; closedReason?: string }; message?: string; code?: string; status: 'WAITING' | 'DELIVERED' | 'FAILED' | 'CANCELED'; controller: AbortController; done: Promise<void> };
  private planJob?: { id: string; status: 'WAITING' | 'CREATED' | 'PENDING' | 'FAILED' | 'CANCELED'; phase: string; planId?: string; controller: AbortController; done: Promise<void> };
  private selectionVersion = 0;
  private login: { verificationUri: string; userCode: string; verificationUriComplete?: string } | undefined;
  private loginFailure: string | undefined;

  async updateAccess(onChallenge: (uri: string, code: string) => void): Promise<NodeIntegrationCore> {
    const initial = await this.ready();
    if ('core' in initial) return initial.core;
    onChallenge(initial.login.verificationUri, initial.login.userCode);
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
      this.core = createNodeIntegrationCore({
        apiUrl: this.config.apiUrl, business: true, environment: this.config.environment,
        liveConfirmation: this.config.environment,
        configuration: { issuer: this.config.issuer, clientId: this.config.clientId, audience: 'inheriti-integrations-api', environment: this.config.environment, redirectUri: this.config.redirectUri, scopes: ['openid'] },
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

  private async authorize(): Promise<NodeIntegrationCore | { login: { verificationUri: string; userCode: string; verificationUriComplete?: string } }> {
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
    if (accessToken) { this.login = undefined; this.loginFailure = undefined; return core; }
    await this.stopLocalAccess();
    this.assertGeneration(generation);
    if (this.loginFailure) {
      const code = this.loginFailure;
      this.loginFailure = undefined;
      throw coded(code);
    }
    if (!this.login) {
      const challenge = await core.auth.beginDeviceAuthorization() as { verificationUri: string; userCode: string; verificationUriComplete?: string };
      this.assertGeneration(generation);
      this.login = { verificationUri: challenge.verificationUri, userCode: challenge.userCode, ...(challenge.verificationUriComplete ? { verificationUriComplete: challenge.verificationUriComplete } : {}) };
      const challengeShown = this.login;
      this.polling = new AbortController();
      void core.auth.pollDeviceAuthorization(this.polling.signal).then(
        () => { if (this.login === challengeShown) this.login = undefined; },
        error => {
          if (this.login !== challengeShown) return;
          this.loginFailure = safeErrorCode(error);
          this.login = undefined;
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
    if (!this.scoped && this.job?.status !== 'WAITING' && this.planJob?.status !== 'WAITING') return;
    this.selectionVersion++;
    await this.cancelPlanJob();
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
      if (this.scoped && (this.job?.status === 'WAITING' || this.planJob?.status === 'WAITING')) {
        this.selectionVersion++;
        await this.cancelPlanJob();
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
    this.polling?.abort();
    const retired = this.sessions;
    const retiredScoped = this.scoped;
    this.scoped = undefined;
    this.sessions = new MemoryOperatorSessionStore();
    this.core = undefined;
    this.config = undefined;
    this.initializing = undefined;
    this.authorizing = undefined;
    this.selecting = undefined;
    this.login = undefined;
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
  'plan_creation_input_changed',
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
  server.registerTool('list_organizations', { description: 'List available organizations and the current selection. May return a sign-in code.', inputSchema: z.object({}) }, safeResult(() => tools.listOrganizations()));
  server.registerTool('check_update', { description: 'Check this MCP server version and whether an update exists in its locked channel. Does not expose a download URL.', inputSchema: z.object({}) }, safeResult(() => tools.checkUpdate()));
  server.registerTool('select_organization', { description: 'Select an organization by ID from list_organizations.', inputSchema: z.object({ id: z.string().min(1) }) }, safeResult(({ id }: { id: string }) => tools.selectOrganization(id)));
  server.registerTool('list_backup_plans', { description: 'List plan metadata in the selected organization. May return a sign-in code.', inputSchema: z.object({ cursor: z.string().optional() }) }, safeResult(({ cursor }: { cursor?: string | undefined }) => tools.listPlans(cursor)));
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
  registerRevealTools(server, tools);
  return server;
}

export async function runServer() {
  await createServer().connect(new StdioServerTransport());
}
