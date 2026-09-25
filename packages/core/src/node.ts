import * as sdkNode from '@safetech/inheriti-client-sdk/node';
import { createNodeElementsClient, HttpElementsApiPort } from '@safetech/inheriti-client-sdk/node';
import type { DeclaredMasterKeySource, ListPlansInput, MasterKeyResolver, PlanDetail, PlanPage } from '@safetech/inheriti-client-sdk';
import { ElementsIntegrationCore } from './index.js';
import type { ElementsEnvironment } from './index.js';
import { SdkPlanFacade } from './plans.js';
import { composeOperatorAuth } from './operator-auth.js';
import type { OperatorAuthOptions, OperatorAuthRuntime } from './operator-auth.js';
import { composeRevealWorkflows } from './workflows.js';

/**
 * The SDK's Node entry exports the operator-auth runtime, but its `node.d.ts` re-exports the module
 * as a directory, which `node16` resolution cannot follow — so the values are real at runtime and
 * invisible to the type checker. Types come from the barrel, values from here (D028).
 */
const nodeAuthRuntime = sdkNode as unknown as OperatorAuthRuntime;

export type NodeIntegrationCoreOptions = OperatorAuthOptions & {
  apiUrl: string;
  environment: ElementsEnvironment;
  masterKeys?: MasterKeyResolver;
  /**
   * What custody this host holds locally: a passphrase-derived key, key material it already has, or
   * nothing. The Client SDK composes acquisition around it — a host that can derive never asks
   * anyone, and one that cannot asks the device holding the key. A host never chooses between them.
   */
  masterKey?: { source?: DeclaredMasterKeySource };
  liveConfirmation?: string;
} & ({ applicationId: string; business?: never; organizationId?: never }
  | { business: true; organizationId?: string; applicationId?: never });

export type NodeIntegrationCore = ElementsIntegrationCore<ListPlansInput, PlanPage, PlanDetail>;

/**
 * One call from a Node host (CLI, VS Code extension host) to a composed core: real PKCE/device
 * login, real single-flight refresh, and real plan reads against Elements. The bearer token is
 * pulled from the auth client per request, so a refresh mid-session is invisible to the host.
 */
export function createNodeIntegrationCore(options: NodeIntegrationCoreOptions): NodeIntegrationCore {
  const auth = composeOperatorAuth(nodeAuthRuntime, options);
  const bearer = async () => (await auth.getAccessToken()) ?? null;
  const elements = createNodeElementsClient({
    apiUrl: options.apiUrl,
    environment: options.environment,
    getBearerToken: bearer,
    ...(options.business ? { business: true as const, ...(options.organizationId !== undefined ? { organizationId: options.organizationId } : {}) }
      : { applicationId: options.applicationId }),
    ...(options.masterKeys ? { masterKeys: options.masterKeys } : {}),
    ...(options.masterKey ? { masterKey: options.masterKey } : {}),
    ...(options.fetchImpl ? { transport: options.fetchImpl } : {}),
  });
  return new ElementsIntegrationCore<ListPlansInput, PlanPage, PlanDetail>({
    environment: options.environment,
    ...(options.liveConfirmation === undefined ? {} : { liveConfirmation: options.liveConfirmation }),
    auth,
    elements: new SdkPlanFacade(elements),
    scopedReveals: elements,
    masterKeys: elements,
    ...(options.business ? { organizations: { listOrganizations: () => new HttpElementsApiPort(options.apiUrl,
      options.environment, bearer, options.fetchImpl ?? globalThis.fetch.bind(globalThis),
      options.organizationId !== undefined ? { organizationId: options.organizationId } : {}).listBusinessOrganizations() } } : {}),
    ...(options.business ? { internalBuilds: new HttpElementsApiPort(options.apiUrl,
      options.environment, bearer, options.fetchImpl ?? globalThis.fetch.bind(globalThis),
      options.organizationId !== undefined ? { organizationId: options.organizationId } : {}) } : {}),
    ...composeRevealWorkflows(elements),
  });
}

export { selectBusinessOrganization, BusinessOrganizationSelectionError } from '@safetech/inheriti-client-sdk/node';
export type { BusinessOrganization } from '@safetech/inheriti-client-sdk/node';
export type { InternalBuild, InternalBuildDownload } from '@safetech/inheriti-client-sdk/node';
export { latestIntegrationBuild } from './node-update.js';
export { createQuickPlanOperations, quickPlanAssetCatalog } from './quick-plan.js';
export { createPlanEditOperations } from './plan-edit.js';
export { createOrganizationKeys } from './organization-keys.js';
export type { EditRecoveryRecord, EditRecoveryStore } from '@safetech/inheriti-client-sdk/node';
export type { QuickPlanInput } from '@safetech/inheriti-client-sdk/node';
export type { QuickPlanEditPhase } from '@safetech/inheriti-client-sdk/node';

export type { ListPlanLogsInput, OperatorSession, OperatorSessionStore, PlanDetail, PlanLog, PlanLogPage, PlanSummary } from './index.js';
export { revealModeOf } from './plans.js';
export { custodianShareCopy } from './custodian-copy.js';
export { createSafeKeyProPinSession, findSafeKeyProDevice, waitForSafeKeyProDevice } from './node-safekey-pro.js';
export { createNodeSafeKeyProDevice } from '@safetech/inheriti-core-sdk/node';
export { revealProgressMessage } from './reveal-progress.js';
export { BUSINESS_DEPLOYMENTS, BUSINESS_DEVICE_CLIENT_ID, BUSINESS_INTERACTIVE_CLIENT_ID, businessDeployment, businessUiRpId } from './deployment.js';
