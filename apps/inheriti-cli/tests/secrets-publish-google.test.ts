import { beforeEach, expect, it, vi } from 'vitest';

const { inspectSecret, publishSecret, consumeFields, withReveal } = vi.hoisted(() => ({
  inspectSecret: vi.fn(async (secretId: string) => ({ target: `projects/test-project/secrets/${secretId}`, exists: false })),
  publishSecret: vi.fn(async (secretId: string) => ({ target: secretId, version: 'v1', status: 'created' })),
  consumeFields: vi.fn(async (fields, callback) => callback(fields.map((field: { selector: string }) => ({ selector: field.selector, value: 'VALUE_NEVER_PRINT' })))),
  withReveal: vi.fn(async (_id, _options, callback) => callback({ consumeFields })),
}));
vi.mock('@safetech/inheriti-elements-core/google-secret-publisher', () => ({
  createGoogleSecretPublisher: () => ({ inspectSecret, publishSecret }),
}));
vi.mock('../src/commands/reveal.js', async original => ({
  ...(await original<object>()), loadRevealPlan: async () => ({ assets: [{ id: 'id', code: 'asset', fieldNames: ['one'] }] }),
}));
import { publishGoogleSecrets } from '../src/commands/secrets-publish-google.js';
const terminal = () => ({ interactive: false, stdoutIsTTY: false, columns: 80, write: vi.fn(), writeError: vi.fn() });
const context = { core: { withReveal } } as never;
const base = ['--plan', 'plan-id', '--project', 'test-project', '--secret-prefix', 'app_'];
beforeEach(() => vi.clearAllMocks());

it('previews exact Google targets without revealing values', async () => {
  const output = terminal();
  expect(await publishGoogleSecrets(context, output, [...base, '--map', 'PASSWORD=asset.one'])).toBe(0);
  expect(inspectSecret).toHaveBeenCalledWith('app_PASSWORD');
  expect(withReveal).not.toHaveBeenCalled();
  expect(publishSecret).not.toHaveBeenCalled();
  expect(output.write.mock.calls.flat().join('')).not.toContain('VALUE_NEVER_PRINT');
});

it('publishes through the existing reveal action without outputting values', async () => {
  const output = terminal();
  expect(await publishGoogleSecrets(context, output, [...base, '--map-all', '--apply'])).toBe(0);
  expect(consumeFields.mock.calls[0]?.[0]).toEqual([{ selector: 'asset.one',
    options: { action: 'USE_FIELD', destination: 'GOOGLE_CLOUD_SECRET_MANAGER' } }]);
  expect(publishSecret).toHaveBeenCalledWith('app_ASSET_ONE', 'VALUE_NEVER_PRINT', expect.any(AbortSignal));
  expect(output.write.mock.calls.flat().join('')).not.toContain('VALUE_NEVER_PRINT');
});
