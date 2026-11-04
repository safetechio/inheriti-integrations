import type { AutomationConnection, AutomationGrant } from '@safetech/inheriti-elements-core/node-base';

export const operationalConnections = (items: AutomationConnection[]) => items.filter(item =>
  item.status === 'PENDING_VERIFICATION' || item.status === 'VERIFIED');
export const operationalGrants = (items: AutomationGrant[], connections?: AutomationConnection[]) => {
  const eligible = connections ? new Set(operationalConnections(connections).map(item => item.id)) : undefined;
  return items.filter(item =>
    ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED'].includes(item.status) && (!eligible || eligible.has(item.connectionId)));
};

export function connectionChoice(item: AutomationConnection): { id: string; name: string } {
  const target = item.trust.method === 'GITHUB_ACTIONS_OIDC' ? `${item.trust.repositoryName} · ${item.trust.environment}`
    : item.trust.method === 'AWS_IAM_ROLE' ? item.trust.roleArn
    : item.trust.method === 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC' ? item.trust.serviceAccountSubject
    : item.trust.method === 'PORTABLE_SIGNED_ASSERTION' ? item.trust.runnerSubject
    : undefined;
  return { id: item.id, name: [item.name, item.provider, item.environment, item.status, target].filter(Boolean).join(' · ') };
}

export function grantChoice(item: AutomationGrant, connections: AutomationConnection[], members: { id: string; firstName?: string; lastName?: string }[]): { id: string; name: string } {
  const connection = connections.find(candidate => candidate.id === item.connectionId);
  const member = members.find(candidate => candidate.id === item.responsibleMemberId);
  const responsible = member ? [member.firstName, member.lastName].filter(Boolean).join(' ') : item.responsibleMemberId;
  return { id: item.id, name: [connection?.name ?? item.connectionId, item.status, responsible].join(' · ') };
}
