import { expect, it, vi } from 'vitest';

const { createConnection, inspectCloudIdentity } = vi.hoisted(() => ({
  createConnection: vi.fn(async () => undefined),
  inspectCloudIdentity: vi.fn(async (target: { provider: string }) => target.provider === 'GOOGLE_CLOUD'
    ? { identity: 'job@example.iam.gserviceaccount.com', identityNumericId: '123456789' }
    : { identity: 'arn:aws:iam::123456789012:role/task' }),
}));
vi.mock('@safetech/inheriti-elements-core/node-base', async original => ({
  ...(await original<object>()),
  createAutomationSetupOperations: () => ({ createConnection }),
  inspectCloudIdentity,
}));

import { automationManage } from '../src/commands/automations.js';

const context = {
  organization: { id: 'organization-id' },
  core: { getAccessToken: async () => 'token' },
};
const configuration = { apiUrl: 'http://business.localhost:3400/integrations/' };
const terminal = () => ({ interactive: false, write: vi.fn(), writeError: vi.fn() });

it('reads Google Cloud identity from the selected job before creating a connection', async () => {
  const output = terminal();
  const result = await automationManage(context as never, configuration as never, output as never,
    new AbortController().signal, [
      'create', '--name', 'Cloud Run', '--provider', 'GOOGLE_CLOUD', '--deployment-environment', 'TEST',
      '--audience-base', 'https://example.com/automation',
      '--project', 'project', '--region', 'us-central1', '--job', 'job',
    ]);
  expect(result).toBe(0);
  expect(inspectCloudIdentity).toHaveBeenCalledWith(expect.objectContaining({ provider: 'GOOGLE_CLOUD', job: 'job' }));
  expect(createConnection).toHaveBeenCalledWith(expect.objectContaining({
    trust: expect.objectContaining({ serviceAccountSubject: '123456789' }),
  }));
});

it('reads the AWS task role from the selected ECS service', async () => {
  const output = terminal();
  const result = await automationManage(context as never, configuration as never, output as never,
    new AbortController().signal, [
      'create', '--name', 'ECS', '--provider', 'AWS', '--deployment-environment', 'TEST',
      '--region', 'us-east-1', '--cluster', 'cluster', '--service', 'service',
    ]);
  expect(result).toBe(0);
  expect(inspectCloudIdentity).toHaveBeenCalledWith(expect.objectContaining({ provider: 'AWS', service: 'service' }));
  expect(createConnection).toHaveBeenCalledWith(expect.objectContaining({
    trust: { method: 'AWS_IAM_ROLE', roleArn: 'arn:aws:iam::123456789012:role/task' },
  }));
});
