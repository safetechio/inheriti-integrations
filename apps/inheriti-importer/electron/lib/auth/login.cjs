const { shell } = require('electron');
const http = require('node:http');
const { callbackPage } = require('./callback-page.cjs');
const { handleAuthCallback } = require('./enrollment.cjs');
const { currentAuth, reserveAuth, clearAuth } = require('./flow-state.cjs');
const {
  SAFEID_URL,
  SAFEID_REALM,
  SAFEID_CLIENT_ID,
  randomBase64Url,
  sha256Base64Url,
} = require('./provider.cjs');

const API_ORIGIN = process.env.INHERITI_API_ORIGIN || '';
const AUTH_CALLBACK_PATH = '/oauth/callback';

function loginWithSafeID(addAccount = false) {
  if (!SAFEID_URL || !SAFEID_REALM || !SAFEID_CLIENT_ID || !API_ORIGIN)
    throw new Error('AUTH_NOT_CONFIGURED');
  if (currentAuth()) throw new Error('AUTH_IN_PROGRESS');
  const state = randomBase64Url();
  const verifier = randomBase64Url(48);
  let resolveLogin;
  let rejectLogin;
  const login = new Promise((resolve, reject) => {
    resolveLogin = resolve;
    rejectLogin = reject;
  });
  void login.catch(() => {});
  let auth;
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
    if (!auth || currentAuth() !== auth || auth.callbackStarted) {
      response.writeHead(409).end();
      return;
    }
    const callbackUrl = new URL(request.url || '/', auth.redirectUri).toString();
    auth.callbackStarted = true;
    auth.callbackPromise = handleAuthCallback(callbackUrl, auth);
    const success = await auth.callbackPromise;
    response.writeHead(success ? 200 : 400, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:",
      'x-content-type-options': 'nosniff',
    });
    response.end(callbackPage(success));
    callbackServer.close();
  });
  auth = {
    resolve: resolveLogin,
    reject: rejectLogin,
    state,
    verifier,
    callbackServer,
    addAccount,
    listening: false,
  };
  reserveAuth(auth);
  void new Promise((resolve, reject) => {
    callbackServer.once('error', reject);
    callbackServer.listen(0, '127.0.0.1', resolve);
  })
    .then(async () => {
      auth.listening = true;
      if (auth.cancelled) {
        callbackServer.close();
        return;
      }
      const callbackPort = callbackServer.address().port;
      auth.redirectUri = `http://127.0.0.1:${callbackPort}${AUTH_CALLBACK_PATH}`;
      const authorizationUrl = new URL(
        `${SAFEID_URL}/realms/${encodeURIComponent(SAFEID_REALM)}/protocol/openid-connect/auth`,
      );
      authorizationUrl.search = new URLSearchParams({
        client_id: SAFEID_CLIENT_ID,
        redirect_uri: auth.redirectUri,
        response_type: 'code',
        scope: 'openid profile email',
        prompt: 'login',
        state,
        code_challenge: sha256Base64Url(verifier),
        code_challenge_method: 'S256',
      }).toString();
      await shell.openExternal(authorizationUrl.toString());
    })
    .catch((error) => {
      if (auth.listening) callbackServer.close();
      clearAuth(auth);
      if (!auth.cancelled) auth.reject(error);
    });
  return login;
}

module.exports = { loginWithSafeID };
