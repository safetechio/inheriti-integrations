import { createNodeIntegrationCore } from '@safetech/inheriti-elements-core/node-base';
import type { NodeIntegrationCore, NodeIntegrationCoreOptions } from '@safetech/inheriti-elements-core/node-base';
import type { CliConfiguration } from './configuration.js';
import { FileOperatorSessionStore } from './session-store.js';
import { createCliMasterKeySource } from './master-keys.js';
import type { BusinessOrganization } from '@safetech/inheriti-elements-core/node-base';
import { createCliSafeKeyPro } from './safekey-pro.js';
import type { Terminal } from './output.js';
import { selectCliCustodianDevice } from './safekey-pro.js';
import { CliKeyVault } from './key-vault.js';

export interface CliContext {
  core: NodeIntegrationCore;
  authConfiguration: NodeIntegrationCoreOptions['configuration'];
  sessions: FileOperatorSessionStore;
  organization?: BusinessOrganization;
  keyOwner: 'Application' | 'Organisation';
  keyVault?: CliKeyVault;
  safeKeyPro?: ReturnType<typeof createCliSafeKeyPro>;
}

/** The two secret destinations need only this reveal capability. */
export type SecretRevealContext = Pick<CliContext, 'keyOwner' | 'safeKeyPro' | 'keyVault'> & {
  core: Pick<NodeIntegrationCore, 'getAccessToken' | 'getPlan' | 'withReveal'>;
};

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
  const keyVault: CliKeyVault = new CliKeyVault(sessionPath, configuration.apiUrl, configuration.environment, () => sessions.load());
  const sessions: FileOperatorSessionStore = new FileOperatorSessionStore(sessionPath, keyVault);
  const source = createCliMasterKeySource(configuration);
  const authConfiguration: NodeIntegrationCoreOptions['configuration'] = {
    issuer: configuration.issuer,
    clientId: client === 'device' ? configuration.clientId : configuration.interactiveClientId,
    audience: configuration.business ? 'inheriti-integrations-api' : 'inheriti-elements-api',
    environment: configuration.environment,
    redirectUri: configuration.redirectUri,
    scopes: configuration.scopes,
  };
  const core = createNodeIntegrationCore({
    apiUrl: configuration.apiUrl,
    ...(configuration.business ? { business: true as const, ...(organizationId ? { organizationId } : {}) }
      : { applicationId: configuration.applicationId! }),
    // Declared, not composed: the SDK decides between deriving and asking the device that holds the
    // key, and speaks the relay protocol. This host only says what it has.
    masterKey: source ? { source } : {},
    keyVault,
    environment: configuration.environment,
    liveConfirmation: configuration.environment,
    configuration: authConfiguration,
    sessions,
  });
  const safeKeyPro = createCliSafeKeyPro(configuration);
  return { core, authConfiguration, sessions, keyVault, keyOwner: configuration.business ? 'Organisation' : 'Application',
    ...(safeKeyPro ? { safeKeyPro } : {}) };
}

export function cliCustodianOptions(context: SecretRevealContext, terminal: Terminal, signal?: AbortSignal) {
  return context.safeKeyPro && terminal.interactive ? {
    proDevice: context.safeKeyPro,
    selectCustodianDevice: () => selectCliCustodianDevice(terminal, signal),
  } : {};
}
