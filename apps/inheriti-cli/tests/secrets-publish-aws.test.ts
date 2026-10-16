import { beforeEach, expect, it, vi } from 'vitest';

const { inspectSecret, publishSecret, inspectParameter, publishParameter, consumePlanFields, consumeFields, withReveal, revealed } = vi.hoisted(() => ({
  revealed: { value: 'VALUE_NEVER_PRINT' as unknown },
  inspectSecret: vi.fn(async (target: string) => ({ target, exists: false })),
  publishSecret: vi.fn(async (target: string) => ({ target, version: 'v1', status: 'created' })),
  inspectParameter: vi.fn(async (target: string) => ({ target, exists: false })),
  publishParameter: vi.fn(async (target: string) => ({ target, version: '1', status: 'created' })),
  consumePlanFields: vi.fn(async (_context, _terminal, _id, _plan, fields, _signal, callback) =>
    callback(fields.map((field: { selector: string }) => ({ selector: field.selector, value: revealed.value })))),
  consumeFields: vi.fn(async (fields, callback) => callback(fields.map((field: { selector: string }) =>
    ({ selector: field.selector, value: revealed.value })))),
  withReveal: vi.fn(async (_id, _options, callback) => callback({ consumeFields })),
}));
vi.mock('@safetech/inheriti-elements-core/node-base', async original => ({
  ...(await original<object>()), createAwsSecretPublisher: () => ({ inspectSecret, publishSecret, inspectParameter, publishParameter }),
}));
vi.mock('../src/commands/reveal.js', async original => ({
  ...(await original<object>()), loadRevealPlan: async () => ({ assets: [{ id: 'id', code: 'asset', fieldNames: ['one', 'two'] }] }),
  consumePlanFields,
}));
import { publishAwsSecrets } from '../src/commands/secrets-publish-aws.js';
import { requestCliCancel } from '../src/cancellation.js';

const terminal = () => ({ interactive: false, stdoutIsTTY: false, columns: 80, write: vi.fn(), writeError: vi.fn() });
const context = { core: { withReveal } } as never;
const base = ['--plan', 'plan-id', '--region', 'us-east-1', '--account-id', '123456789012'];
beforeEach(() => { vi.clearAllMocks(); revealed.value = 'VALUE_NEVER_PRINT'; });

it('previews secret metadata without revealing or publishing', async () => {
  const output = terminal();
  expect(await publishAwsSecrets(context, output, [...base, '--secret', 'app/config', '--map', 'ONE=asset.one'])).toBe(0);
  expect(inspectSecret).toHaveBeenCalledWith('app/config');
  expect(consumePlanFields).not.toHaveBeenCalled();
  expect(publishSecret).not.toHaveBeenCalled();
  expect(output.write.mock.calls.flat().join('')).not.toContain('VALUE_NEVER_PRINT');
});

it('publishes one JSON secret in one reveal action', async () => {
  const output = terminal();
  expect(await publishAwsSecrets(context, output, [...base, '--secret', 'app/config', '--map-all', '--apply'])).toBe(0);
  expect(consumePlanFields).toHaveBeenCalledTimes(1);
  expect(consumePlanFields.mock.calls[0]![4]).toEqual([
    { selector: 'asset.one', action: 'USE_FIELD', destination: 'AWS_SECRETS_MANAGER' },
    { selector: 'asset.two', action: 'USE_FIELD', destination: 'AWS_SECRETS_MANAGER' },
  ]);
  expect(publishSecret).toHaveBeenCalledWith('app/config', [
    { key: 'ASSET_ONE', value: 'VALUE_NEVER_PRINT' }, { key: 'ASSET_TWO', value: 'VALUE_NEVER_PRINT' },
  ], expect.any(AbortSignal));
  expect(output.write.mock.calls.flat().join('')).not.toContain('VALUE_NEVER_PRINT');
});

it('publishes each parameter in one reveal with separate actions and rejects invalid selections', async () => {
  const output = terminal();
  expect(await publishAwsSecrets(context, output, [...base, '--parameter-prefix', '/app', '--map-all', '--apply'])).toBe(0);
  expect(withReveal).toHaveBeenCalledTimes(1);
  expect(consumeFields).toHaveBeenCalledTimes(2);
  expect(consumeFields.mock.calls[0]![0]).toEqual([{ selector: 'asset.one', options: { action: 'USE_FIELD', destination: 'AWS_PARAMETER_STORE' } }]);
  expect(consumeFields.mock.calls[1]![0]).toEqual([{ selector: 'asset.two', options: { action: 'USE_FIELD', destination: 'AWS_PARAMETER_STORE' } }]);
  expect(publishParameter).toHaveBeenNthCalledWith(1, '/app/ASSET_ONE', 'VALUE_NEVER_PRINT', expect.any(AbortSignal));
  expect(publishParameter).toHaveBeenNthCalledWith(2, '/app/ASSET_TWO', 'VALUE_NEVER_PRINT', expect.any(AbortSignal));
  expect(await publishAwsSecrets(context, output, [...base, '--secret', 'app/config', '--parameter-prefix', '/app', '--map-all'])).toBe(1);
});

it('does not reveal or write after cancellation during target inspection', async () => {
  let finishInspection!: (value: { target: string; exists: boolean }) => void;
  inspectSecret.mockImplementationOnce(() => new Promise(resolve => { finishInspection = resolve; }));
  const pending = publishAwsSecrets(context, terminal(), [...base, '--secret', 'app/config', '--map-all', '--apply']);
  await vi.waitFor(() => expect(inspectSecret).toHaveBeenCalledTimes(1));
  requestCliCancel();
  finishInspection({ target: 'app/config', exists: false });
  await expect(pending).rejects.toThrow('automation_aws_publication_outcome_unknown');
  expect(consumePlanFields).not.toHaveBeenCalled();
  expect(publishSecret).not.toHaveBeenCalled();
});

it('rejects a missing reveal value before an AWS write', async () => {
  revealed.value = undefined;
  await expect(publishAwsSecrets(context, terminal(), [...base, '--secret', 'app/config', '--map', 'ONE=asset.one', '--apply']))
    .rejects.toThrow('automation_aws_publication_value_invalid');
  expect(publishSecret).not.toHaveBeenCalled();
});
