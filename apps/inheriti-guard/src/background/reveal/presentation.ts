import { hasRevealFailed, revealGateDeadline, revealProgressMessage } from '@safetech/inheriti-elements-core/browser';
import type { RevealProgress } from '@safetech/inheriti-elements-core/browser';
import type { RevealViewState } from '../../shared/messages.js';
import type { AccessBatch, AccessFieldResult, AccessFieldResultCode, FieldMapping } from '../../shared/access-contract.js';
import type { PlanForReveal, RevealSessionView } from './contracts.js';

/**
 * The panel's view of a reveal step. The sequence is the Client SDK's and the words are the shared
 * ones; the panel only decides whether a phase is still running or is an error to show as one.
 */
export function progressFor(progress: RevealProgress, keyOwner: 'Application' | 'Organisation', moderators: ReadonlyMap<string, string>): RevealViewState {
  const message = revealProgressMessage(progress, { keyOwner, moderators: [...moderators.values()], moderatorNamesById: moderators });
  if (hasRevealFailed(progress.phase)) return { kind: 'ERROR', message };
  // STARTING and WAITING_FOR_MASTER_KEY precede creation of a reveal session.
  const session = progress.session as RevealSessionView | undefined;
  const gateExpiresAt = revealGateDeadline(progress);
  return {
    kind: 'RUNNING',
    ...(session?.id === undefined ? {} : { revealId: session.id }),
    ...(session?.expiresAt === undefined ? {} : { expiresAt: session.expiresAt }),
    // The gate's own window travels beside the session's, never instead of it: `expiresAt` still
    // drives the recovery record and the deadline alarm.
    ...(gateExpiresAt === undefined ? {} : { gateExpiresAt }),
    message,
  };
}

export function errorCode(error: unknown): unknown {
  return (error as { code?: unknown; message?: unknown })?.code
    ?? (error as { message?: unknown })?.message;
}

export function messageFor(
  error: unknown,
  canceled: boolean,
  lastProgress: RevealProgress | undefined,
  keyOwner: 'Application' | 'Organisation',
  moderators: ReadonlyMap<string, string>,
): string {
  // The server's own explanation outranks the transport error and the generic fallback below.
  if (lastProgress?.phase === 'STOPPED_BY_DMS') {
    return 'The dead man\'s switch subject stopped this reveal. Nothing was released.';
  }
  if (lastProgress !== undefined && hasRevealFailed(lastProgress.phase)) {
    return revealProgressMessage(lastProgress, { keyOwner, moderatorNamesById: moderators });
  }
  const code = errorCode(error);
  if (code === 'SAFEKEY_PANEL_REQUIRED' || code === 'SAFEKEY_PANEL_CLOSED')
    return 'The SafeKey PRO window closed. Start a new reveal. If the share was not saved, you can choose SafeKey Mobile or PRO again.';
  if (canceled) return 'Reveal canceled.';
  if (code === 'SAFEKEY_ABORTED') return 'SafeKey PRO operation canceled.';
  if (code === 'SAFEKEY_NO_SPACE') return 'SafeKey PRO has no free space. Use SafeKey Desktop Tool to free space, then start a new reveal.';
  if (code === 'SAFEKEY_DEVICE_INFO_MISSING') return 'Could not set up SafeKey PRO. Retry the reveal.';
  if (code === 'reveal_restart_required')
    return 'A previous access cannot continue after the browser closed. Restart it to open this plan again; approvals will be requested again.';
  if (code === 'merge_process_already_active')
    return 'Another access is open for this plan. Finish it in the integration where it started, then try again.';
  if (typeof code === 'string' && code.startsWith('SAFEKEY_'))
    return 'SafeKey PRO could not read this plan. Check the device and try again.';
  if (code === 'action_origin_denied') return 'This page origin is not approved for autofill.';
  if (code === 'stale_tab_context') return 'The page changed before autofill. Reveal again on the current page.';
  if ((error as { name?: unknown })?.name === 'MasterKeyRequired') {
    return `The ${keyOwner} key is not available from SafeKey Mobile for this account.`;
  }
  return 'Reveal could not continue. Try again.';
}

export function moderatorsOf(plan: PlanForReveal): ReadonlyMap<string, string> {
  return new Map((plan.participants ?? [])
    .filter((participant) => participant.lifecycle === 'ACTIVE' && participant.relationships.includes('MODERATOR'))
    .map((participant) => [participant.id, participant.displayName]));
}

export function originOf(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
}

export function protectedFieldExists(plan: PlanForReveal, mapping: FieldMapping): boolean {
  const field = mapping.protectedField;
  const asset = plan.assets.find((candidate) => candidate.id === field.assetId);
  return asset !== undefined && !asset.isBinary
    && (asset.code ?? asset.id) === field.assetCode
    && asset.name === field.assetName
    && (asset.type ?? '') === field.assetType
    && asset.fieldNames.includes(field.fieldName)
    && field.selector === `${asset.code ?? asset.id}.${field.fieldName}`;
}

export function resultFor(mapping: FieldMapping, code: AccessFieldResultCode): AccessFieldResult {
  return { selector: mapping.protectedField.selector, targetId: mapping.pageTarget.targetId, code };
}

export function resultsFor(batch: AccessBatch, code: AccessFieldResultCode): readonly AccessFieldResult[] {
  return batch.mappings.map((mapping) => resultFor(mapping, code));
}

export function batchErrorCode(error: unknown, canceled: boolean): AccessFieldResultCode {
  if (canceled) return 'canceled';
  const code = (error as { code?: unknown })?.code;
  if (code === 'action_origin_denied') return 'authorization-denied';
  if (code === 'asset_not_found' || code === 'asset_field_not_found') return 'field-unavailable';
  if (code === 'asset_value_invalid') return 'invalid-value';
  return 'not-attempted';
}

export function deliveryFailureMessage(code: AccessFieldResultCode): string {
  if (code === 'page-address-changed') return 'The page address changed before autofill. Open the fields again on the current page.';
  if (code === 'form-changed') return 'The login form was replaced before autofill. Open the fields again.';
  if (code === 'tab-inactive') return 'Another tab became active in this window. Return to this page and try again.';
  if (code === 'authorization-denied') return 'Inheriti® Guard no longer has permission to autofill on this site.';
  if (code === 'field-unavailable') return 'A selected input is no longer editable. Open the fields again.';
  return 'Autofill could not write a selected field. No form was submitted.';
}

export function stableError(code: 'invalid-access-batch' | 'access-request-failed'): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}
