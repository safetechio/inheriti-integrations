import { beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ inspect: vi.fn(), pair: vi.fn() }));
vi.mock('@safetech/inheriti-elements-core/node-base', async original => ({
  ...(await original<object>()),
  inspectCloudTargetForPairing: mock.inspect,
  pairCloudRunAutomation: mock.pair,
}));

import { pairGoogleAutomationService } from '../src/runtime/google-pair.js';
import { registerInspectAutomationCloudIdentity } from '../src/tools/inspect_automation_cloud_identity.js';

const connectionId = '485384e3-b685-4142-b1ca-95a0b90e56bb';
const input = { connectionId, project: 'cloud-project', region: 'us-central1', service: 'worker', expectedRevision: '42' };
const connection = { id: connectionId, provider: 'GOOGLE_CLOUD', status: 'PENDING_VERIFICATION', trust: {
  method: 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC', serviceAccountSubject: '123456789', audience: 'https://example.com/audience',
} };

function selected(current = connection) {
  const getConnection = vi.fn().mockResolvedValueOnce(current).mockResolvedValue({ ...current, status: 'VERIFIED' });
  const startPairing = vi.fn().mockResolvedValue({});
  const tools = { selectionVersion: 0, automationOperations: vi.fn().mockResolvedValue({
    organizationId: 'org-1', operations: { getConnection, startPairing },
  }) };
  return { tools, getConnection, startPairing };
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.inspect.mockResolvedValue({ identityNumericId: '123456789', revision: '42' });
  mock.pair.mockImplementation(async ({ startPairing }) => {
    await startPairing();
    return { status: 'paired', jobName: 'inheriti-pair-abc' };
  });
});

it('checks the service identity and revision before starting pairing', async () => {
  const { tools, startPairing } = selected();
  const result = await pairGoogleAutomationService.call(tools as never, input);
  expect(mock.inspect).toHaveBeenCalledWith({ provider: 'GOOGLE_CLOUD', project: input.project,
    region: input.region, service: input.service });
  expect(mock.pair).toHaveBeenCalledWith(expect.objectContaining({
    expectedRevision: '42', expectedSubject: '123456789', environment: {
      INHERITI_AUTOMATION_PROVIDER: 'GOOGLE_CLOUD', INHERITI_AUTOMATION_CONNECTION_ID: connectionId,
      INHERITI_AUTOMATION_AUDIENCE: connection.trust.audience,
    },
  }));
  expect(startPairing).toHaveBeenCalledWith(connectionId);
  expect(result).toMatchObject({ organizationId: 'org-1', connectionId, status: 'paired' });
});

it('does not open a pairing window if the service account or revision changed', async () => {
  const { tools, startPairing } = selected();
  mock.inspect.mockResolvedValue({ identityNumericId: '987654321', revision: '42' });
  await expect(pairGoogleAutomationService.call(tools as never, input))
    .rejects.toMatchObject({ code: 'automation_cloud_identity_mismatch' });
  mock.inspect.mockResolvedValue({ identityNumericId: '123456789', revision: '43' });
  await expect(pairGoogleAutomationService.call(tools as never, input))
    .rejects.toMatchObject({ code: 'automation_cloud_revision_changed' });
  expect(mock.pair).not.toHaveBeenCalled();
  expect(startPairing).not.toHaveBeenCalled();
});

it('inspection returns the reviewed revision without exposing image or environment', async () => {
  mock.inspect.mockResolvedValue({ identity: 'worker@example.iam.gserviceaccount.com',
    identityNumericId: '123456789', revision: '42', image: 'private-image', environmentNames: ['SECRET'] });
  const registerTool = vi.fn();
  registerInspectAutomationCloudIdentity({ registerTool } as never, selected().tools as never);
  const result = await registerTool.mock.calls[0]![2]({ provider: 'GOOGLE_CLOUD',
    project: input.project, region: input.region, service: input.service });
  const data = JSON.parse(result.content[0].text);
  expect(data).toMatchObject({ identityNumericId: '123456789', revision: '42' });
  expect(data).not.toHaveProperty('image');
  expect(data).not.toHaveProperty('environmentNames');
});
