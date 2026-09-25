import { createBrowserElementsClient, HttpElementsApiPort } from '@safetech/inheriti-client-sdk/browser';
import type { BrowserElementsClientOptions } from '@safetech/inheriti-client-sdk/browser';
import type { DeclaredMasterKeySource, ListPlansInput, MasterKeyResolver, PlanDetail, PlanPage } from '@safetech/inheriti-client-sdk';
import { ElementsIntegrationCore } from './index.js';
import type { ElementsEnvironment, OperatorAuthFacade } from './index.js';
import { SdkPlanFacade } from './plans.js';
import { createOperatorAuth } from './auth.js';
import type { OperatorAuthOptions } from './operator-auth.js';
import { composeRevealWorkflows } from './workflows.js';

export type BrowserIntegrationCoreOptions = OperatorAuthOptions & {
  apiUrl: string;
  environment: ElementsEnvironment;
  /**
   * How this host obtains the Application's master key. Elements never holds it, so a host that
   * cannot produce one can read plans but cannot open them — which surfaces as `MasterKeyRequired`
   * naming the reference, not as a missing capability.
   */
  masterKeys?: MasterKeyResolver;
  /**
   * What custody this host holds locally: a passphrase-derived key, key material it already has, or
   * nothing. The Client SDK composes acquisition around it — a host that can derive never asks
   * anyone, and one that cannot asks the device holding the key. A host never chooses between them.
   */
  masterKey?: { source?: DeclaredMasterKeySource };
  liveConfirmation?: string;
  /** Passed through to reconstruction; a host with no `Worker` (MV3) omits it. */
  reconstruction?: BrowserElementsClientOptions['reconstruction'];
} & ({ applicationId: string; business?: never; organizationId?: never }
  | { business: true; organizationId?: string; applicationId?: never });

export type BrowserIntegrationCore = ElementsIntegrationCore<ListPlansInput, PlanPage, PlanDetail>;

/**
 * The browser counterpart of `createNodeIntegrationCore`, for a Chrome extension or any other
 * bundled host — including a real scoped reveal.
 *
 * It builds the SDK's browser Elements client rather than the Node one, which reaches Core's Node
 * entry and its worker thread. A reveal needs neither: the transport is injected, reconstruction
 * runs on WebCrypto over the platform-neutral SSDP v2 processor, and the Core SDK container the
 * Node client carries is used only by plan *creation*, which this client does not offer (D033).
 *
 * Everything comes from the SDK's `/browser` entry, never its root barrel: that barrel re-exports
 * the React-flavoured Core SDK, so importing from it put react, react-dom, zustand and
 * @tanstack/react-query into an MV3 service worker that has no DOM to render into.
 */
export function createBrowserIntegrationCore(options: BrowserIntegrationCoreOptions): BrowserIntegrationCore {
  const auth: OperatorAuthFacade = createOperatorAuth(options);
  const bearer = async () => (await auth.getAccessToken()) ?? null;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const bearerTransport: typeof fetch = (input, init) => fetchImpl(input, { ...init, credentials: 'omit' });
  const elements = createBrowserElementsClient({
    apiUrl: options.apiUrl,
    environment: options.environment,
    getBearerToken: bearer,
    ...(options.business ? { business: true as const, ...(options.organizationId !== undefined ? { organizationId: options.organizationId } : {}) }
      : { applicationId: options.applicationId }),
    ...(options.masterKeys ? { masterKeys: options.masterKeys } : {}),
    ...(options.masterKey ? { masterKey: options.masterKey } : {}),
    transport: bearerTransport,
    ...(options.reconstruction === undefined ? {} : { reconstruction: options.reconstruction }),
  });
  return new ElementsIntegrationCore<ListPlansInput, PlanPage, PlanDetail>({
    environment: options.environment,
    ...(options.liveConfirmation === undefined ? {} : { liveConfirmation: options.liveConfirmation }),
    auth,
    elements: new SdkPlanFacade(elements),
    scopedReveals: elements,
    masterKeys: { forgetMasterKey: (ref) => elements.forgetMasterKey(ref),
      hasMasterKey: async (ref) => (await elements.keyVault.load(ref)) !== undefined,
      cancelMasterKeyRelaySession: (sessionId) => elements.cancelMasterKeyRelaySession(sessionId) },
    ...(options.business ? { organizations: { listOrganizations: () => new HttpElementsApiPort(options.apiUrl,
      options.environment, bearer, bearerTransport,
      options.organizationId !== undefined ? { organizationId: options.organizationId } : {}).listBusinessOrganizations() } } : {}),
    ...composeRevealWorkflows(elements),
  });
}

export { selectBusinessOrganization, BusinessOrganizationSelectionError } from '@safetech/inheriti-client-sdk/browser';
export type { BusinessOrganization } from '@safetech/inheriti-client-sdk/browser';

// Browser hosts read the same reveal progress shape as Node hosts; re-exported here so a bundled
// service worker never has to reach past its own entry to name a DMS gate.
export { custodianShareCopy, hasRevealEnded, hasRevealFailed, revealGateCountdown, revealGateDeadline, revealModeOf, revealProgressMessage, stoppedByDeadManSwitch } from './index.js';
export type { ListPlanLogsInput, PlanGovernanceView, PlanLog, PlanLogPage, RevealPhase, RevealProgress, ScopedRevealHandle, ScopedRevealOptions, ScopedRevealProgress } from './index.js';
export { BUSINESS_DEPLOYMENTS, BUSINESS_INTERACTIVE_CLIENT_ID, businessDeployment, businessUiRpId } from './deployment.js';
