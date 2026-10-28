const { app, session } = require('electron');
const { randomBytes } = require('node:crypto');
const { handle } = require('../lib/ipc-guard.cjs');
const { captureActiveContext, isCurrent } = require('../lib/api-session.cjs');
const { apiFetch, ensureCsrf, resetCsrfToken } = require('../lib/api-transport.cjs');

function register(sessionsReady) {
  handle('api:request', async (_event, request) => {
    await sessionsReady;
    const capture = captureActiveContext();
    const context = capture.context;
    if (!context) throw new Error('AUTH_SIGNED_OUT');
    const method = String(request?.method || 'GET').toUpperCase();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      throw new Error(`Unsupported method: ${method}`);
    }
    if (typeof request?.path !== 'string' || !request.path.startsWith('/')) {
      throw new Error('request.path must be an absolute API path');
    }

    if (!request.skipCsrf && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      await ensureCsrf(context);
    }
    if (!isCurrent(capture)) throw new Error('AUTH_CONTEXT_CHANGED');

    const send = () =>
      apiFetch({
        method,
        path: request.path,
        query: request.query,
        body: request.body,
        skipCsrf: request.skipCsrf,
        context,
      });

    let response = await send();
    if (!isCurrent(capture)) throw new Error('AUTH_CONTEXT_CHANGED');

    // A rejected CSRF token: refresh once and retry.
    if (response.status === 419 || response.status === 403) {
      resetCsrfToken(context);
      await ensureCsrf(context);
      if (!isCurrent(capture)) throw new Error('AUTH_CONTEXT_CHANGED');
      response = await send();
    }

    if (!isCurrent(capture)) throw new Error('AUTH_CONTEXT_CHANGED');
    return response;
  });

  handle('development:deliverMasterKey', async (_event, request) => {
    if (app.isPackaged) throw new Error('Local Organization Key simulation is unavailable');

    const organizationId = String(request?.organizationId || '');
    const sessionId = String(request?.sessionId || '');
    const relayToken = String(request?.relayToken || '');
    const encryptedMasterKey = String(request?.encryptedMasterKey || '');
    if (!organizationId || organizationId.includes('/')) throw new Error('Invalid organization');
    if (!sessionId || !relayToken || !encryptedMasterKey) {
      throw new Error('Incomplete Organization Key relay payload');
    }
    if (!/^[A-Za-z0-9._-]+$/.test(relayToken) || relayToken.length > 8192) {
      throw new Error('Invalid Organization Key relay token');
    }
    if (encryptedMasterKey.length > 16384) {
      throw new Error('Invalid encrypted Organization Key');
    }

    return apiFetch({
      method: 'POST',
      context: {
        session: session.fromPartition(`inheriti-relay-${randomBytes(16).toString('hex')}`),
        csrfToken: null,
        csrfInFlight: null,
      },
      path: `/organizations/${encodeURIComponent(organizationId)}/master-key-relay`,
      body: { sessionId, encryptedMasterKey },
      skipCsrf: true,
      authorization: `Bearer ${relayToken}`,
    });
  });
}

module.exports = { register };
