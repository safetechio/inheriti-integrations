import type { BrowserIntegrationCore, PlanGovernanceView, RevealProgress, ScopedRevealHandle, ScopedRevealOptions, ScopedRevealProgress } from '@safetech/inheriti-elements-core/browser';
import type { AccessBatch } from '../../shared/access-contract.js';

export const RECOVERY_KEY = 'inheriti.openReveal';
export const RELAY_KEY = 'inheritiGuard.pendingKeyRelay';
export type RelayOwner = { issuer: string; subject: string; organizationId: string };
export type RelayRecovery = RelayOwner & { planId: string; sessionId: string; expiresAt: string };
/**
 * How long a reveal stays resumable before its record is treated as abandoned.
 *
 * The server's own session lifetime replaces this the moment there is one; it only covers the window
 * between "the operator asked" and "the reveal exists", which is exactly where a relayed master key
 * makes a person go and answer a phone.
 */
export const RECOVERY_WINDOW_MS = 10 * 60_000;
export const DEADLINE_ALARM = 'inheriti.revealDeadline';
export const ALLOWED_FIELDS = new Set(['username', 'email', 'password']);

/** The shared progress shape, narrowed to the identity and lifetime this host always receives. */
export type RevealSessionView = ScopedRevealProgress & { readonly id: string; readonly expiresAt: string };

/**
 * What a restarted worker needs to take an open reveal back up.
 *
 * A governed reveal outlives the worker that started it — the access is the merge process, and the
 * server hands the same one back to the next `start` — so the intent that opened it is worth as much
 * as its id. Plaintext is never part of this: it was memory-only and is gone.
 */
export interface RevealRecovery {
  readonly planId: string;
  readonly deadline: string;
  readonly revealId?: string;
  readonly message?: string;
  readonly intent:
    | { readonly kind: 'FIELD'; readonly selector: string; readonly origin: string; readonly tabId: number }
    | { readonly kind: 'BATCH'; readonly batch: AccessBatch };
}

export interface ChromeRevealCore extends BrowserIntegrationCore {
  withReveal<TResult>(
    planId: string,
    options: {
      mode?: 'DIRECT' | 'GOVERNED';
      signal?: AbortSignal;
      onProgress?: (progress: RevealProgress) => void;
      onSession?: (session: RevealSessionView) => void;
      onRelaySession?: ScopedRevealOptions['onRelaySession'];
      selectCustodianDevice?: ScopedRevealOptions['selectCustodianDevice'];
      proDevice?: ScopedRevealOptions['proDevice'];
    },
    // The handle the SDK actually passes. It was narrowed here to the two members this host uses,
    // which never type-checked: a callback that accepts less than what is passed is unsound in a
    // parameter position, so the narrowing made `ChromeRevealCore` stop extending the core it
    // describes. What this host may *do* with a reveal is bounded by the capabilities its
    // registration carries, not by hiding methods from a type.
    work: (reveal: ScopedRevealHandle) => Promise<TResult>,
  ): Promise<TResult>;
}

export type ProOptions = Pick<ScopedRevealOptions, 'selectCustodianDevice' | 'proDevice'> & { finish(): void };

export interface PlanForReveal extends PlanGovernanceView {
  readonly participants?: readonly { readonly id: string; readonly displayName: string; readonly relationships: readonly string[]; readonly lifecycle: string }[];
  readonly assets: readonly {
    readonly id: string;
    readonly code?: string;
    readonly name: string;
    readonly type?: string;
    readonly isBinary: boolean;
    readonly fieldNames: readonly string[];
    readonly matchOrigins?: readonly string[];
  }[];
}
