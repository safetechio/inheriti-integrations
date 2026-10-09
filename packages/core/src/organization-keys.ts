import { createNodeElementsClient } from '@safetech/inheriti-client-sdk/node-base';
import type { KeyVault } from '@safetech/inheriti-client-sdk/node-base';

export function createOrganizationKeys(options: {
  apiUrl: string;
  environment: 'TEST' | 'LIVE';
  getBearerToken: () => Promise<string | undefined>;
  fetchImpl?: typeof fetch;
  keyVault?: KeyVault & { clearMemory(): void; forgetAccount(): Promise<void>; withScope<T>(run: () => Promise<T>): Promise<T> };
}) {
  const clients = new Map<string, ReturnType<typeof createNodeElementsClient>>();
  return {
    resolve(organizationId: string, signal?: AbortSignal, onRelaySession?: () => void): Promise<string> {
      let client = clients.get(organizationId);
      if (!client) {
        client = createNodeElementsClient({
          apiUrl: options.apiUrl, environment: options.environment, business: true, organizationId,
          getBearerToken: async () => (await options.getBearerToken()) ?? null,
          ...(options.keyVault ? { keyVault: options.keyVault } : {}),
          ...(options.fetchImpl ? { transport: options.fetchImpl } : {}),
        });
        clients.set(organizationId, client);
      }
      return options.keyVault
        ? options.keyVault.withScope(() => client.organizationMasterKey(signal, onRelaySession))
        : client.organizationMasterKey(signal, onRelaySession);
    },
    async clear(): Promise<void> {
      const held = Array.from(clients.values());
      clients.clear();
      if (options.keyVault) options.keyVault.clearMemory();
      else await Promise.all(held.map((client) => client.forgetMasterKey()));
    },
    async forget(): Promise<void> {
      if (options.keyVault) await options.keyVault.forgetAccount();
      else await Promise.all(Array.from(clients.values()).map((client) => client.forgetMasterKey()));
      clients.clear();
    },
  };
}
