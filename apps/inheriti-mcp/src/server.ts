import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BUSINESS_DEPLOYMENTS, BUSINESS_DEVICE_CLIENT_ID, businessDeployment, createNodeIntegrationCore, latestIntegrationBuild, selectBusinessOrganization } from '@safetech/inheriti-elements-core/node';
import type { NodeIntegrationCore, OperatorSession, OperatorSessionStore } from '@safetech/inheriti-elements-core/node';
import { planDetail, planSummary } from './metadata.js';
import { revealModeOf, revealProgressMessage } from '@safetech/inheriti-elements-core/node';
import { deliverAssetInBrowser, deliverInBrowser } from './local-browser.js';
import { openSafeKeyProPrompt } from './safekey-pro.js';

const configPath = () => resolve(process.env.XDG_CONFIG_HOME ?? resolve(homedir(), '.config'), 'inheriti-elements', 'config.json');
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
  return { apiUrl: value.apiUrl, issuer: value.issuer, clientId: value.clientId, environment: value.environment as 'TEST' | 'LIVE', redirectUri: typeof value.redirectUri === 'string' ? value.redirectUri : 'http://127.0.0.1:53682/oauth/callback' };
}

class SessionStore implements OperatorSessionStore {
  session: OperatorSession | undefined;
  async load() { return this.session; }
  async save(value: OperatorSession) { this.session = value; }
  async clear() { this.session = undefined; }
}

export class MetadataTools {
  private core?: NodeIntegrationCore;
  private config?: Configuration;
  private sessions = new SessionStore();
  private job?: { id: string; organizationId: string; phase: string; message?: string; code?: 'reveal_restart_required'; status: 'WAITING' | 'DELIVERED' | 'FAILED' | 'CANCELED'; controller: AbortController; done: Promise<void> };
  private selectionVersion = 0;
  private login: { verificationUri: string; userCode: string; verificationUriComplete?: string } | undefined;

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

  private async client(): Promise<NodeIntegrationCore> {
    if (!this.core) {
      this.config = await configuration();
      this.core = createNodeIntegrationCore({
        apiUrl: this.config.apiUrl, business: true, environment: this.config.environment,
        liveConfirmation: this.config.environment,
        configuration: { issuer: this.config.issuer, clientId: this.config.clientId, audience: 'inheriti-integrations-api', environment: this.config.environment, redirectUri: this.config.redirectUri, scopes: ['openid'] },
        sessions: this.sessions,
      });
    }
    return this.core;
  }

  private async authorized(): Promise<NodeIntegrationCore | { login: { verificationUri: string; userCode: string; verificationUriComplete?: string } }> {
    const core = await this.client();
    if (await core.getAccessToken()) { this.login = undefined; return core; }
    if (!this.login) {
      const challenge = await core.auth.beginDeviceAuthorization() as { verificationUri: string; userCode: string; verificationUriComplete?: string };
      this.login = { verificationUri: challenge.verificationUri, userCode: challenge.userCode, ...(challenge.verificationUriComplete ? { verificationUriComplete: challenge.verificationUriComplete } : {}) };
      const challengeShown = this.login;
      void core.auth.pollDeviceAuthorization().finally(() => { if (this.login === challengeShown) this.login = undefined; }).catch(() => undefined);
    }
    return { login: this.login };
  }

  private async ready() {
    const result = await this.authorized();
    if ('login' in result) return { login: result.login };
    return { core: result };
  }

  private preferencePath() { return resolve(dirname(configPath()), 'mcp-organizations.json'); }
  private key() { return JSON.stringify([this.config!.issuer, this.config!.environment, this.sessions.session!.principal.subject]); }
  private async preferences(): Promise<Record<string, string>> {
    try {
      const raw: unknown = JSON.parse(await readFile(this.preferencePath(), 'utf8'));
      if (raw && typeof raw === 'object' && !Array.isArray(raw) && Object.values(raw).every(v => typeof v === 'string')) return raw as Record<string, string>;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; }
    throw coded('organization_preference_invalid');
  }
  private async save(value: Record<string, string>) {
    const path = this.preferencePath();
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await rename(temporary, path);
  }
  async listOrganizations() {
    const ready = await this.ready(); if ('login' in ready) return ready;
    const items = await ready.core.listOrganizations();
    const preferences = await this.preferences(); const selected = preferences[this.key()];
    if (selected && !items.some(item => item.id === selected)) { delete preferences[this.key()]; await this.save(preferences); }
    return { items: items.map(({ id, name }) => ({ id, name })), selectedId: preferences[this.key()] ?? (items.length === 1 ? items[0]!.id : null) };
  }
  async selectOrganization(id: string) {
    this.selectionVersion++;
    const active = this.job;
    if (active?.status === 'WAITING') active.controller.abort();
    const ready = await this.ready(); if ('login' in ready) return ready;
    const items = await ready.core.listOrganizations();
    const selectedId = selectBusinessOrganization(items, id);
    if (active?.status === 'WAITING') await active.done;
    const preferences = await this.preferences(); preferences[this.key()] = selectedId; await this.save(preferences);
    return { selectedId };
  }
  private async selected() {
    const ready = await this.ready(); if ('login' in ready) return ready;
    const items = await ready.core.listOrganizations();
    const preferences = await this.preferences(); const saved = preferences[this.key()];
    if (saved && !items.some(item => item.id === saved)) { delete preferences[this.key()]; await this.save(preferences); throw coded('organization_access_denied'); }
    const id = selectBusinessOrganization(items, saved);
    return { core: createNodeIntegrationCore({
      apiUrl: this.config!.apiUrl, business: true, organizationId: id, environment: this.config!.environment,
      liveConfirmation: this.config!.environment,
      configuration: { issuer: this.config!.issuer, clientId: this.config!.clientId, audience: 'inheriti-integrations-api', environment: this.config!.environment, redirectUri: this.config!.redirectUri, scopes: ['openid'] },
      sessions: this.sessions,
    }), organizationId: id };
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
  async reveal(planId: string, selector: string, kind: 'FIELD' | 'ASSET' = 'FIELD') {
    if (kind === 'FIELD' ? !/^[^\s.]+\.[^\s.]+$/.test(selector) : !/^[^\s.]+$/.test(selector)) throw coded('asset_selector_invalid');
    const version = this.selectionVersion;
    const selected = await this.selected(); if (!('organizationId' in selected)) return selected;
    if (version !== this.selectionVersion) throw coded('organization_selection_changed');
    if (this.job?.status === 'WAITING') throw coded('reveal_in_progress');
    const controller = new AbortController();
    const job: NonNullable<typeof this.job> = { id: crypto.randomUUID(), organizationId: selected.organizationId, phase: 'STARTING', status: 'WAITING', controller, done: Promise.resolve() };
    this.job = job;
    job.done = (async () => {
      const plan = await selected.core.getPlan(planId);
      const moderators = (plan.participants ?? [])
        .filter(participant => participant.lifecycle === 'ACTIVE' && participant.relationships.includes('MODERATOR'));
      const moderatorNamesById = new Map(moderators.map(participant => [participant.id, participant.displayName]));
      if (controller.signal.aborted || version !== this.selectionVersion || this.job !== job) throw coded('organization_selection_changed');
      const prompt = await openSafeKeyProPrompt(this.config?.deployment, process.env.INHERITI_SAFEKEY_PRO_DEVICE,
        { organizationId: selected.organizationId, planId, selector, kind }, controller.signal);
      let completed = false;
      try { await selected.core.withReveal(planId, {
        mode: revealModeOf(plan), signal: controller.signal,
        selectCustodianDevice: prompt.selectCustodianDevice,
        ...(prompt.proDevice ? { proDevice: prompt.proDevice } : {}),
        onProgress: progress => {
          job.phase = progress.phase;
          job.message = revealProgressMessage(progress, { moderators: moderators.map(participant => participant.displayName), moderatorNamesById });
        },
      }, async reveal => {
        if (kind === 'ASSET') {
          await reveal.exportAsset(selector, async asset => {
            if (controller.signal.aborted || version !== this.selectionVersion || this.job !== job) throw coded('local_delivery_canceled');
            await deliverAssetInBrowser(asset.fileName ?? 'asset.bin', asset.bytes, { signal: controller.signal, ...(asset.mimeType ? { mimeType: asset.mimeType } : {}) });
          });
        } else {
          await reveal.consumeFields([{ selector, options: { action: 'DELIVER_FIELD', destination: 'LOCAL_BROWSER' } }], async fields => {
            if (controller.signal.aborted || version !== this.selectionVersion || this.job !== job) throw coded('local_delivery_canceled');
            await deliverInBrowser(selector, fields[0]!.value, { signal: controller.signal });
          });
        }
      }); completed = true; } finally { prompt.close(completed ? 'complete' : controller.signal.aborted ? 'canceled' : 'failed'); }
    })().then(() => { job.status = 'DELIVERED'; job.message = 'Delivered securely.'; }).catch(error => {
      job.status = controller.signal.aborted ? 'CANCELED' : 'FAILED';
      if (job.status === 'CANCELED') job.message = 'Reveal canceled.';
      else if ((error as Error).message === 'SAFEKEY_NO_SPACE') job.message = 'SafeKey PRO has no free space. Download SafeKey Desktop Tool at https://safekey.be/tools/safekey-desktop/ to free space, then start a new reveal.';
      else if ((error as Error).message === 'SAFEKEY_DEVICE_INFO_MISSING') job.message = 'Could not set up SafeKey PRO. Retry the reveal.';
      else if ((error as { code?: unknown })?.code === 'reveal_restart_required') {
        job.code = 'reveal_restart_required';
        job.message = 'This plan has an interrupted open request. Finish or cancel it in Inheriti® Business, then start a new reveal.';
      }
      else if (job.phase !== 'DENIED' && job.phase !== 'STOPPED_BY_DMS') job.message = 'Reveal could not continue.';
    });
    const expiry = setTimeout(() => controller.abort(), 10 * 60_000);
    void job.done.finally(() => clearTimeout(expiry));
    return { jobId: job.id, status: job.status, phase: job.phase, ...(job.message === undefined ? {} : { message: job.message }), ...(job.code ? { code: job.code } : {}) };
  }
  async revealStatus(jobId: string, cancel = false) {
    const job = this.job;
    if (!job || job.id !== jobId) throw coded('reveal_not_found');
    if (cancel && job.status === 'WAITING') { job.controller.abort(); await job.done; }
    return { jobId: job.id, status: job.status, phase: job.phase, ...(job.message === undefined ? {} : { message: job.message }), ...(job.code ? { code: job.code } : {}), ...(job.status === 'DELIVERED' ? { delivered: true } : {}) };
  }

}

export function safeResult<T>(work: (args: T) => Promise<unknown>) {
  return async (args: T) => {
    try { return { content: [{ type: 'text' as const, text: JSON.stringify(await work(args)) }] }; }
    catch (error) {
      const code = (error as { code?: unknown })?.code;
      const safe = typeof code === 'string' && /^(organization_(?:required|selection_required|access_denied|preference_invalid)|plan_not_found|operator_reauthentication_required|plan_request_rate_limited|reveal_restart_required)$/.test(code) ? code : 'request_failed';
      return { isError: true, content: [{ type: 'text' as const, text: safe }] };
    }
  };
}

export function registerRevealTools(server: McpServer, tools: MetadataTools) {
  server.registerTool('reveal_plan_secret', { description: 'Deliver one authorized plan field to a one-time local browser page. Never returns its value.', inputSchema: z.object({ planId: z.string().min(1), selector: z.string().min(3) }) }, safeResult(({ planId, selector }: { planId: string; selector: string }) => tools.reveal(planId, selector)));
  server.registerTool('download_plan_asset', { description: 'Offer one authorized media asset as an attachment in a one-time local browser page. Never returns its bytes or URL.', inputSchema: z.object({ planId: z.string().min(1), asset: z.string().min(1) }) }, safeResult(({ planId, asset }: { planId: string; asset: string }) => tools.reveal(planId, asset, 'ASSET')));
  server.registerTool('check_reveal_status', { description: 'Check or cancel a pending local delivery.', inputSchema: z.object({ jobId: z.string().uuid(), cancel: z.boolean().optional() }) }, safeResult(({ jobId, cancel }: { jobId: string; cancel?: boolean | undefined }) => tools.revealStatus(jobId, cancel)));
}

export async function runServer(localDelivery = false) {
  const server = new McpServer({ name: 'inheriti-mcp', version: JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version });
  const tools = new MetadataTools();
  server.registerTool('list_organizations', { description: 'List available organizations and the current selection. May return a sign-in code.', inputSchema: z.object({}) }, safeResult(() => tools.listOrganizations()));
  server.registerTool('check_update', { description: 'Check this MCP server version and whether an update exists in its locked channel. Does not expose a download URL.', inputSchema: z.object({}) }, safeResult(() => tools.checkUpdate()));
  server.registerTool('select_organization', { description: 'Select an organization by ID from list_organizations.', inputSchema: z.object({ id: z.string().min(1) }) }, safeResult(({ id }: { id: string }) => tools.selectOrganization(id)));
  server.registerTool('list_backup_plans', { description: 'List plan metadata in the selected organization. May return a sign-in code.', inputSchema: z.object({ cursor: z.string().optional() }) }, safeResult(({ cursor }: { cursor?: string | undefined }) => tools.listPlans(cursor)));
  server.registerTool('get_backup_plan', { description: 'Get safe metadata for one plan in the selected organization.', inputSchema: z.object({ id: z.string().min(1) }) }, safeResult(({ id }: { id: string }) => tools.getPlan(id)));
  server.registerTool('list_backup_plan_logs', { description: 'List safe plan activity fields and total count in the selected organization.', inputSchema: z.object({ planId: z.string().min(1), limit: z.number().int().min(1).max(100).optional(), offset: z.number().int().nonnegative().safe().optional() }) }, safeResult(({ planId, limit, offset }: { planId: string; limit?: number | undefined; offset?: number | undefined }) => tools.listPlanLogs(planId, limit, offset)));
  if (localDelivery) registerRevealTools(server, tools);
  await server.connect(new StdioServerTransport());
}
