import { randomUUID } from 'node:crypto';
import { HttpPlanEditPort } from '@safetech/inheriti-client-sdk/node-base';
import { validateAssetIntegrationCode } from '@safetech/inheriti-core-sdk/vanilla';
import { AutomationProviderValue } from './automation-provider.js';

export type AutomationProvider = 'GITHUB' | 'GOOGLE_CLOUD' | 'AWS' | 'PORTABLE';
export type AutomationTrust =
  | { method: 'GITHUB_ACTIONS_OIDC'; repositoryName: string; environment: string; workflow: string }
  | { method: 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC'; audience: string; serviceAccountSubject: string }
  | { method: 'AWS_IAM_ROLE'; roleArn: string }
  | { method: 'PORTABLE_SIGNED_ASSERTION'; keyId: string; publicKey: string; runnerSubject: string; environment: string };
export type AutomationConnection = { id: string; name: string; provider: AutomationProvider; environment: 'TEST' | 'LIVE'; status: string; trust: AutomationTrust };
export type AutomationGrant = { id: string; planId: string; connectionId: string; responsibleMemberId: string; status: string };
export type AutomationPlan = { id: string; title?: string; name?: string };
export type AutomationMember = { id: string; firstName?: string; lastName?: string; email?: string; status?: string; masterKeyStatus?: string };
export type VerifiedGithubRelease = { actionRepository: string; actionRef: string; cliVersion: string };
const VERIFIED_CLI_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-dev\.(0|[1-9]\d*))?$/;
export type AutomationSetupOperations = {
  getVerifiedGithubRelease(): Promise<VerifiedGithubRelease>;
  listConnections(): Promise<AutomationConnection[]>;
  getConnection(id: string): Promise<AutomationConnection>;
  createConnection(input: { id: string; name: string; provider: AutomationProvider; environment: 'TEST' | 'LIVE'; trust: AutomationTrust; managingTeamId?: string }): Promise<void>;
  verifyConnection(id: string, proof: string): Promise<void>;
  changeTrust(id: string, trust: AutomationTrust): Promise<void>;
  disableConnection(id: string): Promise<void>;
  listGrants(planId: string): Promise<AutomationGrant[]>;
  createGrant(planId: string, input: { id: string; connectionId: string; responsibleMemberId: string }): Promise<void>;
  activateGrant(planId: string, grantId: string): Promise<void>;
  replaceResponsibleMember(planId: string, grantId: string, responsibleMemberId: string): Promise<void>;
  revokeGrant(planId: string, grantId: string): Promise<void>;
  listPlans(): Promise<AutomationPlan[]>;
  listMembers(): Promise<AutomationMember[]>;
};

export function createAutomationSetupOperations(options: {
  apiUrl: string;
  organizationId: string;
  getBearerToken: () => Promise<string | undefined>;
  fetchImpl?: typeof fetch;
}): AutomationSetupOperations {
  const base = new URL('v1/', options.apiUrl).toString().replace(/\/$/, '');
  const connections = `${base}/automation-connections`;
  const grants = (planId: string) => `${base}/plans/${encodeURIComponent(planId)}/automation-grants`;
  const transport = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const plansPort = new HttpPlanEditPort(options.apiUrl, 'TEST', async () => (await options.getBearerToken()) ?? null, transport);
  const request = async (url: string, method = 'GET', body?: unknown): Promise<unknown> => {
    const token = await options.getBearerToken();
    if (!token) throw new Error('Authentication required');
    const response = await transport(url, { method, headers: { Authorization: `Bearer ${token}`, 'x-organization-id': options.organizationId, 'x-elements-environment': 'TEST', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) {
      const code = (response.status === 400 || response.status === 404) && url.endsWith('/verified-github-release') ? 'automation_verified_release_unavailable'
        : response.status === 401 ? 'automation_setup_authentication_required'
        : response.status === 403 || response.status === 404 ? 'automation_setup_permission_denied'
        : 'automation_setup_request_failed';
      throw Object.assign(new Error(code), { code });
    }
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || !('ok' in data) || data.ok !== true || (method === 'GET' && !('result' in data))) throw new Error('Invalid Business API response');
    return 'result' in data ? data.result : undefined;
  };
  const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const items = <T>(value: unknown, valid: (item: unknown) => boolean): T[] => {
    const list = Array.isArray(value) ? value : value && typeof value === 'object' && 'items' in value ? value.items : null;
    if (!Array.isArray(list) || !list.every(valid)) throw new Error('Invalid Business API response');
    return list as T[];
  };
  const providerValid = (provider: unknown, trust: unknown) => {
    if (!record(trust) || typeof trust.method !== 'string') return false;
    try { return AutomationProviderValue.from(provider).accepts(trust as AutomationTrust); } catch { return false; }
  };
  const connectionValid = (item: unknown) => record(item) && typeof item.id === 'string' && typeof item.name === 'string' && providerValid(item.provider, item.trust) && typeof item.status === 'string';
  const grantValid = (item: unknown) => record(item) && typeof item.id === 'string' && typeof item.planId === 'string' && typeof item.connectionId === 'string' && typeof item.responsibleMemberId === 'string' && typeof item.status === 'string';
  return {
    getVerifiedGithubRelease: async () => {
      const value = await request(`${connections}/verified-github-release`);
      if (!record(value) || value.actionRepository !== 'safetechio/inheriti-integrations' || typeof value.actionRef !== 'string' || !/^[a-f0-9]{40}$/i.test(value.actionRef) || typeof value.cliVersion !== 'string' || !VERIFIED_CLI_VERSION.test(value.cliVersion)) throw new Error('Invalid verified GitHub release');
      return value as VerifiedGithubRelease;
    },
    listConnections: async () => items<AutomationConnection>(await request(connections), connectionValid),
    getConnection: async (id) => { const item = await request(`${connections}/${encodeURIComponent(id)}`); if (!item || typeof item !== 'object' || !connectionValid(item)) throw new Error('Invalid Business API response'); return item as AutomationConnection; },
    createConnection: async (input) => { await request(connections, 'POST', input); },
    verifyConnection: async (id, proof) => { await request(`${connections}/${encodeURIComponent(id)}/verify-identity`, 'POST', { proof }); },
    changeTrust: async (id, trust) => { await request(`${connections}/${encodeURIComponent(id)}/trust`, 'PATCH', { trust }); },
    disableConnection: async (id) => { await request(`${connections}/${encodeURIComponent(id)}`, 'DELETE'); },
    listGrants: async (planId) => items<AutomationGrant>(await request(grants(planId)), grantValid),
    createGrant: async (planId, input) => { await request(grants(planId), 'POST', input); },
    activateGrant: async (planId, id) => { await request(`${grants(planId)}/${encodeURIComponent(id)}/activate`, 'POST'); },
    replaceResponsibleMember: async (planId, id, responsibleMemberId) => { await request(`${grants(planId)}/${encodeURIComponent(id)}/responsible-member`, 'PUT', { responsibleMemberId }); },
    revokeGrant: async (planId, id) => { await request(`${grants(planId)}/${encodeURIComponent(id)}`, 'DELETE'); },
    listPlans: async () => { const page = await plansPort.listEligibleCandidates(options.organizationId); return page.items.map(({ id, name }: { id: string; name: string }) => ({ id, name })); },
    listMembers: async () => {
      const all: AutomationMember[] = [];
      while (true) {
        const page = await request(`${base}/automation-members?skip=${all.length}`);
        if (!record(page) || !Number.isSafeInteger(page.total) || Number(page.total) < 0) throw new Error('Invalid Business API response');
        const current = items<AutomationMember>(page, (item) => record(item) && typeof item.id === 'string' && typeof item.status === 'string');
        all.push(...current);
        if (current.length === 0 || all.length >= Number(page.total)) return all;
      }
    },
  };
}

export const newAutomationId = randomUUID;

export function githubAutomationWorkflowLocation(repositoryName: string, workflow: string): { repository: string; path: string; branch: string } {
  const match = /^([^@\s]+\/[^@\s]+)\/(\.github\/workflows\/[^/@\s]+\.ya?ml)@refs\/heads\/([^@\s]+)$/.exec(workflow);
  if (!match || match[1] !== repositoryName || !/^[A-Za-z0-9._/-]+$/.test(match[3]!) || match[3]!.includes('..') || match[3]!.startsWith('/') || match[3]!.endsWith('/')) throw new Error('automation_github_workflow_ref_invalid');
  return { repository: repositoryName, path: match[2]!, branch: match[3]! };
}

export function isGithubAutomationSelector(selector: string): boolean {
  const separator = selector.indexOf('.');
  return separator > 0 && separator === selector.lastIndexOf('.') && validateAssetIntegrationCode(selector.slice(0, separator)) && /^[A-Za-z][A-Za-z0-9]*$/.test(selector.slice(separator + 1));
}

export function githubAutomationWorkflow(input: { release: VerifiedGithubRelease; environment: string; planId: string; connectionId: string; selector: string }): string {
  const { release, environment, planId, connectionId, selector } = input;
  if (release.actionRepository !== 'safetechio/inheriti-integrations' || !/^[a-f0-9]{40}$/i.test(release.actionRef) || !VERIFIED_CLI_VERSION.test(release.cliVersion) || !isGithubAutomationSelector(selector) || [environment, planId, connectionId].some(value => !value || /[\r\n]/.test(value))) throw new Error('Invalid GitHub workflow input');
  return [
    'name: Inheriti secret usage', 'on: workflow_dispatch', 'permissions:', '  contents: read', '  id-token: write',
    'jobs:', '  use-secret:', '    runs-on: ubuntu-latest', `    environment: ${JSON.stringify(environment)}`, '    steps:',
    `      - uses: ${release.actionRepository}/integrations/github-actions@${release.actionRef}`, '        with:',
    `          cli-version: ${JSON.stringify(release.cliVersion)}`, `          plan: ${JSON.stringify(planId)}`,
    `          connection-id: ${JSON.stringify(connectionId)}`, `          audience: ${JSON.stringify(AutomationProviderValue.from('GITHUB').expectedAudience(connectionId)!)}`,
    '          env: |', `            INHERITI_SECRET=${selector}`, `          run: ${JSON.stringify('test -n "$INHERITI_SECRET"')}`,
  ].join('\n');
}
