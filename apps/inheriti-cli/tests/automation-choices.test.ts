import { expect, it } from 'vitest';
import { connectionChoice, grantChoice, operationalConnections, operationalGrants } from '../src/commands/automation-choices.js';

it('hides inactive records and gives operational choices enough context', () => {
  const connections = [
    { id: 'a', name: 'Deploy', provider: 'GITHUB', environment: 'TEST', status: 'VERIFIED', trust: { method: 'GITHUB_ACTIONS_OIDC', repositoryName: 'owner/repo', environment: 'production', workflow: 'owner/repo/.github/workflows/deploy.yml@refs/heads/main' } },
    { id: 'b', name: 'Old', provider: 'GITHUB', environment: 'TEST', status: 'DISABLED', trust: { method: 'GITHUB_ACTIONS_OIDC', repositoryName: 'owner/repo', environment: 'old', workflow: 'owner/repo/.github/workflows/old.yml@refs/heads/main' } },
    { id: 'c', name: 'Unknown', provider: 'GITHUB', environment: 'TEST', status: 'UNKNOWN', trust: { method: 'GITHUB_ACTIONS_OIDC', repositoryName: 'owner/repo', environment: 'old', workflow: 'owner/repo/.github/workflows/old.yml@refs/heads/main' } },
  ] as const;
  const grants = [
    { id: 'g1', planId: 'p', connectionId: 'a', responsibleMemberId: 'm', status: 'PENDING_VERIFICATION' },
    { id: 'g2', planId: 'p', connectionId: 'b', responsibleMemberId: 'm', status: 'REVOKED' },
    { id: 'g3', planId: 'p', connectionId: 'b', responsibleMemberId: 'm', status: 'PENDING_VERIFICATION' },
    { id: 'g4', planId: 'p', connectionId: 'a', responsibleMemberId: 'm', status: 'UNKNOWN' },
  ] as const;
  expect(operationalConnections([...connections] as never).map(item => item.id)).toEqual(['a']);
  expect(operationalGrants([...grants]).map(item => item.id)).toEqual(['g1', 'g3']);
  expect(operationalGrants([...grants], [...connections] as never).map(item => item.id)).toEqual(['g1']);
  expect(connectionChoice(connections[0] as never).name).toContain('Deploy · GITHUB · TEST · VERIFIED · owner/repo · production');
  expect(grantChoice(grants[0], [...connections] as never, [{ id: 'm', firstName: 'Ana', lastName: 'Lopez' }]).name)
    .toBe('Deploy · PENDING_VERIFICATION · Ana Lopez');
});
