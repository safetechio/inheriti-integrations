import { expect, it, vi } from 'vitest';
import { HttpClientFactory } from '@safetech/inheriti-core-sdk/vanilla';
import { mainOwnedBearerRequestStrategy } from '@modules/_shared/infrastructure/transport/main-owned-bearer-request-strategy';

it('sends a Core mutation without a browser CSRF preflight', async () => {
  const transport = vi.fn(async () => new Response('{}', { status: 200 }));
  const client = HttpClientFactory.create({
    apiUrl: 'https://business.example',
    requestStrategy: mainOwnedBearerRequestStrategy,
    transport,
  });

  await client.fetchData('https://business.example/integrations/v1/organizations', {
    method: 'POST', body: '{}',
  });

  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport.mock.calls[0][0]).toBe('https://business.example/integrations/v1/organizations');
  expect(transport.mock.calls[0][1]?.credentials).toBe('omit');
});
