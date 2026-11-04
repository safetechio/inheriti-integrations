import type { AutomationProvider } from './automation-setup.js';

export type AutomationStatusAction = { code: string; actor: 'OPERATOR' | 'RESPONSIBLE_MEMBER' | 'MODERATOR' | 'CUSTODIAN' | 'SYSTEM'; responsibleMemberId?: string; reason?: 'CONNECTION_TRUST_CHANGED' | 'RESPONSIBLE_MEMBER_MASTER_KEY_REVOKED' | 'RESPONSIBLE_MEMBER_REMOVED' | 'PLAN_DELETED' | 'PLAN_ACCESS_LOST' };
export type AutomationStatusSnapshot = {
  observedAt: string;
  provider: AutomationProvider;
  connectionId: string;
  planId: string;
  providerStatus: 'UNVERIFIED';
  setup: { status: 'READY' | 'ACTION_REQUIRED' | 'BLOCKED' | 'UNKNOWN'; steps: Array<{ code: 'CONNECTION' | 'IDENTITY' | 'PLAN_ACCESS' | 'READY'; state: 'COMPLETE' | 'CURRENT' | 'PENDING' | 'BLOCKED' | 'UNKNOWN' }>; nextAction: AutomationStatusAction | null };
  executions: { items: Array<{ jobId: string; revealId?: string; relayId?: string; runReference?: string; stage: string; status: 'IN_PROGRESS' | 'DELIVERED' | 'COMPLETED' | 'FAILED' | 'CANCELED' | 'EXPIRED' | 'UNKNOWN'; startedAt?: string; updatedAt?: string; nextAction: AutomationStatusAction | null }>; hasMore: boolean };
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const values = (value: unknown, allowed: readonly string[]): value is string => typeof value === 'string' && allowed.includes(value);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const optionalRunReference = (value: unknown) => value === undefined || (typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value));
const optionalId = (value: unknown) => value === undefined || (typeof value === 'string' && uuid.test(value));
const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const optionalDate = (value: unknown) => value === undefined || date(value);
const actors = ['OPERATOR', 'RESPONSIBLE_MEMBER', 'MODERATOR', 'CUSTODIAN', 'SYSTEM'];
const setupActions = ['CREATE_GRANT', 'VERIFY_IDENTITY', 'ACTIVATE_GRANT', 'REVIEW_GRANT', 'REPLACE_CONNECTION'];
const suspensionReasons = ['CONNECTION_TRUST_CHANGED', 'RESPONSIBLE_MEMBER_MASTER_KEY_REVOKED', 'RESPONSIBLE_MEMBER_REMOVED', 'PLAN_DELETED', 'PLAN_ACCESS_LOST'];
const executionActions = ['RELEASE_ORGANISATION_KEY', 'CONFIRM_AUTHENTICATION', 'APPROVE_MODERATION', 'RELEASE_CUSTODIAN_SHARE', 'WAIT', 'REVIEW_EXECUTION'];
function action(value: unknown, codes: readonly string[]): AutomationStatusAction | null {
  if (value === null) return null;
  if (!record(value) || !values(value.code, codes) || !values(value.actor, actors) || !optionalId(value.responsibleMemberId) || (value.reason !== undefined && (!codes.includes('REVIEW_GRANT') || !values(value.reason, suspensionReasons)))) throw new Error('Invalid automation status response');
  return { code: value.code, actor: value.actor as AutomationStatusAction['actor'], ...(value.responsibleMemberId ? { responsibleMemberId: value.responsibleMemberId as string } : {}), ...(value.reason ? { reason: value.reason as NonNullable<AutomationStatusAction['reason']> } : {}) };
}
export function parseAutomationStatus(value: unknown, planId: string, connectionId: string, jobId?: string): AutomationStatusSnapshot {
  const invalid = () => { throw new Error('Invalid automation status response'); };
  if (!record(value) || value.planId !== planId || value.connectionId !== connectionId || !date(value.observedAt) ||
      !values(value.provider, ['GITHUB', 'AWS', 'GOOGLE_CLOUD', 'PORTABLE']) || value.providerStatus !== 'UNVERIFIED' ||
      !record(value.setup) || !values(value.setup.status, ['READY', 'ACTION_REQUIRED', 'BLOCKED', 'UNKNOWN']) ||
      !Array.isArray(value.setup.steps) || value.setup.steps.length !== 4 || !record(value.executions) ||
      !Array.isArray(value.executions.items) || value.executions.items.length > 20 || typeof value.executions.hasMore !== 'boolean') return invalid();
  const codes = ['CONNECTION', 'IDENTITY', 'PLAN_ACCESS', 'READY'];
  const states = ['COMPLETE', 'CURRENT', 'PENDING', 'BLOCKED', 'UNKNOWN'];
  const steps = value.setup.steps.map((step: unknown, index: number) => {
    if (!record(step) || step.code !== codes[index] || !values(step.state, states)) return invalid();
    return { code: step.code as AutomationStatusSnapshot['setup']['steps'][number]['code'], state: step.state as AutomationStatusSnapshot['setup']['steps'][number]['state'] };
  });
  const items = value.executions.items.map((item: unknown) => {
    if (!record(item) || typeof item.jobId !== 'string' || !uuid.test(item.jobId) || (jobId && item.jobId !== jobId) ||
        !optionalId(item.revealId) || !optionalId(item.relayId) || !optionalRunReference(item.runReference) || !optionalDate(item.startedAt) || !optionalDate(item.updatedAt) ||
        !values(item.stage, ['STARTING', 'WAITING_FOR_DMS', 'WAITING_FOR_PARTICIPANTS', 'AUTHORIZED', 'MATERIAL_AUTHORIZED', 'MATERIAL_RELEASED', 'RECONSTRUCTED', 'ACTIONS_OPEN', 'EXPIRED', 'CANCELED', 'CLOSED', 'WAITING_FOR_ORGANISATION_KEY', 'ORGANISATION_KEY_READY', 'ORGANISATION_KEY_DELIVERED', 'RECONCILIATION_REQUIRED', 'FAILED', 'DENIED', 'UNKNOWN']) ||
        !values(item.status, ['IN_PROGRESS', 'DELIVERED', 'COMPLETED', 'FAILED', 'CANCELED', 'EXPIRED', 'UNKNOWN'])) return invalid();
    return { jobId: item.jobId, ...(item.revealId ? { revealId: item.revealId as string } : {}), ...(item.relayId ? { relayId: item.relayId as string } : {}),
      ...(item.runReference ? { runReference: item.runReference as string } : {}), stage: item.stage, status: item.status as AutomationStatusSnapshot['executions']['items'][number]['status'],
      ...(item.startedAt ? { startedAt: item.startedAt as string } : {}),
      ...(item.updatedAt ? { updatedAt: item.updatedAt as string } : {}), nextAction: action(item.nextAction, executionActions) };
  });
  return { observedAt: value.observedAt as string, provider: value.provider as AutomationProvider, connectionId, planId, providerStatus: 'UNVERIFIED',
    setup: { status: value.setup.status as AutomationStatusSnapshot['setup']['status'], steps, nextAction: action(value.setup.nextAction, setupActions) },
    executions: { items, hasMore: value.executions.hasMore as boolean } };
}
export function createAutomationStatusReader(options: { apiUrl: string; organizationId: string; getBearerToken: () => Promise<string | undefined>; fetchImpl?: typeof fetch }) {
  const transport = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  return async (planId: string, connectionId: string, jobId?: string, signal?: AbortSignal): Promise<AutomationStatusSnapshot> => {
    if (![planId, connectionId, ...(jobId ? [jobId] : [])].every(id => uuid.test(id))) throw new Error('Invalid automation status ID');
    signal?.throwIfAborted();
    const token = await options.getBearerToken();
    signal?.throwIfAborted();
    if (!token) throw new Error('Authentication required');
    const url = new URL(`v1/plans/${encodeURIComponent(planId)}/automation-status`, options.apiUrl);
    url.searchParams.set('connectionId', connectionId);
    if (jobId) url.searchParams.set('jobId', jobId);
    const response = await transport(url, { headers: { Authorization: `Bearer ${token}`, 'x-organization-id': options.organizationId, 'x-elements-environment': 'TEST' }, ...(signal ? { signal } : {}) });
    if (!response.ok) throw new Error(response.status === 401 ? 'automation_status_authentication_required' : response.status === 403 || response.status === 404 ? 'automation_status_permission_denied' : 'automation_status_request_failed');
    const body: unknown = await response.json().catch(() => undefined);
    if (!record(body) || body.ok !== true) throw new Error('Invalid automation status response');
    return parseAutomationStatus(body.result, planId, connectionId, jobId);
  };
}
