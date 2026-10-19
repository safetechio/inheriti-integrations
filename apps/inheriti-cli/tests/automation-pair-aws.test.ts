import { expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  getAccessToken: vi.fn(async () => 'token'),
  getConnection: vi.fn(async () => ({ id: 'connection-1', provider: 'AWS', status: 'PENDING_VERIFICATION', trust: { method: 'AWS_IAM_ROLE', roleArn: 'arn:aws:iam::123456789012:role/task' } })),
  startPairing: vi.fn(async () => undefined),
  inspectCloudTargetForPairing: vi.fn(async () => ({ target: { provider: 'AWS', region: 'us-east-1', cluster: 'jobs', service: 'worker' }, identity: 'arn:aws:iam::123456789012:role/task', revision: 'rev:1' })),
  pairEcsAutomation: vi.fn(async () => ({ status: 'paired', taskDefinition: 'arn:aws:ecs:us-east-1:123456789012:task-definition/inheriti:2' })),
}));

vi.mock('@safetech/inheriti-elements-core/node-base', async original => ({
  ...(await original<object>()),
  createAutomationSetupOperations: () => mock,
  inspectCloudTargetForPairing: mock.inspectCloudTargetForPairing,
  pairEcsAutomation: mock.pairEcsAutomation,
}));
vi.mock('../src/render/select.js', () => ({ promptSelect: vi.fn(async () => 'run') }));

import { pairAwsAutomationService } from '../src/commands/automation-pair-aws.js';

const terminal = () => ({ interactive: false, stdoutIsTTY: false, columns: 100, write: vi.fn(), writeError: vi.fn() });
const context = { organization: { id: 'org-1' }, core: { getAccessToken: mock.getAccessToken } };
const configuration = { apiUrl: 'http://business.localhost:3400/integrations/' };

it('pairs an ECS service using the verified task role and pinned revision', async () => {
  const output = terminal();
  mock.getConnection.mockResolvedValueOnce({ id: 'connection-1', provider: 'AWS', status: 'PENDING_VERIFICATION', trust: { method: 'AWS_IAM_ROLE', roleArn: 'arn:aws:iam::123456789012:role/task' } });
  mock.getConnection.mockResolvedValueOnce({ id: 'connection-1', provider: 'AWS', status: 'VERIFIED', trust: { method: 'AWS_IAM_ROLE', roleArn: 'arn:aws:iam::123456789012:role/task' } });
  const argv = ['--connection', 'connection-1', '--region', 'us-east-1', '--cluster', 'jobs', '--service', 'worker',
    '--image', 'repo@sha256:' + 'a'.repeat(64), '--expect-revision', 'rev:1'];
  const controller = new AbortController();
  expect(await pairAwsAutomationService(context as never, configuration as never, output as never, argv, controller.signal)).toBe(0);
  expect(mock.pairEcsAutomation).toHaveBeenCalledWith(expect.objectContaining({
    target: { provider: 'AWS', region: 'us-east-1', cluster: 'jobs', service: 'worker' },
    expectedRevision: 'rev:1', expectedRoleArn: 'arn:aws:iam::123456789012:role/task',
    image: 'repo@sha256:' + 'a'.repeat(64),
    signal: controller.signal,
  }));
  const pairCalls = (mock.pairEcsAutomation as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  const pairInput = pairCalls[0]?.[0] as { startPairing: () => Promise<void> };
  await pairInput.startPairing();
  expect(mock.startPairing).toHaveBeenCalledWith('connection-1');
  expect(output.write.mock.calls.flat().join('\n')).toContain('paired');
});

it('rejects a stale ECS task definition before starting pairing', async () => {
  mock.inspectCloudTargetForPairing.mockResolvedValueOnce({ target: { provider: 'AWS', region: 'us-east-1', cluster: 'jobs', service: 'worker' }, identity: 'arn:aws:iam::123456789012:role/task', revision: 'rev:2' });
  const output = terminal();
  const argv = ['--connection', 'connection-1', '--region', 'us-east-1', '--cluster', 'jobs', '--service', 'worker',
    '--image', 'repo@sha256:' + 'a'.repeat(64), '--expect-revision', 'rev:1'];
  expect(await pairAwsAutomationService(context as never, configuration as never, output as never, argv)).toBe(1);
  expect(mock.startPairing).not.toHaveBeenCalled();
  expect(mock.pairEcsAutomation).not.toHaveBeenCalled();
  expect(output.writeError.mock.calls.flat().join('\n')).toContain('changed');
});
