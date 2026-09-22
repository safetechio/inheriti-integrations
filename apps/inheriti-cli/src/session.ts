import { createNodeIntegrationCore } from '@safetech/inheriti-elements-core/node';
import type { NodeIntegrationCore } from '@safetech/inheriti-elements-core/node';
import type { CliConfiguration } from './configuration.js';
import { FileOperatorSessionStore } from './session-store.js';
import { createCliMasterKeySource } from './master-keys.js';
import type { BusinessOrganization } from '@safetech/inheriti-elements-core/node';

export interface CliContext {
  core: NodeIntegrationCore;
  sessions: FileOperatorSessionStore;
  organization?: BusinessOrganization;
  keyOwner: 'Application' | 'Organisation';
}

/**
 * One composition point, so no command builds its own client or re-solves refresh.
 *
 * `client` selects which registration the operator signs in as. They differ in one thing that
 * matters: only the interactive one may open a governed reveal, because the API forbids a
 * device-authorization client from carrying the capability that allows it.
 */
export function createCliContext(
  configuration: CliConfiguration,
  sessionPath: string,
  client: 'interactive' | 'device' = 'interactive',
  organizationId?: string,
): CliContext {
  const sessions = new FileOperatorSessionStore(sessionPath);
  const source = createCliMasterKeySource(configuration);
  const core = createNodeIntegrationCore({
    apiUrl: configuration.apiUrl,
    ...(configuration.business ? { business: true as const, ...(organizationId ? { organizationId } : {}) }
      : { applicationId: configuration.applicationId! }),
    // Declared, not composed: the SDK decides between deriving and asking the device that holds the
    // key, and speaks the relay protocol. This host only says what it has.
    masterKey: source ? { source } : {},
    environment: configuration.environment,
    liveConfirmation: configuration.environment,
    configuration: {
      issuer: configuration.issuer,
      clientId: client === 'device' ? configuration.clientId : configuration.interactiveClientId,
      audience: configuration.business ? 'inheriti-integrations-api' : 'inheriti-elements-api',
      environment: configuration.environment,
      redirectUri: configuration.redirectUri,
      scopes: configuration.scopes,
    },
    sessions,
  });
  return { core, sessions, keyOwner: configuration.business ? 'Organisation' : 'Application' };
}
