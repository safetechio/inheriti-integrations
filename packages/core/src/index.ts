import type { MasterKeyRef, RevealActionOutcome, RevealActionType as SdkRevealActionType, RevealProgress } from '@safetech/inheriti-client-sdk';
import type { OpenRevealOptions } from '@safetech/inheriti-client-sdk/browser';

export type RevealActionDestination = 'STDIN' | 'ENVIRONMENT' | 'FILE_DESCRIPTOR' | 'LOCAL_SOCKET' | 'TEMPORARY_FILE' | 'LOCAL_BROWSER';
export type IntegrationRevealActionType = SdkRevealActionType | 'USE_FIELD';

export const ELEMENTS_INTEGRATION_CONTRACT_VERSION = 'elements.integration.v1' as const;
export type ElementsEnvironment = 'TEST' | 'LIVE';

export class LiveEnvironmentConfirmationRequired extends Error {
  constructor() { super('live_environment_confirmation_required'); this.name = 'LiveEnvironmentConfirmationRequired'; }
}

export function assertEnvironmentAllowed(environment: ElementsEnvironment, liveConfirmation?: string): void {
  if (environment === 'LIVE' && liveConfirmation !== 'LIVE') throw new LiveEnvironmentConfirmationRequired();
}

/**
 * What Elements needs to know about where an authorized action lands.
 *
 * Not who the host is. Elements gates `AUTOFILL_FIELD` on the `origin-bound-autofill` capability and
 * `INSERT_FIELD` on `editor-insert`, both carried by the operator principal's own registration, so a
 * host neither declares nor benefits from naming itself. The one thing it must state is the exact
 * origin an origin-bound action targets, which Elements matches against the registered action origins.
 */
export interface HostInteractionContext {
  origin?: string;
  destination?: RevealActionDestination;
}

export interface RevealWorkflowPort {
  start(planId: string, mode: 'DIRECT' | 'GOVERNED', idempotencyKey: string): Promise<{ revealId: string; status: string }>;
  status(revealId: string): Promise<{ revealId: string; status: string }>;
  close(revealId: string, reason: 'COMPLETED' | 'CANCELED' | 'ERROR'): Promise<void>;
}

export interface InteractionWorkflowPort {
  authorize(input: { revealId: string; assetId: string; action: IntegrationRevealActionType; fieldName?: string; context: HostInteractionContext; idempotencyKey: string }): Promise<{ id: string }>;
  report(input: { revealId: string; actionId: string; outcome: RevealActionOutcome; errorCode?: string; idempotencyKey: string }): Promise<void>;
}

/** Deliberately structural so hosts can inject the public Client SDK without re-exporting its contract. */
export interface OperatorAuthFacade {
  beginAuthorizationCode(): Promise<{ authorizationUrl: string; expiresAt: number }>;
  completeAuthorizationCode(callbackUrl: string): Promise<unknown>;
  beginDeviceAuthorization(): Promise<unknown>;
  pollDeviceAuthorization(signal?: AbortSignal): Promise<unknown>;
  getAccessToken(): Promise<string | undefined>;
  refresh(): Promise<unknown>;
  clear(): Promise<void>;
}
export interface OperatorSessionFacade {
  list(): Promise<readonly unknown[]>;
  revoke(sessionId: string): Promise<void>;
  logout(): Promise<void>;
}
export interface PlanFacade<TListInput, TPage, TDetail> {
  listPlans(input?: TListInput): Promise<TPage>;
  getPlan(planId: string): Promise<TDetail>;
  listPlanLogs(planId: string, input?: import('@safetech/inheriti-client-sdk').ListPlanLogsInput): Promise<import('@safetech/inheriti-client-sdk').PlanLogPage>;
  abortPlanAccess(planId: string): Promise<{ aborted: boolean }>;
}

export interface BusinessOrganizationFacade {
  listOrganizations(): Promise<import('@safetech/inheriti-client-sdk').BusinessOrganization[]>;
}

export interface InternalBuildFacade {
  listInternalBuilds(): Promise<import('@safetech/inheriti-client-sdk/node').InternalBuild[]>;
  requestInternalBuildDownload(id: string): Promise<import('@safetech/inheriti-client-sdk/node').InternalBuildDownload>;
}

export interface ScopedRevealHandle {
  readonly session: { id: string; expiresAt: string };
  field<TValue = unknown>(selector: string, options?: {
    action?: 'VIEW_FIELD' | 'COPY_FIELD' | 'USE_FIELD' | 'AUTOFILL_FIELD' | 'INSERT_FIELD' | 'DELIVER_FIELD';
    destination?: RevealActionDestination;
    origin?: string;
    idempotencyKey?: string;
  }): Promise<TValue>;
  consumeFields(fields: ReadonlyArray<{
    selector: string;
    options?: {
      action?: 'VIEW_FIELD' | 'COPY_FIELD' | 'USE_FIELD' | 'AUTOFILL_FIELD' | 'INSERT_FIELD' | 'DELIVER_FIELD';
      destination?: RevealActionDestination;
      origin?: string;
      idempotencyKey?: string;
    };
  }>, destination: (fields: ReadonlyArray<{ selector: string; value: unknown }>) => void | Promise<void>): Promise<void>;
  exportAsset(selector: string, destination: (asset: { id: string; fileName?: string; mimeType?: string; bytes: Uint8Array }) => void | Promise<void>): Promise<void>;
}

/**
 * What a host may render while a scoped reveal is still being authorized.
 *
 * One shape for every host, so CLI, VS Code and Chrome do not each keep a partial copy that silently
 * drops a field the server sent. `stage` stays `string`: reveal stages are additive, and a host that
 * treats an unfamiliar one as a failure turns a healthy reveal into a broken one.
 *
 * The two deadlines are not interchangeable. `dmsExpiresAt` is the dead-man's-switch gate's own
 * window and is present only while that gate is pending; `expiresAt` is the reveal session's
 * lifetime and is what a host must keep using for cleanup, recovery, and any post-authorization
 * material countdown.
 */
export interface ScopedRevealProgress {
  readonly stage: string;
  readonly id?: string;
  readonly expiresAt?: string;
  readonly dmsExpiresAt?: string;
  readonly approvedModerators?: number;
  readonly requiredModerators?: number;
  readonly moderators?: ReadonlyArray<{ id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' }>;
  /**
   * Which governance layer the reveal is stopped at, in the order they run. One waiting stage covers
   * all of them, so without this a host cannot tell whose action it is waiting for. Absent past
   * governance, and absent from a server older than the field.
   */
  readonly governanceGate?: 'DMS' | 'AUTHENTICATION' | 'MODERATION';
  readonly deniedBy?: 'AUTHENTICATION' | 'MODERATION';
  readonly governanceExpiresAt?: string;
  readonly closedReason?: string;
}

export interface ScopedRevealOptions extends Partial<Pick<OpenRevealOptions, 'selectCustodianDevice' | 'proDevice'>> {
  mode?: 'DIRECT' | 'GOVERNED';
  /** Every step of the reveal, named by the Client SDK that runs it. */
  onProgress?: (progress: RevealProgress) => void;
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** How often to re-read a reveal still waiting on its gates. Defaults to the SDK's own interval. */
  pollIntervalMs?: number;
  onSession?: (session: ScopedRevealProgress) => void;
}

/**
 * The server's own explanation for a reveal that ended because the dead-man's-switch subject
 * answered. Named once here so no host infers it from a bare `CANCELED` stage, and so a generic
 * catch handler has something specific to preserve.
 */
export function stoppedByDeadManSwitch(session: ScopedRevealProgress | undefined): boolean {
  return session?.closedReason === 'DMS_RESET';
}

/**
 * Giving up a held master key.
 *
 * The Client SDK holds a resolved key for the life of the client — a whole editor window, or a
 * browser service worker — which is what stops a second reveal asking a phone again. A host offers
 * this as a "lock" action, and it is the only way to watch acquisition happen twice.
 */
export interface MasterKeyFacade {
  forgetMasterKey(ref?: MasterKeyRef): Promise<void>;
}

export interface ScopedRevealFacade {
  withReveal<TResult>(
    planId: string,
    options: ScopedRevealOptions,
    work: (reveal: ScopedRevealHandle) => Promise<TResult>,
  ): Promise<TResult>;
}

export interface IntegrationCoreOptions<TListInput, TPage, TDetail> {
  environment: ElementsEnvironment;
  liveConfirmation?: string;
  auth: OperatorAuthFacade;
  sessions?: OperatorSessionFacade;
  elements: PlanFacade<TListInput, TPage, TDetail>;
  reveals?: RevealWorkflowPort;
  interactions?: InteractionWorkflowPort;
  scopedReveals?: ScopedRevealFacade;
  masterKeys?: MasterKeyFacade;
  organizations?: BusinessOrganizationFacade;
  internalBuilds?: InternalBuildFacade;
}

/** Composition only: protocol and product behavior stay in the Client SDK and Elements API. */
export class ElementsIntegrationCore<TListInput, TPage, TDetail> {
  readonly environment: ElementsEnvironment;
  readonly auth: OperatorAuthFacade;
  readonly sessions: OperatorSessionFacade | undefined;
  readonly reveals: RevealWorkflowPort | undefined;
  readonly interactions: InteractionWorkflowPort | undefined;
  private readonly scopedReveals: ScopedRevealFacade | undefined;
  private readonly masterKeys: MasterKeyFacade | undefined;
  private readonly organizations: BusinessOrganizationFacade | undefined;
  private readonly internalBuilds: InternalBuildFacade | undefined;
  private readonly elements: PlanFacade<TListInput, TPage, TDetail>;

  constructor(options: IntegrationCoreOptions<TListInput, TPage, TDetail>) {
    assertEnvironmentAllowed(options.environment, options.liveConfirmation);
    this.environment = options.environment;
    this.auth = options.auth;
    this.sessions = options.sessions;
    this.elements = options.elements;
    this.reveals = options.reveals;
    this.interactions = options.interactions;
    this.scopedReveals = options.scopedReveals;
    this.masterKeys = options.masterKeys;
    this.organizations = options.organizations;
    this.internalBuilds = options.internalBuilds;
  }

  getAccessToken(): Promise<string | undefined> { return this.auth.getAccessToken(); }
  listInternalBuilds(): Promise<import('@safetech/inheriti-client-sdk/node').InternalBuild[]> {
    if (!this.internalBuilds) throw new Error('business_context_required');
    return this.internalBuilds.listInternalBuilds();
  }
  requestInternalBuildDownload(id: string): Promise<import('@safetech/inheriti-client-sdk/node').InternalBuildDownload> {
    if (!this.internalBuilds) throw new Error('business_context_required');
    return this.internalBuilds.requestInternalBuildDownload(id);
  }
  listOrganizations(): Promise<import('@safetech/inheriti-client-sdk').BusinessOrganization[]> {
    if (!this.organizations) throw new Error('business_context_required');
    return this.organizations.listOrganizations();
  }
  /** Drops the held master key so the next reveal acquires it again. Nothing to do if none is held. */
  async forgetMasterKey(ref?: MasterKeyRef): Promise<void> { await this.masterKeys?.forgetMasterKey(ref); }
  listPlans(input?: TListInput): Promise<TPage> { return this.elements.listPlans(input); }
  getPlan(planId: string): Promise<TDetail> { return this.elements.getPlan(planId); }
  listPlanLogs(planId: string, input?: import('@safetech/inheriti-client-sdk').ListPlanLogsInput): Promise<import('@safetech/inheriti-client-sdk').PlanLogPage> { return this.elements.listPlanLogs(planId, input); }
  /**
   * Gives up the governed access this operator holds on a plan.
   *
   * A governed access outlives the reveal that opened it, and the next reveal takes it up where it
   * stopped. A host offers this for the other case: the access is not wanted, and the next reveal
   * should start clean. `aborted: false` means there was nothing open.
   */
  abortPlanAccess(planId: string): Promise<{ aborted: boolean }> { return this.elements.abortPlanAccess(planId); }
  withReveal<TResult>(
    planId: string,
    options: Parameters<ScopedRevealFacade['withReveal']>[1],
    work: (reveal: ScopedRevealHandle) => Promise<TResult>,
  ): Promise<TResult> {
    if (!this.scopedReveals) throw new Error('scoped_reveal_facade_required');
    return this.scopedReveals.withReveal(planId, options, work);
  }

  async performAuthorizedInteraction<TResult>(
    input: Parameters<InteractionWorkflowPort['authorize']>[0],
    action: () => Promise<TResult>,
  ): Promise<TResult> {
    if (!this.interactions) throw new Error('interaction_workflow_port_required');
    const authorized = await this.interactions.authorize(input);
    try {
      const result = await action();
      await this.interactions.report({ revealId: input.revealId, actionId: authorized.id, outcome: 'SUCCEEDED', idempotencyKey: input.idempotencyKey });
      return result;
    } catch (error) {
      await this.interactions.report({ revealId: input.revealId, actionId: authorized.id, outcome: 'FAILED', errorCode: stableErrorCode(error), idempotencyKey: input.idempotencyKey });
      throw error;
    }
  }
}

export function createElementsIntegrationCore<TListInput, TPage, TDetail>(options: IntegrationCoreOptions<TListInput, TPage, TDetail>): ElementsIntegrationCore<TListInput, TPage, TDetail> {
  return new ElementsIntegrationCore(options);
}

function stableErrorCode(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' && /^[a-z][a-z0-9_]{2,63}$/u.test(code) ? code : 'host_action_failed';
}

export { JwksOperatorTokenValidator, MemoryOAuthTransactionStore, MemoryOperatorSessionStore, OperatorTokenInvalid } from './operator-auth.js';
export { PlanRequestFailed, SdkPlanFacade, asPlanRequestFailed, revealModeOf } from './plans.js';
export { composeRevealWorkflows } from './workflows.js';
export { hasRevealEnded, hasRevealFailed, moderatorDisplayName, revealGateCountdown, revealGateDeadline, revealProgressMessage } from './reveal-progress.js';
export type { SdkRevealWorkflow } from './workflows.js';
export type { ElementsPlanFacade, PlanGovernanceView, SdkPlanReader } from './plans.js';

/**
 * Relay is deliberately absent from this barrel.
 *
 * Obtaining a master key from the device holding it belongs to the Client SDK, which composes it
 * behind `masterKey.source`; no host builds one. Re-exporting `RelayMasterKeySource` as a *value*
 * would also drag the SDK's root barrel into every consumer of this module — and through
 * `browser.ts` into an MV3 service worker, which is what the Chrome host's boundary rule forbids and
 * what `verify-chrome-security.mjs` exists to catch. Types are erased and stay below.
 */

/**
 * The SDK contract types a host needs to name. Re-exported here so no host declares a dependency on
 * the Client SDK itself: `packages/core` stays the single seam (S31/V1).
 */
export type {
  DeviceAuthorization, DeviceTransaction, ListPlansInput, OperatorAuthConfiguration, OperatorSession,
  RevealPhase, RevealProgress,
  DeclaredMasterKeySource, MasterKeyRef, MasterKeyResolver, MasterKeySource, OperatorSessionStore, OperatorSessionSummary, OperatorTokenValidator,
  BusinessOrganization, ListPlanLogsInput, PlanDetail, PlanLog, PlanLogPage, PlanPage, PlanSummary, RevealActionOutcome, RevealActionType, ValidatedOperatorToken,
} from '@safetech/inheriti-client-sdk';
