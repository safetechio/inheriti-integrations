import type { GuardActivityEntry, GuardActivityKind } from '../../shared/guard-contract.js';

export const MAX_GUARD_ACTIVITY = 100;

export function sanitizedLocation(value: unknown): Pick<GuardActivityEntry, 'origin' | 'pathname'> {
  if (typeof value !== 'string') return {};
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return {};
    return { origin: url.origin, pathname: url.pathname.slice(0, 300) };
  } catch {
    return {};
  }
}

export function createGuardActivity(
  input: { kind: GuardActivityKind; url?: unknown; originOnly?: boolean },
  dependencies: { now: () => number; id: () => string } = { now: Date.now, id: () => crypto.randomUUID() },
): GuardActivityEntry {
  return {
    id: dependencies.id(),
    kind: input.kind,
    timestamp: dependencies.now(),
    ...(input.originOnly ? sanitizedOrigin(input.url) : sanitizedLocation(input.url)),
  };
}

function sanitizedOrigin(value: unknown): Pick<GuardActivityEntry, 'origin'> {
  const { origin } = sanitizedLocation(value);
  return origin === undefined ? {} : { origin };
}

export function prependBoundedActivity(
  entries: readonly GuardActivityEntry[],
  entry: GuardActivityEntry,
  limit = MAX_GUARD_ACTIVITY,
): GuardActivityEntry[] {
  return [entry, ...entries].slice(0, Math.max(0, limit));
}
