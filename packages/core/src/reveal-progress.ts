import type { RevealPhase, RevealProgress } from '@safetech/inheriti-client-sdk';

/**
 * One sentence per phase, addressed to the person waiting.
 *
 * The sequence itself is not decided here — the Client SDK runs the reveal and names the phase, the
 * way the Core SDK names its reveal steps for Business. What lives here is only the wording, shared
 * so the CLI, the editor and the browser panel say the same thing about the same moment. A host that
 * needs different words switches on `phase` instead of calling this.
 */
export function revealProgressMessage(
  progress: RevealProgress,
  options: { moderators?: readonly string[] } = {},
): string {
  // This workspace may consume the last published Client SDK while preparing the next additive
  // phase. Keep the shared renderer forward-compatible; hosts still receive one SDK-owned stream.
  const phase = progress.phase as RevealPhase | 'WAITING_FOR_CUSTODIAN_CLAIM';
  const { session } = progress;
  // Reported before the reveal exists, so it is the one phase with no session to describe: the key
  // that opens the plan is resolved first, ahead of governance and ahead of any one-shot release.
  if (phase === 'WAITING_FOR_MASTER_KEY') {
    return 'Release the Application key in SafeKey Mobile. This reveal will continue when it arrives.';
  }
  if (phase === 'STARTING') return 'Opening the plan.';
  if (phase === 'STOPPED_BY_DMS') return 'The dead man\'s switch subject stopped this reveal. Nothing was released.';
  if (phase === 'WAITING_FOR_DMS') {
    return `Waiting for the dead man's switch${untilDeadline(session?.dmsExpiresAt)}. The designated person can stop `
      + 'this reveal from SafeKey Mobile; otherwise it continues on its own.';
  }
  if (phase === 'WAITING_FOR_AUTHENTICATION') return 'Confirm this access on SafeKey Mobile. The request was sent to your device.';
  if (phase === 'WAITING_FOR_MODERATION') return moderationMessage(progress, options.moderators ?? []);
  if (phase === 'WAITING_FOR_CUSTODIAN_CLAIM') {
    return 'Claim the custodian share in SafeKey Mobile. It must be stored there before this reveal can continue.';
  }
  if (phase === 'WAITING_FOR_CUSTODIAN') {
    return 'Approve the custodian request using SafeKey Mobile. This reveal will continue when the share arrives.';
  }
  if (phase === 'RELEASING_MATERIAL') return 'Collecting encrypted data shares.';
  if (phase === 'RECONSTRUCTING') return 'Reconstructing and decrypting shares.';
  if (phase === 'OPEN') return 'Revealing the data.';
  if (phase === 'DENIED') return 'Access denied.';
  if (phase === 'EXPIRED') return 'Access expired.';
  if (phase === 'PARTICIPANT_REVOKED') return 'Access is no longer available because a participant was revoked.';
  if (phase === 'RECONCILIATION_REQUIRED') return 'Access is temporarily unavailable. Try again later.';
  if (phase === 'ENDED') return 'Reveal could not continue.';
  return 'Waiting for this reveal to continue…';
}

/** Nothing more will happen on this reveal, whether or not anything was released. */
export function hasRevealEnded(phase: RevealPhase): boolean {
  return phase === 'OPEN' || phase === 'STOPPED_BY_DMS' || phase === 'ENDED' || hasRevealFailed(phase);
}

/** The reveal ended without releasing anything, which a host may present as an error. */
export function hasRevealFailed(phase: RevealPhase): boolean {
  return phase === 'DENIED' || phase === 'EXPIRED'
    || phase === 'PARTICIPANT_REVOKED' || phase === 'RECONCILIATION_REQUIRED';
}

/** The active governance gate's server-owned deadline, if this phase has one. */
export function revealGateDeadline(progress: RevealProgress): string | undefined {
  if (progress.phase === 'WAITING_FOR_DMS') return progress.session?.dmsExpiresAt;
  if (progress.phase === 'WAITING_FOR_AUTHENTICATION' || progress.phase === 'WAITING_FOR_MODERATION') {
    return progress.session?.governanceExpiresAt;
  }
  return undefined;
}

/** A display-only remainder. The server still decides when the gate actually expires. */
export function revealGateCountdown(progress: RevealProgress, now = Date.now()): string | undefined {
  const deadline = revealGateDeadline(progress);
  if (!deadline) return undefined;
  const remaining = new Date(deadline).getTime() - now;
  if (!Number.isFinite(remaining)) return undefined;
  const seconds = Math.max(0, Math.ceil(remaining / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function moderationMessage(progress: RevealProgress, moderators: readonly string[]): string {
  const { approvedModerators, requiredModerators } = progress.session ?? {};
  if (approvedModerators === undefined || requiredModerators === undefined) {
    return 'Waiting for moderator approval. Approval requests were sent to all plan moderators via SafeKey Mobile.';
  }
  const people = moderators.length === 0 ? '' : ` Moderators: ${moderators.join(', ')}.`;
  return `Waiting for moderators (${approvedModerators} of ${requiredModerators} approved).${people}`;
}

/**
 * A stable absolute instant rather than a ticking remainder: these lines are printed once into a
 * transcript or a notification, not repainted, and UTC reads the same wherever it lands. A deadline
 * the caller has not been given is simply not mentioned.
 */
function untilDeadline(deadline: string | undefined): string {
  if (!deadline) return '';
  const at = new Date(deadline);
  if (Number.isNaN(at.getTime())) return '';
  return ` until ${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
