import { createNodeIntegrationCore, INTEGRATION_AUTHORITY } from '@safetech/inheriti-elements-core/node-base';
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
 * Browser sign-in uses the interactive OAuth client; the plan still determines reveal policy.
 */
export function createCliContext(
  configuration: CliConfiguration,
  sessionPath: string,
  organizationId?: string,
): CliContext {
  const keyVault: CliKeyVault = new CliKeyVault(sessionPath, configuration.apiUrl, configuration.environment, () => sessions.load());
  const sessions: FileOperatorSessionStore = new FileOperatorSessionStore(sessionPath, keyVault, configuration.business, {
    apiUrl: configuration.apiUrl, issuer: configuration.issuer, clientId: configuration.interactiveClientId,
    audience: configuration.business ? 'inheriti-integrations-api' : 'inheriti-elements-api', environment: configuration.environment,
  });
  const source = createCliMasterKeySource(configuration);
  const authConfiguration: NodeIntegrationCoreOptions['configuration'] = {
    issuer: configuration.issuer,
    clientId: configuration.interactiveClientId,
    audience: configuration.business ? 'inheriti-integrations-api' : 'inheriti-elements-api',
    environment: configuration.environment,
    redirectUri: configuration.redirectUri,
    scopes: configuration.scopes,
  };
  const options: NodeIntegrationCoreOptions = {
    apiUrl: configuration.apiUrl,
    ...(configuration.business ? { business: true as const, businessAuthority: INTEGRATION_AUTHORITY, ...(organizationId ? { organizationId } : {}) }
      : { applicationId: configuration.applicationId! }),
    // Declared, not composed: the SDK decides between deriving and asking the device that holds the
    // key, and speaks the relay protocol. This host only says what it has.
    masterKey: source ? { source } : {},
    keyVault,
    environment: configuration.environment,
    liveConfirmation: configuration.environment,
    configuration: authConfiguration,
    sessions,
  };
  const initialCore = createNodeIntegrationCore(options);
  const core = configuration.business ? createNodeIntegrationCore({
    ...options,
    auth: {
      beginAuthorizationCode: (input) => initialCore.auth.beginAuthorizationCode(input),
      completeAuthorizationCode: (callback) => sessions.withExclusiveAccess(() => initialCore.auth.completeAuthorizationCode(callback)),
      beginDeviceAuthorization: () => initialCore.auth.beginDeviceAuthorization(),
      pollDeviceAuthorization: (signal) => sessions.withExclusiveAccess(() => initialCore.auth.pollDeviceAuthorization(signal)),
      getAccessToken: () => sessions.withExclusiveAccess(() => initialCore.auth.getAccessToken()),
      refresh: () => sessions.withExclusiveAccess(() => initialCore.auth.refresh()),
      clear: () => sessions.withExclusiveAccess(() => initialCore.auth.clear()),
    },
  }) : initialCore;
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
