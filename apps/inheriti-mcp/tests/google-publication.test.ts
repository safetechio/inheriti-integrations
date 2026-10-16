import { expect, it, vi } from 'vitest';
import { MetadataTools } from '../src/server.js';

const publisher = vi.hoisted(() => ({ inspectSecret: vi.fn(), publishSecret: vi.fn() }));
vi.mock('@safetech/inheriti-elements-core/node-base', async original => ({
  ...await original<typeof import('@safetech/inheriti-elements-core/node-base')>(),
  createGoogleSecretPublisher: () => publisher,
}));
vi.mock('../src/safekey-pro.js', () => ({ openSafeKeyProPrompt: async () => ({ selectCustodianDevice: () => 'SK_MOBILE', close: () => undefined }) }));

const plan = { governance: { mode: 'DIRECT' }, participants: [], assets: [{ id: 'asset', fieldNames: ['password'] }] };
const input = { planId: 'plan', projectId: 'test-project', secretPrefix: 'app_',
  mappings: [{ selector: 'asset.password', key: 'PASSWORD' }] };
function selected(core: Record<string, unknown>) {
  const tools = new MetadataTools() as any;
  tools.selected = async () => ({ organizationId: 'org', core: { getPlan: async () => plan, ...core } });
  return tools as MetadataTools;
}

it('previews the Google target without revealing and applies through USE_FIELD', async () => {
  vi.clearAllMocks();
  publisher.inspectSecret.mockResolvedValue({ target: 'projects/test-project/secrets/app_PASSWORD', exists: false });
  publisher.publishSecret.mockResolvedValue({ target: 'projects/test-project/secrets/app_PASSWORD', version: '1', status: 'created' });
  const consumeFields = vi.fn(async (_fields, deliver) => deliver([{ selector: 'asset.password', value: 'VALUE_NEVER_PRINT' }]));
  const withReveal = vi.fn(async (_planId, _options, work) => work({ session: { expiresAt: new Date(Date.now() + 60_000).toISOString() }, consumeFields }));
  const tools = selected({ withReveal });
  expect(await tools.publishPlanFieldsToGoogleCloud({ ...input, apply: false })).toMatchObject({
    destination: 'GOOGLE_CLOUD_SECRET_MANAGER', requiresApproval: true,
    mappings: [{ selector: 'asset.password', key: 'PASSWORD', target: 'projects/test-project/secrets/app_PASSWORD' }],
  });
  expect(withReveal).not.toHaveBeenCalled();
  const started = await tools.publishPlanFieldsToGoogleCloud({ ...input, apply: true }) as { jobId: string };
  await vi.waitFor(async () => expect((await tools.revealStatus(started.jobId)).status).toBe('DELIVERED'));
  expect(consumeFields.mock.calls[0]?.[0]).toEqual([{ selector: 'asset.password',
    options: { action: 'USE_FIELD', destination: 'GOOGLE_CLOUD_SECRET_MANAGER' } }]);
  expect(publisher.publishSecret).toHaveBeenCalledWith('app_PASSWORD', 'VALUE_NEVER_PRINT', expect.any(AbortSignal));
  expect(JSON.stringify([started, await tools.revealStatus(started.jobId)])).not.toContain('VALUE_NEVER_PRINT');
});
