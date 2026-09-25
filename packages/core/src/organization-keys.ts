import { createNodeElementsClient } from '@safetech/inheriti-client-sdk/node';

export function createOrganizationKeys(options: {
  apiUrl: string;
  environment: 'TEST' | 'LIVE';
  getBearerToken: () => Promise<string | undefined>;
  fetchImpl?: typeof fetch;
}) {
  const clients = new Map<string, ReturnType<typeof createNodeElementsClient>>();
  return {
    resolve(organizationId: string, signal?: AbortSignal, onRelaySession?: () => void): Promise<string> {
      let client = clients.get(organizationId);
      if (!client) {
        client = createNodeElementsClient({
          apiUrl: options.apiUrl, environment: options.environment, business: true, organizationId,
          getBearerToken: async () => (await options.getBearerToken()) ?? null,
          ...(options.fetchImpl ? { transport: options.fetchImpl } : {}),
        });
        clients.set(organizationId, client);
      }
      return client.organizationMasterKey(signal, onRelaySession);
    },
    async clear(): Promise<void> {
      const held = Array.from(clients.values());
      clients.clear();
      await Promise.all(held.map((client) => client.forgetMasterKey()));
    },
  };
}
