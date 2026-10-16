import {
  AutomationProviderValue,
  createAutomationSetupOperations,
  createNativeWindowSession,
  githubAutomationWorkflow,
  githubAutomationWorkflowLocation,
  runLocalAutomationProofBrowser,
} from '@safetech/inheriti-elements-core/node-base';
import type { AutomationProvider, AutomationTrust } from '@safetech/inheriti-elements-core/node-base';
import type { MetadataTools, AutomationTrustInput } from '../server.js';
import { coded } from './errors.js';

const automationTrust = (input: AutomationTrustInput, connectionId: string): AutomationTrust =>
  input.method === 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC'
    ? {
        method: input.method,
        audience: `${input.audienceBase.replace(/\/$/, '')}/${connectionId}`,
        serviceAccountSubject: input.serviceAccountSubject,
      }
    : input;

export async function listAutomationConnections(this: MetadataTools) {
  const selected = await this.automationOperations();
  if (!('operations' in selected)) return selected;
  const items = await selected.operations.listConnections();
  return {
    organizationId: selected.organizationId,
    items: items.map(({ id, name, provider, environment, status }) => ({ id, name, provider, environment, status })),
  };
}
export async function listAutomationGrants(this: MetadataTools, planId: string) {
  const selected = await this.automationOperations();
  if (!('operations' in selected)) return selected;
  const items = await selected.operations.listGrants(planId);
  return {
    organizationId: selected.organizationId,
    planId,
    items: items.map(({ id, connectionId, responsibleMemberId, status }) => ({
      id,
      connectionId,
      responsibleMemberId,
      status,
    })),
  };
}
export async function githubAutomationUsage(
  this: MetadataTools,
  planId: string,
  connectionId: string,
  selector: string,
) {
  const selected = await this.automationOperations();
  if (!('operations' in selected)) return selected;
  const grants = await selected.operations.listGrants(planId);
  if (!grants.some((grant) => grant.connectionId === connectionId && grant.status === 'ACTIVE'))
    throw coded('automation_active_grant_required');
  const connection = await selected.operations.getConnection(connectionId);
  if (
    connection.provider !== 'GITHUB' ||
    connection.status !== 'VERIFIED' ||
    connection.trust.method !== 'GITHUB_ACTIONS_OIDC'
  )
    throw coded('automation_verified_github_required');
  const location = githubAutomationWorkflowLocation(connection.trust.repositoryName, connection.trust.workflow);
  const release = await selected.operations.getVerifiedGithubRelease();
  return {
    organizationId: selected.organizationId,
    planId,
    connectionId,
    location,
    workflow: githubAutomationWorkflow({
      release,
      environment: connection.trust.environment,
      planId,
      connectionId,
      selector,
    }),
    instruction: [
      `Save this YAML in ${location.repository}/${location.path} on branch ${location.branch}.`,
      'The file and branch must match the verified connection.',
      'Find asset.field in the plan Data tab; the default run only checks injection.',
    ].join(' '),
  };
}
export async function listAutomationMembers(this: MetadataTools) {
  const selected = await this.automationOperations();
  if (!('operations' in selected)) return selected;
  const items = await selected.operations.listMembers();
  return {
    organizationId: selected.organizationId,
    items: items.map(({ id, firstName, lastName, status }) => ({
      id,
      displayName: [firstName, lastName].filter(Boolean).join(' ') || id,
      status,
    })),
  };
}
export async function createAutomationConnection(
  this: MetadataTools,
  input: {
    name: string;
    provider: AutomationProvider;
    environment: 'TEST' | 'LIVE';
    trust: AutomationTrustInput;
    managingTeamId?: string | undefined;
  },
) {
  const selected = await this.automationOperations();
  if (!('operations' in selected)) return selected;
  const id = crypto.randomUUID();
  const trust = automationTrust(input.trust, id);
  const provider = AutomationProviderValue.from(input.provider);
  if (!provider.accepts(trust)) throw coded('automation_provider_trust_mismatch');
  await selected.operations.createConnection({
    id,
    name: input.name,
    provider: input.provider,
    environment: input.environment,
    trust,
    ...(input.managingTeamId ? { managingTeamId: input.managingTeamId } : {}),
  });
  const expectedAudience = provider.expectedAudience(id, trust);
  return {
    organizationId: selected.organizationId,
    connectionId: id,
    status: 'PENDING_VERIFICATION',
    ...(expectedAudience ? { expectedAudience } : {}),
    instruction: 'Start one-use workload pairing with this connectionId. Use the secure proof window only as a manual fallback.',
  };
}
export async function changeAutomationTrust(this: MetadataTools, connectionId: string, trust: AutomationTrustInput) {
  const selected = await this.automationOperations();
  if (!('operations' in selected)) return selected;
  const connection = await selected.operations.getConnection(connectionId);
  const provider = AutomationProviderValue.from(connection.provider);
  const value = automationTrust(trust, connectionId);
  if (!provider.accepts(value)) throw coded('automation_provider_trust_mismatch');
  await selected.operations.changeTrust(connectionId, value);
  const expectedAudience = provider.expectedAudience(connectionId, value);
  return {
    organizationId: selected.organizationId,
    connectionId,
    updated: true,
    ...(expectedAudience ? { expectedAudience } : {}),
    instruction: 'Start one-use workload pairing with this connectionId to verify the new identity. Use the secure proof window only as a manual fallback.',
  };
}
export async function disableAutomationConnection(this: MetadataTools, connectionId: string) {
  const selected = await this.automationOperations();
  if (!('operations' in selected)) return selected;
  await selected.operations.disableConnection(connectionId);
  return { organizationId: selected.organizationId, connectionId, disabled: true };
}
export async function manageAutomationGrant(
  this: MetadataTools,
  action: 'create' | 'activate' | 'replace' | 'revoke',
  planId: string,
  input: { grantId?: string; connectionId?: string; responsibleMemberId?: string },
) {
  const selected = await this.automationOperations();
  if (!('operations' in selected)) return selected;
  const grantId = action === 'create' ? crypto.randomUUID() : input.grantId!;
  switch (action) {
    case 'create':
      await selected.operations.createGrant(planId, {
        id: grantId,
        connectionId: input.connectionId!,
        responsibleMemberId: input.responsibleMemberId!,
      });
      break;
    case 'activate':
      await selected.operations.activateGrant(planId, grantId);
      break;
    case 'replace':
      await selected.operations.replaceResponsibleMember(planId, grantId, input.responsibleMemberId!);
      break;
    case 'revoke':
      await selected.operations.revokeGrant(planId, grantId);
      break;
  }
  return { organizationId: selected.organizationId, planId, grantId, action };
}
export async function startAutomationSetup(this: MetadataTools, connectionId: string) {
  const version = this.selectionVersion;
  const selected = await this.selected();
  if (!('organizationId' in selected)) return selected;
  if (version !== this.selectionVersion) throw coded('organization_selection_changed');
  this.localAutomation();
  if (this.automationJob?.status === 'WAITING') throw coded('automation_setup_in_progress');
  const controller = new AbortController();
  const windowState = { unavailable: false };
  const window = createNativeWindowSession((reason) => {
    windowState.unavailable = reason === 'unavailable';
    controller.abort();
  });
  const job: NonNullable<typeof this.automationJob> = {
    id: crypto.randomUUID(),
    status: 'WAITING',
    phase: 'WINDOW',
    controller,
    done: Promise.resolve(),
  };
  this.automationJob = job;
  job.done = (async () => {
    const operations = createAutomationSetupOperations({
      apiUrl: this.config!.apiUrl,
      organizationId: selected.organizationId,
      getBearerToken: () => selected.core.getAccessToken(),
    });
    const result = await runLocalAutomationProofBrowser({
      operations,
      connectionId,
      open: (url) => window.open(url),
      signal: controller.signal,
    });
    if (controller.signal.aborted || version !== this.selectionVersion) throw coded('automation_setup_canceled');
    job.status = result.action === 'verified' ? 'COMPLETE' : 'CANCELED';
    job.phase = job.status;
  })()
    .catch(() => {
      job.status = windowState.unavailable ? 'FAILED' : controller.signal.aborted ? 'CANCELED' : 'FAILED';
      job.phase = windowState.unavailable ? 'WINDOW_UNAVAILABLE' : job.status;
    })
    .finally(() => {
      if (job.status === 'COMPLETE') {
        window.complete();
        return;
      }
      window.close();
    });
  return { jobId: job.id, status: job.status };
}
export async function startAutomationPairing(this: MetadataTools, connectionId: string) {
  const selected = await this.automationOperations();
  if (!('operations' in selected)) return selected;
  const pairing = await selected.operations.startPairing(connectionId);
  return {
    organizationId: selected.organizationId,
    connectionId,
    expiresAt: pairing.expiresAt,
    instruction: 'Run pairing redemption inside the configured workload before expiry, then check list_automation_connections. Native identity proof travels directly to Business.',
  };
}
export async function automationSetupStatus(this: MetadataTools, jobId: string, cancel = false) {
  const job = this.automationJob;
  if (!job || job.id !== jobId) throw coded('automation_setup_not_found');
  if (cancel && job.status === 'WAITING') {
    job.controller.abort();
    await job.done;
  }
  return { jobId: job.id, status: job.status, phase: job.phase };
}
