const {
  temporaryContext,
  stagedContext,
  retainContext,
  activeContext,
  accountKey,
} = require('../api-session.cjs');
const { apiFetch, ensureCsrf, revokeSession } = require('../api-transport.cjs');
const { disconnectBusinessSocket } = require('../business-socket.cjs');
const {
  SAFEID_URL,
  SAFEID_REALM,
  SAFEID_CLIENT_ID,
  decodeJwtPayload,
  requestJson,
} = require('./provider.cjs');
const { currentAuth, clearAuth } = require('./flow-state.cjs');

const API_ORIGIN = process.env.INHERITI_API_ORIGIN || '';
const AUTH_CALLBACK_PATH = '/oauth/callback';

async function handleAuthCallback(callbackUrl, auth) {
  if (currentAuth() !== auth) return false;
  let candidate;
  let target;
  let retained = false;
  let candidateAuthenticated = false;
  try {
    if (auth.cancelled) throw new Error('AUTH_CANCELLED');
    const callback = new URL(callbackUrl);
    const expectedCallback = new URL(auth.redirectUri);
    if (
      callback.origin !== expectedCallback.origin ||
      callback.hostname !== '127.0.0.1' ||
      callback.pathname !== AUTH_CALLBACK_PATH
    ) {
      throw new Error('AUTH_CALLBACK_INVALID');
    }
    if (callback.searchParams.get('state') !== auth.state) throw new Error('AUTH_STATE_MISMATCH');
    const code = callback.searchParams.get('code');
    if (!code) throw new Error(callback.searchParams.get('error') || 'AUTH_CODE_MISSING');
    const token = await requestJson(
      `${SAFEID_URL}/realms/${encodeURIComponent(SAFEID_REALM)}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: SAFEID_CLIENT_ID,
          redirect_uri: auth.redirectUri,
          code,
          code_verifier: auth.verifier,
        }).toString(),
      },
    );
    const accessToken = token.access_token;
    const claims = decodeJwtPayload(token.id_token || accessToken);
    if (!accessToken || !claims?.sub) throw new Error('AUTH_TOKEN_INVALID');
    if (auth.addAccount && activeContext()?.key === accountKey(claims.sub))
      throw new Error('AUTH_ACCOUNT_ALREADY_ACTIVE');
    // OAuth login runs in main and bypasses the renderer's api:request IPC
    // handler, so obtain the CSRF token explicitly before the forced-CSRF
    // Business API login endpoint.
    if (auth.cancelled) throw new Error('AUTH_CANCELLED');
    candidate = temporaryContext(claims.sub);
    await ensureCsrf(candidate);
    const response = await apiFetch({
      method: 'POST',
      path: '/user/login',
      context: candidate,
      body: {
        type: 'SAFEID',
        externalIdentifier: claims.sub,
        externalToken: accessToken,
        externalRefreshToken: token.refresh_token,
      },
    });
    // Ensure the persistent Chromium cookie store has committed the API
    // session before the renderer is allowed to reload or query its session.
    if (response.status < 200 || response.status >= 300) {
      const apiError =
        response.body?.message || response.body?.error || `API_LOGIN_${response.status}`;
      throw new Error(typeof apiError === 'string' ? apiError : `API_LOGIN_${response.status}`);
    }
    candidateAuthenticated = true;
    try {
      const access = await apiFetch({
        method: 'GET',
        path: '/integrations/tester-access',
        context: candidate,
      });
      if (access.status !== 200) {
        throw new Error(
          access.status === 403 && access.body?.error === 'integration_tester_required'
            ? 'You are not an integration tester. Contact developer support.'
            : 'Could not verify Inheriti Importer access. Please try again.',
        );
      }
    } catch (error) {
      throw error;
    }
    if (auth.cancelled) throw new Error('AUTH_CANCELLED');
    auth.committing = true;
    target = stagedContext(candidate.subject);
    const candidateCookies = await candidate.session.cookies.get({ url: API_ORIGIN });
    for (const cookie of candidateCookies) {
      await target.session.cookies.set({
        url: API_ORIGIN,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || '/',
        secure: !!cookie.secure,
        httpOnly: !!cookie.httpOnly,
        sameSite: cookie.sameSite,
        expirationDate: cookie.expirationDate,
      });
    }
    await target.session.cookies.flushStore();
    if (auth.addAccount && activeContext()?.key === candidate.key)
      throw new Error('AUTH_ACCOUNT_ALREADY_ACTIVE');
    if (!auth.addAccount) disconnectBusinessSocket();
    const previous = await retainContext(target, !auth.addAccount);
    retained = true;
    if (previous) {
      previous.revoked = true;
      const failed = await revokeSession(previous);
      if (failed) console.warn('[auth] replaced family could not be revoked');
      try {
        await previous.session.clearStorageData({ storages: ['cookies'] });
      } catch (error) {
        console.warn(
          '[auth] previous cookies could not be cleared:',
          error?.message || 'unknown error',
        );
      }
    }
    const descriptor = response.body?.result?.session ?? response.body?.result ?? null;
    auth.resolve(
      auth.addAccount
        ? { key: target.key, subject: target.subject, session: descriptor }
        : descriptor,
    );
    return true;
  } catch (error) {
    if (!auth.cancelled)
      auth.reject(error instanceof Error ? error : new Error('AUTH_LOGIN_FAILED'));
    return false;
  } finally {
    if (candidate && candidateAuthenticated && !retained) {
      const failed = await revokeSession(candidate);
      if (failed) console.warn('[auth] candidate family could not be revoked');
    }
    if (target && !retained) {
      try {
        await target.session.clearStorageData({ storages: ['cookies'] });
      } catch (error) {
        console.warn(
          '[auth] staged cookies could not be cleared:',
          error?.message || 'unknown error',
        );
      }
    }
    if (candidate) {
      try {
        await candidate.session.clearStorageData({ storages: ['cookies'] });
      } catch (error) {
        console.warn(
          '[auth] temporary cookies could not be cleared:',
          error?.message || 'unknown error',
        );
      }
    }
    clearAuth(auth);
  }
}

module.exports = { handleAuthCallback };
