import { expect, it, vi } from 'vitest';
import { MetadataTools } from '../src/server.js';

const publisher = vi.hoisted(() => ({ inspectSecret: vi.fn(), inspectParameter: vi.fn(), publishSecret: vi.fn(), publishParameter: vi.fn() }));
vi.mock('@safetech/inheriti-elements-core/node-base', async original => ({
  ...await original<typeof import('@safetech/inheriti-elements-core/node-base')>(),
  createAwsSecretPublisher: () => publisher,
}));
vi.mock('../src/safekey-pro.js', () => ({ openSafeKeyProPrompt: async () => ({ selectCustodianDevice: () => 'SK_MOBILE', close: () => undefined }) }));

const base = { planId: 'plan', region: 'us-east-1', expectedAccountId: '123456789012',
  mappings: [{ selector: 'asset.password', key: 'PASSWORD' }] };
const plan = { governance: { mode: 'DIRECT' }, participants: [], assets: [{ id: 'asset', fieldNames: ['password'] }] };
function selected(core: Record<string, unknown>) {
  const tools = new MetadataTools() as any;
  tools.selected = async () => ({ organizationId: 'org', core: { getPlan: async () => plan, ...core } });
  return tools as MetadataTools;
}

it('rejects ambiguous or duplicate AWS field mappings before opening a reveal', async () => {
  const tools = new MetadataTools();
  const base = { planId: 'plan', region: 'us-east-1', expectedAccountId: '123456789012', apply: true };
  await expect(tools.publishPlanFieldsToAws({ ...base, secretName: 'target', parameterPrefix: '/target',
    mappings: [{ selector: 'asset.password', key: 'PASSWORD' }] })).rejects.toThrow('automation_aws_publisher_input_invalid');
  await expect(tools.publishPlanFieldsToAws({ ...base, secretName: 'target', mappings: [
    { selector: 'asset.password', key: 'PASSWORD' }, { selector: 'asset.token', key: 'PASSWORD' },
  ] })).rejects.toThrow('automation_aws_publisher_input_invalid');
});

it('previews AWS target metadata without starting a reveal', async () => {
  vi.clearAllMocks();
  publisher.inspectSecret.mockResolvedValue({ target: 'target', exists: false });
  const withReveal = vi.fn();
  const tools = selected({ withReveal });
  expect(await tools.publishPlanFieldsToAws({ ...base, secretName: 'target', apply: false })).toMatchObject({
    destination: 'AWS_SECRETS_MANAGER', requiresApproval: true,
    mappings: [{ selector: 'asset.password', key: 'PASSWORD', target: 'target' }],
    inspection: [{ target: 'target', exists: false }],
  });
  expect(withReveal).not.toHaveBeenCalled();
  expect(publisher.publishSecret).not.toHaveBeenCalled();
});

it('applies through one reveal job and returns no protected value', async () => {
  vi.clearAllMocks();
  publisher.inspectSecret.mockResolvedValue({ target: 'target', exists: false });
  publisher.publishSecret.mockResolvedValue({ target: 'target', status: 'created', version: 'v1' });
  const consumeFields = vi.fn(async (_fields, deliver) => deliver([{ selector: 'asset.password', value: 'secret-value' }]));
  const withReveal = vi.fn(async (_planId, _options, work) => work({ session: { expiresAt: new Date(Date.now() + 60_000).toISOString() }, consumeFields }));
  const tools = selected({ withReveal });
  const started = await tools.publishPlanFieldsToAws({ ...base, secretName: 'target', apply: true }) as { jobId: string };
  await vi.waitFor(async () => expect((await tools.revealStatus(started.jobId)).status).toBe('DELIVERED'));
  expect(withReveal).toHaveBeenCalledTimes(1);
  expect(consumeFields).toHaveBeenCalledTimes(1);
  expect(publisher.publishSecret).toHaveBeenCalledWith('target', [{ key: 'PASSWORD', value: 'secret-value' }], expect.any(AbortSignal));
  expect(JSON.stringify([started, await tools.revealStatus(started.jobId)])).not.toContain('secret-value');
});

it('does not write when reveal governance fails', async () => {
  vi.clearAllMocks();
  publisher.inspectSecret.mockResolvedValue({ target: 'target', exists: false });
  const withReveal = vi.fn().mockRejectedValue(new Error('reveal_denied'));
  const tools = selected({ withReveal });
  const started = await tools.publishPlanFieldsToAws({ ...base, secretName: 'target', apply: true }) as { jobId: string };
  await vi.waitFor(async () => expect((await tools.revealStatus(started.jobId)).status).toBe('FAILED'));
  expect(publisher.publishSecret).not.toHaveBeenCalled();
});

it('reports an unknown AWS outcome if canceled during a write', async () => {
  vi.clearAllMocks();
  publisher.inspectSecret.mockResolvedValue({ target: 'target', exists: false });
  publisher.publishSecret.mockImplementation((_name, _entries, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('provider aborted')));
  }));
  const consumeFields = vi.fn(async (_fields, deliver) => deliver([{ selector: 'asset.password', value: 'secret-value' }]));
  const withReveal = vi.fn(async (_planId, _options, work) => work({ session: { expiresAt: new Date(Date.now() + 60_000).toISOString() }, consumeFields }));
  const tools = selected({ withReveal });
  const started = await tools.publishPlanFieldsToAws({ ...base, secretName: 'target', apply: true }) as { jobId: string };
  await vi.waitFor(() => expect(publisher.publishSecret).toHaveBeenCalledTimes(1));
  const status = await tools.revealStatus(started.jobId, true);
  expect(status).toMatchObject({ status: 'FAILED', code: 'automation_aws_publication_outcome_unknown' });
  expect(JSON.stringify(status)).not.toContain('secret-value');
});

it('reports SSM partial failure without exposing consumed values', async () => {
  vi.clearAllMocks();
  publisher.inspectParameter.mockResolvedValue({ exists: false });
  publisher.publishParameter.mockResolvedValueOnce({ target: '/target/FIRST', status: 'created', version: '1' })
    .mockRejectedValueOnce(new Error('provider response contains secret-value'));
  const consumeFields = vi.fn(async (fields, deliver) => deliver([{ selector: fields[0].selector, value: 'secret-value' }]));
  const withReveal = vi.fn(async (_planId, _options, work) => work({ session: { expiresAt: new Date(Date.now() + 60_000).toISOString() }, consumeFields }));
  const tools = selected({ getPlan: async () => ({ ...plan, assets: [{ id: 'asset', fieldNames: ['password', 'token'] }] }), withReveal });
  const started = await tools.publishPlanFieldsToAws({ ...base, parameterPrefix: '/target',
    mappings: [{ selector: 'asset.password', key: 'FIRST' }, { selector: 'asset.token', key: 'SECOND' }], apply: true }) as { jobId: string };
  await vi.waitFor(async () => expect((await tools.revealStatus(started.jobId)).status).toBe('FAILED'));
  expect(withReveal).toHaveBeenCalledTimes(1);
  expect(consumeFields).toHaveBeenCalledTimes(2);
  expect(publisher.publishParameter).toHaveBeenCalledTimes(2);
  expect(JSON.stringify([started, await tools.revealStatus(started.jobId)])).not.toContain('secret-value');
});
