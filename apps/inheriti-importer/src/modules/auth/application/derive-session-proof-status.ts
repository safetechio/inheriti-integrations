import type { AuthSessionStatus } from '@shared/infrastructure/importer-api';

export type SessionProofStatus =
  'checking' | 'ready' | 'expired' | 'replaced' | 'offline' | 'error';

export interface DeriveSessionProofStatusInput {
  cookieStatus: AuthSessionStatus;
  /** The cookie-session status observed on the previous render, or `null` on first mount. */
  previousCookieStatus: AuthSessionStatus | null;
  isOnline: boolean;
}

/**
 * Reduces the Importer's `useAuthenticatedCookieSession` status (IDLE / CONFIRMING /
 * AUTHENTICATED / EXPIRED / ERROR — see `AppAuthSessionManager`) plus browser
 * online/offline state to the states the Importer's post-login gate must show.
 *
 * `IDLE` is ambiguous on its own: it is both the pre-confirmation boot state
 * and where the manager lands after `SESSION_REPLACED`/`LOGGED_OUT` broadcasts
 * from another window (`app-auth-session-manager.ts`'s `receive()` — both
 * collapse to `IDLE` there, so this layer cannot distinguish them further).
 * Only a drop FROM `AUTHENTICATED`/`CONFIRMING` TO `IDLE` means "this window
 * was signed in and lost that session without pressing sign out here" — i.e.
 * replaced or logged out elsewhere. A first-mount `IDLE` (no previous status)
 * is ordinary boot-time confirmation, not a loss.
 */
export function deriveSessionProofStatus({
  cookieStatus,
  previousCookieStatus,
  isOnline,
}: DeriveSessionProofStatusInput): SessionProofStatus {
  switch (cookieStatus) {
    case 'AUTHENTICATED':
      return 'ready';
    case 'CONFIRMING':
      return 'checking';
    case 'EXPIRED':
      return 'expired';
    case 'ERROR':
      return isOnline ? 'error' : 'offline';
    case 'IDLE':
      return previousCookieStatus === 'AUTHENTICATED' || previousCookieStatus === 'CONFIRMING'
        ? 'replaced'
        : 'checking';
    default:
      return 'checking';
  }
}
