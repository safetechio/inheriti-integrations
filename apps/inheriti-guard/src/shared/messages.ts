import type {
  AccessBatch,
  AccessFieldResult,
  AccessFieldSuggestion,
  FieldMapping,
  PageFirstFieldCandidate,
  PageFieldTarget,
  ProtectedFieldRef,
} from './access-contract.js';
import type { GuardActivityEntry, GuardSettings } from './guard-contract.js';

export interface ActivePageSummary {
  readonly origin: string;
  readonly usernameFields: number;
  readonly passwordFields: number;
}

export interface RevealFieldOption {
  readonly selector: string;
  readonly label: string;
  readonly fieldName: string;
  readonly matchesOrigin: boolean;
}

export interface PlanAssetMetadata {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly isBinary: boolean;
  readonly fieldNames: readonly string[];
  readonly fileName?: string;
  readonly mimeType?: string;
  readonly size?: number;
}

export type RevealViewState =
  | { readonly kind: 'IDLE' }
  | { readonly kind: 'READY'; readonly planId: string; readonly fields: readonly RevealFieldOption[] }
  // `expiresAt` is the reveal session lifetime; `gateExpiresAt` is only the currently active DMS,
  // authentication, or moderation window. The panel must not swap one for the other.
  | { readonly kind: 'RUNNING'; readonly message: string; readonly revealId?: string; readonly expiresAt?: string; readonly gateExpiresAt?: string }
  // A reveal this worker no longer runs but the server still holds open, waiting to be taken up.
  | { readonly kind: 'RESUMABLE'; readonly planId: string; readonly message: string }
  | { readonly kind: 'DONE'; readonly message: string }
  | { readonly kind: 'ERROR'; readonly message: string };

type ExistingSidePanelRequest =
  | { readonly type: 'get-active-context' }
  | { readonly type: 'inspect-active-page' }
  | { readonly type: 'sign-in' }
  | { readonly type: 'sign-out' }
  | { readonly type: 'load-plans' }
  | { readonly type: 'select-organization'; readonly organizationId: string }
  | { readonly type: 'load-plan-assets'; readonly planId: string }
  | { readonly type: 'load-reveal-fields'; readonly planId: string }
  | { readonly type: 'fill-field'; readonly planId: string; readonly selector: string }
  | { readonly type: 'get-reveal-state' }
  | { readonly type: 'cancel-reveal' }
  | { readonly type: 'resume-reveal' }
  | { readonly type: 'abort-plan-access'; readonly planId: string }
  | { readonly type: 'forget-master-key' };

export type AccessWorkspaceRequest =
  | { readonly type: 'load-access-workspace'; readonly planId: string }
  | { readonly type: 'load-page-first-candidates' }
  | { readonly type: 'start-page-first-picker' }
  | { readonly type: 'select-page-first-candidate'; readonly mapping: FieldMapping; readonly planName: string }
  | { readonly type: 'discard-access-workspace' }
  | { readonly type: 'start-page-field-picker'; readonly protectedField: ProtectedFieldRef }
  | { readonly type: 'cancel-page-field-picker' }
  | { readonly type: 'set-access-mapping'; readonly mapping: FieldMapping }
  | { readonly type: 'remove-access-mapping'; readonly selector: string }
  | { readonly type: 'reveal-and-autofill'; readonly batch: AccessBatch };

export type OverlayPermissionRequest =
  | { readonly type: 'get-overlay-permissions' }
  | { readonly type: 'enable-overlay-current-origin' }
  | { readonly type: 'disable-overlay-origin'; readonly origin: string }
  | { readonly type: 'disable-all-overlays' };

/** Content-script messages are a separate trust boundary and are validated against MessageSender. */
export type OverlayRequest =
  | { readonly type: 'overlay-load-candidates'; readonly target: PageFieldTarget }
  | { readonly type: 'overlay-select-candidate'; readonly mapping: FieldMapping; readonly planName: string }
  | { readonly type: 'overlay-reveal-and-autofill'; readonly batch: AccessBatch }
  // View state only: the same reveal phases the side panel polls, so the in-page card can show them.
  | { readonly type: 'overlay-reveal-state' }
  | { readonly type: 'overlay-discard-selection' }
  | { readonly type: 'overlay-cancel-reveal' }
  | { readonly type: 'overlay-resume-reveal' }
  | { readonly type: 'overlay-open-side-panel' };

export type SidePanelRequest = ExistingSidePanelRequest | AccessWorkspaceRequest | OverlayPermissionRequest;

export type GuardRequest =
  | { readonly type: 'guard:get-state' }
  | { readonly type: 'guard:set-protection'; readonly enabled: boolean }
  | { readonly type: 'guard:set-sensitive-api'; readonly enabled: boolean }
  | { readonly type: 'guard:set-clipboard'; readonly enabled: boolean }
  | { readonly type: 'guard:set-idle-lock'; readonly enabled: boolean }
  | { readonly type: 'guard:set-idle-minutes'; readonly minutes: number }
  | { readonly type: 'guard:set-download-trap'; readonly enabled: boolean }
  | { readonly type: 'guard:secure-logoff' }
  | { readonly type: 'activity:list' }
  | { readonly type: 'activity:clear' };

export type GuardContentRequest =
  | { readonly type: 'guard-content:get-state' }
  | { readonly type: 'guard-content:clipboard-copied' }
  | { readonly type: 'guard-content:csp-violation' }
  | { readonly type: 'guard-content:blocked'; readonly kind: 'clipboard-blocked' | 'sensitive-api-blocked' };

export type ExtensionRequest = SidePanelRequest | GuardRequest;

export type AccessWorkspaceResponse =
  | {
      readonly ok: true;
      readonly protectedFields: readonly ProtectedFieldRef[];
      readonly pageTargets: readonly PageFieldTarget[];
      readonly suggestions: readonly AccessFieldSuggestion[];
      readonly batch?: AccessBatch;
    }
  | {
      readonly ok: true;
      readonly pageTargets: readonly PageFieldTarget[];
      readonly candidates: readonly PageFirstFieldCandidate[];
      readonly emptyReason?: 'no-autofill-plans' | 'selected-plan-unavailable' | 'no-protected-fields' | 'no-matching-field';
      readonly batch?: AccessBatch;
    }
  | { readonly ok: true; readonly discarded: true }
  | { readonly ok: true; readonly batch: AccessBatch }
  | { readonly ok: true; readonly results: readonly AccessFieldResult[] }
  | { readonly ok: false; readonly error: 'invalid-access-batch' | 'stale-page-context' | 'picker-canceled' | 'access-request-failed' | 'signed-out' | 'guard-denied' };

/**
 * The panel is sent view state, never a session. Tokens stay in the service worker, so nothing the
 * panel renders — or a page could reach through it — carries a credential.
 */
export type PanelStateResponse = { readonly ok: true; readonly state: import('./plan-view.js').PanelState };

export type SidePanelResponse =
  | { readonly ok: true; readonly context?: { readonly origin: string } }
  | { readonly ok: true; readonly summary: ActivePageSummary }
  | { readonly ok: true; readonly assets: readonly PlanAssetMetadata[] }
  | PanelStateResponse
  | { readonly ok: true; readonly reveal: RevealViewState }
  | { readonly ok: true; readonly overlay: { readonly currentOrigin?: string; readonly currentEnabled: boolean; readonly enabledOrigins: readonly string[] } }
  | AccessWorkspaceResponse
  | { readonly ok: false; readonly error: 'no-active-tab' | 'stale-tab-context' | 'unsupported-page' | 'plan-request-failed' | 'guard-denied' };

export type GuardResponse =
  | { readonly ok: true; readonly guard: GuardSettings }
  | { readonly ok: true; readonly activity: readonly GuardActivityEntry[] }
  | { readonly ok: true; readonly cleared: true }
  | { readonly ok: false; readonly error: 'invalid-request' | 'operation-busy' | 'guard-operation-failed' };

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}

export function isGuardRequest(value: unknown): value is GuardRequest {
  const input = record(value);
  if (input === undefined || typeof input.type !== 'string') return false;
  if (['guard:get-state', 'guard:secure-logoff', 'activity:list', 'activity:clear'].includes(input.type)) {
    return Object.keys(input).length === 1;
  }
  if (['guard:set-protection', 'guard:set-sensitive-api', 'guard:set-clipboard', 'guard:set-idle-lock',
    'guard:set-download-trap'].includes(input.type)) {
    return Object.keys(input).length === 2 && typeof input.enabled === 'boolean';
  }
  return input.type === 'guard:set-idle-minutes' && Object.keys(input).length === 2
    && typeof input.minutes === 'number' && Number.isFinite(input.minutes);
}

export function isGuardContentRequest(value: unknown): value is GuardContentRequest {
  const input = record(value);
  if (input === undefined || typeof input.type !== 'string') return false;
  if (input.type === 'guard-content:get-state' || input.type === 'guard-content:clipboard-copied'
    || input.type === 'guard-content:csp-violation') {
    return Object.keys(input).length === 1;
  }
  return input.type === 'guard-content:blocked' && Object.keys(input).length === 2
    && (input.kind === 'clipboard-blocked' || input.kind === 'sensitive-api-blocked');
}

export function isSidePanelRequest(value: unknown): value is SidePanelRequest {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false;
  return ['get-active-context', 'inspect-active-page', 'sign-in', 'sign-out', 'load-plans', 'select-organization', 'load-plan-assets', 'load-reveal-fields', 'fill-field', 'get-reveal-state', 'cancel-reveal', 'resume-reveal', 'abort-plan-access', 'forget-master-key', 'load-access-workspace', 'load-page-first-candidates', 'start-page-first-picker', 'select-page-first-candidate', 'discard-access-workspace', 'start-page-field-picker', 'cancel-page-field-picker', 'set-access-mapping', 'remove-access-mapping', 'reveal-and-autofill', 'get-overlay-permissions', 'enable-overlay-current-origin', 'disable-overlay-origin', 'disable-all-overlays']
    .includes((value as { type: unknown }).type as string);
}

export function isOverlayRequest(value: unknown): value is OverlayRequest {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false;
  return ['overlay-load-candidates', 'overlay-select-candidate', 'overlay-reveal-and-autofill', 'overlay-reveal-state', 'overlay-cancel-reveal', 'overlay-resume-reveal', 'overlay-discard-selection', 'overlay-open-side-panel']
    .includes((value as { type: unknown }).type as string);
}
