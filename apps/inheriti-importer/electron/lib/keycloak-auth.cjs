const { app, shell } = require('electron');
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { net } = require('electron');
const { apiSession } = require('./api-session.cjs');
const { apiFetch, ensureCsrf, resetCsrfToken, authCookieNames } = require('./api-transport.cjs');

const API_ORIGIN = process.env.INHERITI_API_ORIGIN || '';
const KEYCLOAK_URL = process.env.KEYCLOAK_URL || '';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || '';
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID || '';
const AUTH_CALLBACK_PATH = '/oauth/callback';
let pendingAuth = null;

function callbackPage(success) {
  const appRoot = path.resolve(__dirname, '../..');
  const assetsRoot = app.isPackaged ? path.join(appRoot, 'dist') : appRoot;
  const fontPath = app.isPackaged
    ? path.join(assetsRoot, 'font-app.ttf')
    : path.join(appRoot, '../../packages/core/assets/font-app.ttf');
  const logoPath = path.join(assetsRoot, app.isPackaged ? 'favicon.png' : 'public/favicon.png');
  return fs.readFileSync(path.join(__dirname, 'login-callback.html'), 'utf8')
    .replace('{{font}}', fs.readFileSync(fontPath).toString('base64'))
    .replace('{{logo}}', fs.readFileSync(logoPath).toString('base64'))
    .replaceAll('{{heading}}', success ? 'Continue in Inheriti® Importer' : 'Sign-in failed')
    .replace('{{statusLabel}}', success ? 'Browser step complete' : 'Sign-in error')
    .replace('{{statusClass}}', success ? '' : 'failed')
    .replace('{{message}}', success
      ? 'You can close this tab and return to Inheriti® Importer to finish signing in.'
      : 'Return to Inheriti® Importer and try signing in again.');
}

function randomBase64Url(size = 32) {
  return crypto.randomBytes(size).toString('base64url');
}

function sha256Base64Url(value) {
  return crypto.createHash('sha256').update(value).digest('base64url');
}

function decodeJwtPayload(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = net.request({ method: options.method || 'GET', url });
    if (options.headers)
      Object.entries(options.headers).forEach(([name, value]) => req.setHeader(name, value));
    let raw = '';
    req.on('response', (response) => {
      response.on('data', (chunk) => {
        raw += chunk;
      });
      response.on('end', () => {
        let body = null;
        try {
          body = raw ? JSON.parse(raw) : null;
        } catch {
          body = raw;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`AUTH_PROVIDER_${response.statusCode}`));
          return;
        }
        resolve(body);
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function handleAuthCallback(callbackUrl) {
  if (!pendingAuth) return;
  const auth = pendingAuth;
  pendingAuth = null;
  try {
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
      `${KEYCLOAK_URL}/realms/${encodeURIComponent(KEYCLOAK_REALM)}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: KEYCLOAK_CLIENT_ID,
          redirect_uri: auth.redirectUri,
          code,
          code_verifier: auth.verifier,
        }).toString(),
      },
    );
    const accessToken = token.access_token;
    const claims = decodeJwtPayload(token.id_token || accessToken);
    if (!accessToken || !claims?.sub) throw new Error('AUTH_TOKEN_INVALID');
    // OAuth login runs in main and bypasses the renderer's api:request IPC
    // handler, so obtain the CSRF token explicitly before the forced-CSRF
    // Business API login endpoint.
    await ensureCsrf();
    const response = await apiFetch({
      method: 'POST',
      path: '/user/login',
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
    try {
      const access = await apiFetch({ method: 'GET', path: '/integrations/tester-access' });
      if (access.status !== 200) {
        throw new Error(
          access.status === 403 && access.body?.error === 'integration_tester_required'
            ? 'You are not an integration tester. Contact developer support.'
            : 'Could not verify Inheriti Importer access. Please try again.',
        );
      }
    } catch (error) {
      resetCsrfToken();
      await apiSession().clearStorageData({ storages: ['cookies'] });
      throw error;
    }
    await apiSession().cookies.flushStore();
    console.info('[auth] session cookies stored:', await authCookieNames());
    auth.resolve(response.body?.result?.session ?? response.body?.result ?? null);
    return true;
  } catch (error) {
    auth.reject(error instanceof Error ? error : new Error('AUTH_LOGIN_FAILED'));
    return false;
  }
}

async function loginWithKeycloak() {
  if (!KEYCLOAK_URL || !KEYCLOAK_REALM || !KEYCLOAK_CLIENT_ID || !API_ORIGIN)
    throw new Error('AUTH_NOT_CONFIGURED');
  if (pendingAuth) throw new Error('AUTH_IN_PROGRESS');
  const state = randomBase64Url();
  const verifier = randomBase64Url(48);
  const callbackServer = http.createServer(async (request, response) => {
    let requestUrl;
    try {
      requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    } catch {
      requestUrl = null;
    }
    if (request.method !== 'GET' || requestUrl?.pathname !== AUTH_CALLBACK_PATH) {
      response.writeHead(404).end();
      return;
    }
    const callbackUrl = `http://127.0.0.1:${callbackServer.address().port}${request.url}`;
    const success = await handleAuthCallback(callbackUrl);
    response.writeHead(success ? 200 : 400, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:",
      'x-content-type-options': 'nosniff',
    });
    response.end(callbackPage(success));
    callbackServer.close();
  });

  await new Promise((resolve, reject) => {
    callbackServer.once('error', reject);
    callbackServer.listen(0, '127.0.0.1', resolve);
  });
  const callbackPort = callbackServer.address().port;
  const redirectUri = `http://127.0.0.1:${callbackPort}${AUTH_CALLBACK_PATH}`;
  const authorizationUrl = new URL(
    `${KEYCLOAK_URL}/realms/${encodeURIComponent(KEYCLOAK_REALM)}/protocol/openid-connect/auth`,
  );
  authorizationUrl.search = new URLSearchParams({
    client_id: KEYCLOAK_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid profile email',
    state,
    code_challenge: sha256Base64Url(verifier),
    code_challenge_method: 'S256',
  }).toString();

  return new Promise((resolve, reject) => {
    pendingAuth = { resolve, reject, state, verifier, redirectUri, callbackServer };
    void shell.openExternal(authorizationUrl.toString()).catch((error) => {
      callbackServer.close();
      pendingAuth = null;
      reject(error);
    });
  });
}

function cancelPendingAuth() {
  if (!pendingAuth) return false;
  const auth = pendingAuth;
  pendingAuth = null;
  auth.callbackServer.close();
  auth.reject(new Error('AUTH_CANCELLED'));
  return true;
}

module.exports = { loginWithKeycloak, cancelPendingAuth };
