const { handle } = require('../lib/ipc-guard.cjs');
const {
  activeContext,
  captureActiveContext,
  isCurrent,
  contextForKey,
  activateContext,
  removeContext,
  removeAllContexts,
  listContexts,
} = require('../lib/api-session.cjs');
const { apiFetch, authCookieNames, revokeSession } = require('../lib/api-transport.cjs');
const { disconnectBusinessSocket } = require('../lib/business-socket.cjs');
const {
  loginWithSafeID,
  cancelPendingAuth,
  cancelPendingAuthAndWait,
} = require('../lib/safeid-auth.cjs');

function register(sessionsReady) {
  let activationRevision = 0;

  handle('auth:login', async () => {
    await sessionsReady;
    ++activationRevision;
    return loginWithSafeID();
  });

  handle('auth:add', async () => {
    await sessionsReady;
    return loginWithSafeID(true);
  });

  handle('auth:accounts', async () => {
    await sessionsReady;
    return listContexts();
  });

  handle('auth:destinations', async () => {
    await sessionsReady;
    const accounts = listContexts();
    const results = await Promise.all(
      accounts.map(async ({ key, subject }) => {
        const context = contextForKey(key);
        if (!context) return null;
        let response;
        try {
          response = await apiFetch({ method: 'GET', path: '/organizations', context });
        } catch (error) {
          if (contextForKey(key) !== context || context.revoked) return null;
          throw error;
        }
        if (contextForKey(key) !== context || context.revoked) return null;
        if (response.status === 401 || response.status === 403)
          return {
            context,
            accountKey: key,
            subject,
            status: 'sign_in_required',
            organizations: [],
          };
        if (response.status !== 200) throw new Error('AUTH_DESTINATIONS_FAILED');
        const items = response.body?.result?.items;
        if (!Array.isArray(items)) throw new Error('AUTH_DESTINATIONS_INVALID');
        return {
          context,
          accountKey: key,
          subject,
          status: 'ready',
          organizations: items
            .filter((item) => typeof item?.id === 'string' && typeof item?.name === 'string')
            .map((item) => ({ id: item.id, name: item.name })),
        };
      }),
    );
    return results
      .filter(
        (result) =>
          result && contextForKey(result.accountKey) === result.context && !result.context.revoked,
      )
      .map(({ accountKey, subject, status, organizations }) => ({
        accountKey,
        subject,
        status,
        organizations,
      }));
  });

  handle('auth:activate', async (_event, key) => {
    await sessionsReady;
    const revision = ++activationRevision;
    const context = contextForKey(key);
    if (!context) throw new Error('AUTH_ACCOUNT_NOT_FOUND');
    const res = await apiFetch({ method: 'GET', path: '/user/session', context });
    if (res.status !== 200) throw new Error('AUTH_SESSION_EXPIRED');
    const access = await apiFetch({ method: 'GET', path: '/integrations/tester-access', context });
    if (access.status !== 200) throw new Error('AUTH_ACCESS_DENIED');
    if (revision !== activationRevision) throw new Error('AUTH_CONTEXT_CHANGED');
    disconnectBusinessSocket();
    activateContext(context);
    return res.body?.result ?? null;
  });

  handle('auth:remove', async (_event, key) => {
    await sessionsReady;
    await cancelPendingAuthAndWait();
    const context = contextForKey(key);
    if (!context) return { remoteRevocationFailed: false };
    ++activationRevision;
    if (context === activeContext()) disconnectBusinessSocket();
    const remoteRevocationFailed = await removeContext(context, revokeSession);
    return { remoteRevocationFailed };
  });

  handle('auth:logoutAll', async () => {
    await sessionsReady;
    await cancelPendingAuthAndWait();
    ++activationRevision;
    disconnectBusinessSocket();
    const remoteRevocationFailed = await removeAllContexts(revokeSession);
    return { remoteRevocationFailed };
  });

  handle('auth:cancel', async () => {
    cancelPendingAuth();
  });

  handle('auth:logout', async () => {
    await sessionsReady;
    await cancelPendingAuthAndWait();
    ++activationRevision;
    const context = activeContext();
    disconnectBusinessSocket();
    const remoteRevocationFailed = (await removeContext(context, revokeSession)) || false;
    return { remoteRevocationFailed };
  });

  handle('auth:session', async () => {
    await sessionsReady;
    const capture = captureActiveContext();
    if (!capture.context) return null;
    try {
      const res = await apiFetch({
        method: 'GET',
        path: '/user/session',
        context: capture.context,
      });
      if (!isCurrent(capture)) return null;
      console.info(
        '[auth] session check:',
        res.status,
        'cookies:',
        await authCookieNames(capture.context),
      );
      return res.status === 200 ? (res.body?.result ?? null) : null;
    } catch {
      console.info('[auth] session check failed, cookies:', await authCookieNames(capture.context));
      return null;
    }
  });
}

module.exports = { register };
