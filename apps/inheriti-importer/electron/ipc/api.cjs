const { app } = require('electron');
const { handle } = require('../lib/ipc-guard.cjs');
const { bearerApiFetch, relayApiFetch } = require('../lib/api-transport.cjs');

function register(runtimeReady, runtime) {
  handle('api:request', async (_event, request) => {
    await runtimeReady;
    const capture = runtime.capture();
    if (!capture.subject) throw new Error('AUTH_SIGNED_OUT');
    const method = String(request?.method || 'GET').toUpperCase();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      throw new Error(`Unsupported method: ${method}`);
    }
    if (typeof request?.path !== 'string' || !request.path.startsWith('/integrations/v1/')) {
      throw new Error('Unsupported Business API path');
    }
    const token = await runtime.getAccessToken(capture);
    if (!token || !runtime.isCurrent(capture)) throw new Error('AUTH_CONTEXT_CHANGED');
    const response = await bearerApiFetch({
      method, path: request.path, query: request.query, body: request.body,
      token, environment: runtime.environment, organizationId: request.organizationId,
    });
    if (!runtime.isCurrent(capture)) throw new Error('AUTH_CONTEXT_CHANGED');
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

    return relayApiFetch({
      path: `/integrations/v1/organizations/${encodeURIComponent(organizationId)}/master-key-relay`,
      body: { sessionId, encryptedMasterKey },
      token: relayToken,
    });
  });
}

module.exports = { register };
