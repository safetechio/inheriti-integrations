import { expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  getAccessToken: vi.fn(async () => 'token'),
  getConnection: vi.fn(async () => ({ id: 'connection-1', provider: 'GOOGLE_CLOUD', status: 'PENDING_VERIFICATION',
    trust: { method: 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC', audience: 'https://example.test/a,b', serviceAccountSubject: '123456789' } })),
  startPairing: vi.fn(async () => undefined),
  inspectCloudTargetForPairing: vi.fn(async () => ({ identity: 'app@example.test', identityNumericId: '123456789', revision: '7' })),
  pairCloudRunAutomation: vi.fn(async () => ({ status: 'paired', jobName: 'inheriti-pair-test' })),
}));

vi.mock('@safetech/inheriti-elements-core/node-base', async original => ({
  ...(await original<object>()),
  createAutomationSetupOperations: () => mock,
  inspectCloudTargetForPairing: mock.inspectCloudTargetForPairing,
  pairCloudRunAutomation: mock.pairCloudRunAutomation,
}));

import { pairGoogleAutomationWorkload } from '../src/commands/automation-pair-google.js';

const terminal = () => ({ interactive: false, stdoutIsTTY: false, columns: 100, write: vi.fn(), writeError: vi.fn() });
const context = { organization: { id: 'org-1' }, core: { getAccessToken: mock.getAccessToken } };
const configuration = { apiUrl: 'http://business.localhost:3400/integrations/' };

it('pairs a Cloud Run service using its service account and pinned generation', async () => {
  const output = terminal();
  mock.getConnection.mockResolvedValueOnce({ id: 'connection-1', provider: 'GOOGLE_CLOUD', status: 'PENDING_VERIFICATION',
    trust: { method: 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC', audience: 'https://example.test/a,b', serviceAccountSubject: '123456789' } });
  mock.getConnection.mockResolvedValueOnce({ id: 'connection-1', provider: 'GOOGLE_CLOUD', status: 'VERIFIED',
    trust: { method: 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC', audience: 'https://example.test/a,b', serviceAccountSubject: '123456789' } });
  expect(await pairGoogleAutomationWorkload(context as never, configuration as never, output as never,
    ['--connection', 'connection-1', '--project', 'sample-project', '--region', 'us-central1', '--service', 'app', '--expect-revision', '7']))
    .toBe(0);
  expect(mock.pairCloudRunAutomation).toHaveBeenCalledWith(expect.objectContaining({
    target: { provider: 'GOOGLE_CLOUD', project: 'sample-project', region: 'us-central1', service: 'app' },
    expectedRevision: '7', expectedSubject: '123456789',
  }));
  const pairInput = (mock.pairCloudRunAutomation as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0] as { startPairing: () => Promise<void> };
  await pairInput.startPairing();
  expect(mock.startPairing).toHaveBeenCalledWith('connection-1');
});

it('rejects a changed Cloud Run generation before opening pairing', async () => {
  mock.inspectCloudTargetForPairing.mockResolvedValueOnce({ identity: 'app@example.test', identityNumericId: '123456789', revision: '8' });
  const output = terminal();
  expect(await pairGoogleAutomationWorkload(context as never, configuration as never, output as never,
    ['--connection', 'connection-1', '--project', 'sample-project', '--region', 'us-central1', '--job', 'app-job', '--expect-revision', '7']))
    .toBe(1);
  expect(output.writeError.mock.calls.flat().join('\n')).toContain('changed');
});
