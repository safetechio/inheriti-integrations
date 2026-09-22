import { createNodeIntegrationCore } from '@safetech/inheriti-elements-core/node';
import type { NodeIntegrationCore } from '@safetech/inheriti-elements-core/node';
import type { OperatorSessionStore } from '@safetech/inheriti-elements-core';
import type { ExtensionConfiguration } from './configuration.js';
import type { SecretStorage } from 'vscode';
import { SecretStorageMasterKeySource } from './master-keys.js';

/** One composition point for the extension host, so no command builds its own client. */
export function createExtensionCore(
  configuration: ExtensionConfiguration,
  sessions: OperatorSessionStore,
  secrets: SecretStorage,
  organizationId?: string,
): NodeIntegrationCore {
  return createNodeIntegrationCore({
    apiUrl: configuration.apiUrl,
    ...(configuration.business ? { business: true as const, ...(organizationId ? { organizationId } : {}) }
      : { applicationId: configuration.applicationId! }),
    // Declared, not composed: with a passphrase stored the editor derives the key itself; without
    // one the SDK asks the device holding it. This host never chooses between the two.
    masterKey: { source: new SecretStorageMasterKeySource(configuration.masterKeySalt, secrets) },
    environment: configuration.environment,
    liveConfirmation: configuration.environment,
    sessions,
    configuration: {
      issuer: configuration.issuer,
      clientId: configuration.clientId,
      audience: configuration.business ? 'inheriti-integrations-api' : 'inheriti-elements-api',
      environment: configuration.environment,
      redirectUri: configuration.redirectUri,
      scopes: configuration.scopes,
    },
  });
}
