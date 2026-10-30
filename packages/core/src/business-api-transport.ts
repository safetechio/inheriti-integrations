import type { OperatorAuthFacade } from './index.js';

const recoveryFlights = new Map<string, Promise<void>>();

/** Refresh a rejected Business access token once for read requests from the same session. */
export function businessApiTransport(apiUrl: string, auth: OperatorAuthFacade, transport: typeof fetch): typeof fetch {
  const base = new URL(apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`);
  return async (input, init) => {
    const response = await transport(input, init);
    if (response.status !== 401 || init?.method?.toUpperCase() !== 'GET' || !(input instanceof URL)
      || input.origin !== base.origin || !input.pathname.startsWith(base.pathname) || init.signal?.aborted) return response;
    const headers = new Headers(init.headers);
    const rejected = headers.get('authorization')?.match(/^Bearer (.+)$/iu)?.[1];
    const session = rejected && sessionOf(rejected);
    if (!session) return response;

    const key = JSON.stringify([base.href, session.sub, session.sid, rejected]);
    let flight = recoveryFlights.get(key);
    if (!flight) {
      flight = Promise.resolve().then(async () => {
        if (await auth.getAccessToken() === rejected) await auth.refresh();
      }).finally(() => { if (recoveryFlights.get(key) === flight) recoveryFlights.delete(key); });
      recoveryFlights.set(key, flight);
    }
    await flight;
    const replacement = await auth.getAccessToken();
    if (!replacement || replacement === rejected || !sameSession(rejected, replacement)) return response;
    init.signal?.throwIfAborted();
    await response.body?.cancel();
    headers.set('authorization', `Bearer ${replacement}`);
    return transport(input, { ...init, headers });
  };
}

function sessionOf(token: string): { sub: string; sid: string } | undefined {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/gu, '+').replace(/_/gu, '/'))) as Record<string, unknown>;
    return typeof payload.sub === 'string' && payload.sub && typeof payload.sid === 'string' && payload.sid
      ? { sub: payload.sub, sid: payload.sid } : undefined;
  } catch { return undefined; }
}

function sameSession(before: string, after: string): boolean {
  const a = sessionOf(before);
  const b = sessionOf(after);
  return a !== undefined && b !== undefined && a.sub === b.sub && a.sid === b.sid;
}
