import { expect, it, vi } from 'vitest';
import { createGoogleSecretPublisher } from '../src/google-secret-publisher.js';

const missing = { code: 5 };
const client = () => ({
  getSecret: vi.fn(async (): Promise<unknown[]> => { throw missing; }),
  createSecret: vi.fn(async () => [{}]),
  addSecretVersion: vi.fn(async () => [{ name: 'projects/test-project/secrets/APP_SECRET/versions/1' }]),
});

it('previews without writing and creates a labelled secret on apply', async () => {
  const api = client();
  const publisher = createGoogleSecretPublisher({ projectId: 'test-project', client: api as never });
  expect(await publisher.inspectSecret('APP_SECRET')).toEqual({ target: 'projects/test-project/secrets/APP_SECRET', exists: false });
  expect(api.createSecret).not.toHaveBeenCalled();
  const result = await publisher.publishSecret('APP_SECRET', 'VALUE_NEVER_PRINT');
  expect(result).toEqual({ target: 'projects/test-project/secrets/APP_SECRET', version: 'projects/test-project/secrets/APP_SECRET/versions/1', status: 'created' });
  expect(api.createSecret).toHaveBeenCalledWith({ parent: 'projects/test-project', secretId: 'APP_SECRET',
    secret: { replication: { automatic: {} }, labels: { inheriti_managed: 'true' } } });
  expect(api.addSecretVersion).toHaveBeenCalledWith({ parent: 'projects/test-project/secrets/APP_SECRET',
    payload: { data: Buffer.from('VALUE_NEVER_PRINT') } });
});

it('refuses to update an unowned secret or publish after cancellation', async () => {
  const api = client();
  api.getSecret.mockImplementation(async () => [{ labels: {} }]);
  const publisher = createGoogleSecretPublisher({ projectId: 'test-project', client: api as never });
  await expect(publisher.publishSecret('APP_SECRET', 'value')).rejects.toThrow('google_secret_not_managed');
  expect(api.addSecretVersion).not.toHaveBeenCalled();
  api.getSecret.mockImplementation(async () => [{ labels: { inheriti_managed: 'true' } }]);
  const controller = new AbortController();
  controller.abort();
  await expect(publisher.publishSecret('APP_SECRET', 'value', controller.signal)).rejects.toThrow('google_secret_publication_canceled');
  expect(api.addSecretVersion).not.toHaveBeenCalled();
});
