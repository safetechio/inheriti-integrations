import { createNodeIntegrationCore } from '@safetech/inheriti-elements-core/node';
import type { NodeIntegrationCore } from '@safetech/inheriti-elements-core/node';
import type { CliConfiguration } from './configuration.js';
import { FileOperatorSessionStore } from './session-store.js';
import { createCliMasterKeySource } from './master-keys.js';
import type { BusinessOrganization } from '@safetech/inheriti-elements-core/node';
import { createCliSafeKeyPro } from './safekey-pro.js';
import type { Terminal } from './output.js';
import { selectCliCustodianDevice } from './safekey-pro.js';

export interface CliContext {
  core: NodeIntegrationCore;
  sessions: FileOperatorSessionStore;
  organization?: BusinessOrganization;
  keyOwner: 'Application' | 'Organisation';
  safeKeyPro?: ReturnType<typeof createCliSafeKeyPro>;
}

/**
 * One composition point, so no command builds its own client or re-solves refresh.
 *
 * `client` selects the registered OAuth flow. Business accepts both verified client IDs;
 * reveal policy and the signed client ID still bind each session on the server.
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
  const safeKeyPro = createCliSafeKeyPro(configuration);
  return { core, sessions, keyOwner: configuration.business ? 'Organisation' : 'Application',
    ...(safeKeyPro ? { safeKeyPro } : {}) };
}

export function cliCustodianOptions(context: CliContext, terminal: Terminal, signal?: AbortSignal) {
  return context.safeKeyPro && terminal.interactive ? {
    proDevice: context.safeKeyPro,
    selectCustodianDevice: () => selectCliCustodianDevice(terminal, signal),
  } : {};
}
