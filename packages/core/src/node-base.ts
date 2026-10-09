import * as sdkNode from '@safetech/inheriti-client-sdk/node-base';
import { createNodeElementsClient, HttpElementsApiPort } from '@safetech/inheriti-client-sdk/node-base';
import { SocketIoSharedPlanEventListener } from '@safetech/inheriti-core-sdk/shared-configuration/vanilla';
import { io } from 'socket.io-client';
import type { DeclaredMasterKeySource, KeyVault, ListPlansInput, MasterKeyResolver, PlanDetail, PlanPage } from '@safetech/inheriti-client-sdk';
import { ElementsIntegrationCore } from './index.js';
import type { ElementsEnvironment, OperatorAuthFacade } from './index.js';
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
  keyVault?: KeyVault;
  auth?: OperatorAuthFacade;
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
  const auth = options.auth ?? composeOperatorAuth(nodeAuthRuntime, options);
  const bearer = async () => (await auth.getAccessToken()) ?? null;
  const elements = createNodeElementsClient({
    apiUrl: options.apiUrl,
    environment: options.environment,
    getBearerToken: bearer,
    ...(options.business ? { business: true as const, ...(options.organizationId !== undefined ? { organizationId: options.organizationId } : {}) }
      : { applicationId: options.applicationId }),
    ...(options.masterKeys ? { masterKeys: options.masterKeys } : {}),
    ...(options.keyVault ? { keyVault: options.keyVault } : {}),
    ...(options.masterKey ? { masterKey: options.masterKey } : {}),
    ...(options.fetchImpl ? { transport: options.fetchImpl } : {}),
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
      options.environment, bearer, options.fetchImpl ?? globalThis.fetch.bind(globalThis),
      options.organizationId !== undefined ? { organizationId: options.organizationId } : {}).listBusinessOrganizations() } } : {}),
    ...(options.business ? { internalBuilds: new HttpElementsApiPort(options.apiUrl,
      options.environment, bearer, options.fetchImpl ?? globalThis.fetch.bind(globalThis),
      options.organizationId !== undefined ? { organizationId: options.organizationId } : {}) } : {}),
    ...composeRevealWorkflows(elements),
  });
}

export { selectBusinessOrganization, BusinessOrganizationSelectionError } from '@safetech/inheriti-client-sdk/node-base';
export type { BusinessOrganization } from '@safetech/inheriti-client-sdk/node-base';
export type { InternalBuild, InternalBuildDownload } from '@safetech/inheriti-client-sdk/node-base';
export { latestIntegrationBuild } from './node-update.js';
export { suggestInboxTextAsset } from './inbox-text-asset-suggestion.js';
export type { InboxTextAssetSuggestion } from './inbox-text-asset-suggestion.js';
export { createQuickPlanOperations, quickPlanAssetCatalog } from './quick-plan.js';
export { localPlanAssetLimit } from './asset-metadata.js';
export { LocalPlanAssistant } from './local-plan-assistant.js';
export { LocalPlanSource, LocalPlanSources, localPlanInputLimits } from './local-plan-source.js';
export { LocalPlanDraftValue, localPlanQuestions, localPlanFieldMaxLength } from './local-plan-draft.js';
export { runLocalPlanBrowser } from './local-plan-browser.js';
export { createNativeWindowSession } from './node-native-window.js';
export { LlamaPlanModel } from './llama-plan-model.js';
export { localAssistantPaths, getLocalAssistantInstallStatus, installLocalAssistant } from './local-assistant-install.js';
export type { LocalAssistantInstallStatus, LocalAssistantInstallProgress } from './local-assistant-install.js';
export type { LocalPlanModel, LocalPlanModelRequest, LocalPlanDraft, LocalPlanClarification, LocalPlanHints, LocalSource, SourceReference } from './local-plan-assistant.js';
export { createPlanEditOperations } from './plan-edit.js';
export function createNodePlanEventListener(apiUrl: string, getBearerToken: () => Promise<string | null>) {
  const socket = io(new URL(apiUrl).origin, {
    autoConnect: false,
    auth: (callback) => {
      Promise.resolve().then(getBearerToken).then((token) => callback({ token: token ?? '' })).catch(() => callback({ token: '' }));
    },
  });
  const listener = new SocketIoSharedPlanEventListener(socket);
  return { listener, close: () => { listener.destroy(); socket.disconnect(); } };
}
export function createNodeInboxEventListener(apiUrl: string, getBearerToken: () => Promise<string | null>,
  onChange: (signal: { tenantId: string; conversationId: string; messageId: string; status: string; recipientStatus?: string; senderMemberId?: string; memberId?: string } | { tenantId: string; kind: 'PARTICIPANTS' } | { tenantId: string; kind: 'CONVERSATIONS'; conversationId?: string; action?: 'CREATED' | 'ADD' | 'REMOVE'; memberId?: string; memberName?: string; participantRevision?: number }) => void,
  onConnect: () => void, tenantId: string,
  onPresence: (snapshot: { tenantId: string; memberIds: string[]; checkedAt: string } | null) => void) {
  const socket = io(new URL(apiUrl).origin, {
    autoConnect: false,
    auth: (callback) => {
      Promise.resolve().then(getBearerToken).then((token) => callback({ token: token ?? '' })).catch(() => callback({ token: '' }));
    },
  });
  socket.on('inbox:changed', onChange);
  const heartbeat = () => socket.emit('inbox:presence:heartbeat', { tenantId });
  let interval: ReturnType<typeof setInterval> | undefined;
  socket.on('connect', () => {
    onConnect();
    heartbeat();
    interval = setInterval(heartbeat, 20_000);
  });
  socket.on('inbox:presence', (snapshot: { tenantId: string; memberIds: string[]; checkedAt: string }) => {
    if (snapshot?.tenantId === tenantId && Array.isArray(snapshot.memberIds) && !Number.isNaN(Date.parse(snapshot.checkedAt))) onPresence(snapshot);
  });
  socket.on('disconnect', () => { clearInterval(interval); interval = undefined; onPresence(null); });
  socket.connect();
  return () => { clearInterval(interval); socket.removeAllListeners(); socket.disconnect(); };
}
export { createOrganizationKeys } from './organization-keys.js';
export type { EditRecoveryRecord, EditRecoveryStore } from '@safetech/inheriti-client-sdk/node-base';
export type { QuickPlanInput } from '@safetech/inheriti-client-sdk/node-base';
export type { QuickPlanEditPhase, QuickPlanEditApprovalProgress } from '@safetech/inheriti-client-sdk/node-base';

export type { ListPlanLogsInput, OperatorSession, OperatorSessionStore, PlanDetail, PlanLog, PlanLogPage, PlanSummary } from './index.js';
export { revealModeOf } from './plans.js';
export { custodianShareCopy } from './custodian-copy.js';
export { createSafeKeyProPinSession, findSafeKeyProDevice, waitForSafeKeyProDevice } from './node-safekey-pro.js';
export { createNodeSafeKeyProDevice } from '@safetech/inheriti-core-sdk/node';
export { revealProgressMessage } from './reveal-progress.js';
export { BUSINESS_DEPLOYMENTS, BUSINESS_DEVICE_CLIENT_ID, BUSINESS_INTERACTIVE_CLIENT_ID, businessDeployment, businessUiRpId } from './deployment.js';

export type { OperatorAuthFacade } from './index.js';
export { MemoryOperatorSessionStore } from './operator-auth.js';
export { createNodeAutomationRevealClient } from '@safetech/inheriti-client-sdk/node-base';
export { readOrganizationPreferences, saveOrganizationPreferences } from './node-organization-preferences.js';
