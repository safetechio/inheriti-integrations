import { beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ generate: vi.fn(), inspect: vi.fn(), preview: vi.fn(), ecsApply: vi.fn(), cloudRunApply: vi.fn(), cloudRunServiceApply: vi.fn() }));
vi.mock('@safetech/inheriti-elements-core/node-base', async original => ({
  ...(await original<object>()),
  generateAutomationRuntimeBundle: mock.generate,
  inspectCloudTarget: mock.inspect,
  previewCloudTarget: mock.preview,
  applyEcsAutomation: mock.ecsApply,
  applyCloudRunAutomation: mock.cloudRunApply,
  applyCloudRunServiceAutomation: mock.cloudRunServiceApply,
}));

import { applyAutomationRuntime, prepareAutomationRuntime } from '../src/runtime/runtime-setup.js';

beforeEach(() => vi.clearAllMocks());

const planId = '485384e3-b685-4142-b1ca-95a0b90e56ba';
const connectionId = '485384e3-b685-4142-b1ca-95a0b90e56bb';
const input = { planId, connectionId, field: 'account.password', environmentVariable: 'DATABASE_PASSWORD' };
const connection = { id: connectionId, provider: 'PORTABLE', status: 'VERIFIED', trust: { method: 'PORTABLE_SIGNED_ASSERTION' } };
const selected = (getConnection = vi.fn().mockResolvedValue(connection), grants = [{ connectionId, status: 'ACTIVE' }]) => ({
  selectionVersion: 0,
  automationOperations: vi.fn().mockResolvedValue({ organizationId: 'org', operations: {
    listGrants: vi.fn().mockResolvedValue(grants), getConnection,
  } }),
  getPlan: vi.fn().mockResolvedValue({ organizationId: 'org', plan: { assets: [
    { code: 'account', isBinary: false, fieldNames: ['password'] },
  ] } }),
});

it('prepares only a verified and granted field without cloud inspection', async () => {
  mock.generate.mockReturnValue({ script: 'safe script', environment: {}, provider: 'PORTABLE' });
  const tools = selected();
  const result = await prepareAutomationRuntime.call(tools as never, input);
  expect(result).toMatchObject({ organizationId: 'org', planId, connectionId, applied: false, script: 'safe script' });
  expect(mock.generate).toHaveBeenCalledWith({ planId, connection,
    mappings: [{ selector: input.field, envName: input.environmentVariable }] });
  expect(mock.inspect).not.toHaveBeenCalled();
});

it('prepares several allowed fields in one runtime mapping', async () => {
  mock.generate.mockReturnValue({ script: 'safe script', environment: {}, provider: 'PORTABLE' });
  const tools = selected();
  tools.getPlan.mockResolvedValue({ organizationId: 'org', plan: { assets: [
    { code: 'account', isBinary: false, fieldNames: ['password', 'username'] },
  ] } });
  const mappings = [{ selector: 'account.password', envName: 'APP_PASSWORD' },
    { selector: 'account.username', envName: 'APP_USERNAME' }];
  await prepareAutomationRuntime.call(tools as never, { planId, connectionId, mappings });
  expect(mock.generate).toHaveBeenCalledWith({ planId, connection, mappings });
});

it('prepares all fields except exclusions and returns exact mappings for review', async () => {
  mock.generate.mockReturnValue({ script: 'safe script', environment: {}, provider: 'PORTABLE' });
  const tools = selected();
  tools.getPlan.mockResolvedValue({ organizationId: 'org', plan: { assets: [
    { code: 'account', isBinary: false, fieldNames: ['password', 'username'] },
  ] } });
  const result = await prepareAutomationRuntime.call(tools as never, { planId, connectionId,
    mapAll: true, exceptFields: ['account.password'],
    mappings: [{ selector: 'account.username', envName: 'APP_USER' }],
  });
  expect(result).toMatchObject({ mappings: [{ selector: 'account.username', envName: 'APP_USER' }] });
  expect(mock.generate).toHaveBeenCalledWith(expect.objectContaining({ mappings: [
    { selector: 'account.username', envName: 'APP_USER' },
  ] }));
});

it('prepares only selected fields with generated environment names', async () => {
  mock.generate.mockReturnValue({ script: 'safe script', environment: {}, provider: 'PORTABLE' });
  const result = await prepareAutomationRuntime.call(selected() as never, { planId, connectionId,
    onlyFields: ['account.password'],
  });
  expect(result).toMatchObject({ mappings: [{ selector: 'account.password', envName: 'ACCOUNT_PASSWORD' }] });
});

it('returns a cloud launcher for a VM or cluster without provider inspection', async () => {
  const cloudConnection = { ...connection, provider: 'AWS', trust: {
    method: 'AWS_IAM_ROLE', roleArn: 'arn:aws:iam::123456789012:role/instance',
  } };
  mock.generate.mockReturnValue({ script: 'safe script', environment: {}, provider: 'AWS' });
  const result = await prepareAutomationRuntime.call(selected(vi.fn().mockResolvedValue(cloudConnection)) as never, input);
  expect(result).toMatchObject({ applied: false, script: 'safe script' });
  expect(mock.inspect).not.toHaveBeenCalled();
});

it('rejects ambiguous legacy and multi-field inputs before provider calls', async () => {
  const tools = selected();
  await expect(applyAutomationRuntime.call(tools as never, { ...input,
    mappings: [{ selector: input.field, envName: input.environmentVariable }],
    target: { provider: 'AWS', region: 'us-east-1', cluster: 'cluster', service: 'worker' },
    image: 'repo@sha256:' + 'a'.repeat(64), cliPath: '/usr/local/bin/inheriti', expectedRevision: 'rev:1',
  })).rejects.toMatchObject({ code: 'automation_plan_field_invalid' });
  expect(mock.inspect).not.toHaveBeenCalled();
  expect(mock.ecsApply).not.toHaveBeenCalled();
});

it('rejects missing plan fields and inactive grants before generating', async () => {
  const noField = selected();
  await expect(prepareAutomationRuntime.call(noField as never, { ...input, field: 'account.unknown' }))
    .rejects.toMatchObject({ code: 'automation_plan_field_invalid' });
  const noGrant = selected(undefined, []);
  await expect(prepareAutomationRuntime.call(noGrant as never, input))
    .rejects.toMatchObject({ code: 'automation_active_grant_required' });
  expect(mock.generate).not.toHaveBeenCalled();
});

it('accepts a text field by asset ID when the plan has no integration code', async () => {
  mock.generate.mockReturnValue({ script: 'safe script', environment: {}, provider: 'PORTABLE' });
  const tools = selected();
  tools.getPlan.mockResolvedValue({ organizationId: 'org', plan: { assets: [
    { id: 'account', isBinary: false, fieldNames: ['password'] },
  ] } });
  const result = await prepareAutomationRuntime.call(tools as never, input);
  expect(result).toMatchObject({ applied: false, script: 'safe script' });
});

it('rejects cloud launcher settings for a portable runner', async () => {
  mock.generate.mockReturnValue({ script: 'safe script', environment: {}, provider: 'PORTABLE' });
  await expect(prepareAutomationRuntime.call(selected() as never,
    { ...input, launcherPath: '/opt/inheriti/run.sh' }))
    .rejects.toMatchObject({ code: 'automation_cloud_target_invalid' });
});

it('returns a safe cloud preview without raw startup command or environment values', async () => {
  const cloudConnection = { ...connection, provider: 'AWS', trust: { method: 'AWS_IAM_ROLE', roleArn: 'arn:aws:iam::123456789012:role/job' } };
  const tools = selected(vi.fn().mockResolvedValue(cloudConnection));
  const target = { provider: 'AWS' as const, region: 'us-east-1', cluster: 'example', service: 'worker' };
  mock.generate.mockReturnValue({ script: 'safe script', environment: { INHERITI_AUTOMATION_PROVIDER: 'AWS' }, provider: 'AWS' });
  mock.inspect.mockResolvedValue({ target, command: ['private-command-argument'], environmentValues: ['private-value'],
    identity: cloudConnection.trust.roleArn });
  mock.preview.mockReturnValue({ target, startupCommandWillChange: true });
  const result = await prepareAutomationRuntime.call(tools as never,
    { ...input, target, launcherPath: '/opt/inheriti/run.sh' });
  expect(result).toMatchObject({ applied: false, preview: { startupCommandWillChange: true } });
  expect(JSON.stringify(result)).not.toContain('private-command-argument');
  expect(JSON.stringify(result)).not.toContain('private-value');
});

it('applies a confirmed ECS revision after validating the plan and connection', async () => {
  const cloudConnection = { ...connection, provider: 'AWS', trust: { method: 'AWS_IAM_ROLE', roleArn: 'arn:aws:iam::123456789012:role/job' } };
  const tools = selected(vi.fn().mockResolvedValue(cloudConnection));
  const target = { provider: 'AWS' as const, region: 'us-east-1', cluster: 'example', service: 'worker' };
  mock.generate.mockReturnValue({ script: 'safe script', environment: { INHERITI_AUTOMATION_PROVIDER: 'AWS' }, provider: 'AWS' });
  mock.inspect.mockResolvedValue({ target, identity: cloudConnection.trust.roleArn });
  mock.preview.mockReturnValue({ target, identity: cloudConnection.trust.roleArn, revision: 'rev:1' });
  mock.ecsApply.mockResolvedValue({ status: 'deployed', revision: 'rev:2' });
  const applyInput = { ...input, target, image: 'repo@sha256:' + 'a'.repeat(64),
    cliPath: '/usr/local/bin/inheriti', expectedRevision: 'rev:1' };
  const result = await applyAutomationRuntime.call(tools as never, applyInput);
  expect(result).toMatchObject({ status: 'deployed', revision: 'rev:2' });
  expect(mock.ecsApply).toHaveBeenCalledWith(expect.objectContaining({ expectedRoleArn: cloudConnection.trust.roleArn }));
  await expect(applyAutomationRuntime.call(tools as never, { ...applyInput, expectedRevision: 'rev:0' }))
    .rejects.toMatchObject({ code: 'automation_cloud_revision_changed' });
  expect(mock.ecsApply).toHaveBeenCalledTimes(1);
});

it('applies a Google Cloud revision only for the matching service account', async () => {
  const cloudConnection = { ...connection, provider: 'GOOGLE_CLOUD', trust: {
    method: 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC', serviceAccountSubject: '12345', audience: 'https://example.test/audience',
  } };
  const tools = selected(vi.fn().mockResolvedValue(cloudConnection));
  const target = { provider: 'GOOGLE_CLOUD' as const, project: 'project', region: 'us-central1', job: 'worker' };
  mock.generate.mockReturnValue({ script: 'safe script', environment: { INHERITI_AUTOMATION_PROVIDER: 'GOOGLE_CLOUD' } });
  mock.inspect.mockResolvedValue({ target, identity: 'job@project.iam.gserviceaccount.com', identityNumericId: '12345' });
  mock.preview.mockReturnValue({ target, identity: 'job@project.iam.gserviceaccount.com', revision: '1' });
  mock.cloudRunApply.mockResolvedValue({ status: 'updated', revision: '2' });
  const applyInput = { ...input, target, image: `repo@sha256:${'a'.repeat(64)}`,
    cliPath: '/usr/local/bin/inheriti', expectedRevision: '1' };
  await expect(applyAutomationRuntime.call(tools as never, applyInput))
    .resolves.toMatchObject({ status: 'updated', revision: '2' });
  expect(mock.cloudRunApply).toHaveBeenCalledWith(expect.objectContaining({
    expectedServiceAccount: 'job@project.iam.gserviceaccount.com',
  }));

  mock.inspect.mockResolvedValue({ target, identity: 'other@project.iam.gserviceaccount.com', identityNumericId: '99999' });
  await expect(applyAutomationRuntime.call(tools as never, applyInput))
    .rejects.toMatchObject({ code: 'automation_cloud_identity_mismatch' });
  expect(mock.cloudRunApply).toHaveBeenCalledTimes(1);
});

it('dispatches a Cloud Run service update with the verified service account', async () => {
  const cloudConnection = { ...connection, provider: 'GOOGLE_CLOUD', trust: {
    method: 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC', serviceAccountSubject: '12345', audience: 'https://example.test/audience',
  } };
  const tools = selected(vi.fn().mockResolvedValue(cloudConnection));
  const target = { provider: 'GOOGLE_CLOUD' as const, project: 'project', region: 'us-central1', service: 'api' };
  mock.generate.mockReturnValue({ script: 'safe script', environment: { INHERITI_AUTOMATION_PROVIDER: 'GOOGLE_CLOUD' } });
  mock.inspect.mockResolvedValue({ target, identity: 'api@project.iam.gserviceaccount.com', identityNumericId: '12345' });
  mock.preview.mockReturnValue({ target, identity: 'api@project.iam.gserviceaccount.com', revision: '1' });
  mock.cloudRunServiceApply.mockResolvedValue({ status: 'updated', revision: '2' });
  await expect(applyAutomationRuntime.call(tools as never, { ...input, target,
    image: `repo@sha256:${'a'.repeat(64)}`, cliPath: '/usr/local/bin/inheriti', expectedRevision: '1' }))
    .resolves.toMatchObject({ status: 'updated', revision: '2' });
  expect(mock.cloudRunServiceApply).toHaveBeenCalledWith(expect.objectContaining({
    expectedServiceAccount: 'api@project.iam.gserviceaccount.com', target,
  }));
});
