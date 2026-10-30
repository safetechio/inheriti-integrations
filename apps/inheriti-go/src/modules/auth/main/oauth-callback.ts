import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { trayMessages as messages } from '../../../messages.js';

export function waitForCallback(buildAuthorizationUrl: (redirectUri: string) => Promise<string>, openBrowser: (url: string) => Promise<void>, signal: AbortSignal,
  buildLogoutUrl?: (redirectUri: string, authorizationUrl: string, idToken?: string) => string,
  prepareLogout?: (redirectUri: string) => Promise<{ authorizationUrl: string; complete: (callbackUrl: string) => Promise<string> }>): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error(messages.signInCanceled)); return; }
    let settled = false;
    let redirectUri: string;
    let authorizationUrl: string;
    let awaitingLogout = false;
    let awaitingCheck = false;
    let logoutState: string | null = null;
    let checkState: string | null = null;
    let completeCheck: ((callbackUrl: string) => Promise<string>) | undefined;
    const server = createServer((request, response) => {
      let url: URL;
      try { url = new URL(request.url ?? '/', redirectUri); }
      catch { response.writeHead(400).end(); return; }
      if (url.pathname !== '/oauth/callback') { response.writeHead(404).end(); return; }
      if (settled) { response.writeHead(400).end(); return; }
      response.once('finish', () => server.closeAllConnections());
      const error = url.searchParams.get('error');
      if (awaitingCheck) {
        if (url.searchParams.get('state') !== checkState) {
          response.writeHead(400).end(); finish(new Error(messages.invalidSignInCallback), undefined, true); return;
        }
        awaitingCheck = false;
        if (error === 'login_required') {
          response.writeHead(302, { location: authorizationUrl, 'cache-control': 'no-store' }).end(); return;
        }
        if (error || !url.searchParams.has('code')) {
          response.writeHead(400, callbackHeaders).end(callbackPage(false)); finish(new Error(error ?? messages.invalidSignInCallback), undefined, true); return;
        }
        void completeCheck!(url.toString()).then((idToken) => {
          if (settled) return;
          logoutState = new URL(authorizationUrl).searchParams.get('state');
          if (!logoutState || !idToken) throw new Error(messages.invalidSignInCallback);
          awaitingLogout = true;
          response.writeHead(302, { location: buildLogoutUrl!(redirectUri, authorizationUrl, idToken), 'cache-control': 'no-store' }).end();
        }).catch((failure: unknown) => {
          if (!settled) response.writeHead(500, callbackHeaders).end(callbackPage(false));
          finish(failure, undefined, true);
        });
        return;
      }
      if (error) { response.writeHead(400, callbackHeaders).end(callbackPage(false)); finish(new Error(error), undefined, true); return; }
      if (awaitingLogout && !url.searchParams.has('code') && url.searchParams.get('state') === logoutState) {
        awaitingLogout = false;
        response.writeHead(302, { location: authorizationUrl, 'cache-control': 'no-store' }).end();
        return;
      }
      if (!url.searchParams.has('code') || !url.searchParams.has('state')) { response.writeHead(400, callbackHeaders).end(callbackPage(false)); finish(new Error(messages.invalidSignInCallback), undefined, true); return; }
      response.writeHead(200, callbackHeaders).end(callbackPage(true));
      finish(undefined, url.toString(), true);
    });
    const finish = (error?: unknown, callbackUrl?: string, responding = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', cancel);
      server.close();
      if (!responding) server.closeAllConnections();
      if (error !== undefined) { reject(error); return; }
      resolve(callbackUrl!);
    };
    const cancel = () => finish(new Error(messages.signInCanceled));
    const timeout = setTimeout(() => finish(new Error(messages.signInTimedOut)), 300_000);
    signal.addEventListener('abort', cancel, { once: true });
    server.once('error', (error) => finish(error));
    server.listen(0, '127.0.0.1', () => {
      if (settled) { server.close(); return; }
      const address = server.address();
      if (!address || typeof address === 'string') { finish(new Error(messages.invalidSignInCallback)); return; }
      redirectUri = `http://127.0.0.1:${address.port}/oauth/callback`;
      void Promise.resolve().then(async () => {
        if (settled) return;
        authorizationUrl = await buildAuthorizationUrl(redirectUri);
        if (settled) return;
        if (prepareLogout) {
          const check = await prepareLogout(redirectUri);
          checkState = new URL(check.authorizationUrl).searchParams.get('state');
          if (!checkState) throw new Error(messages.invalidSignInCallback);
          completeCheck = check.complete;
          awaitingCheck = true;
          await openBrowser(check.authorizationUrl);
          return;
        }
        if (buildLogoutUrl) {
          logoutState = new URL(authorizationUrl).searchParams.get('state');
          if (!logoutState) throw new Error(messages.invalidSignInCallback);
          awaitingLogout = true;
        }
        await openBrowser(buildLogoutUrl ? buildLogoutUrl(redirectUri, authorizationUrl) : authorizationUrl);
      }).catch((error: unknown) => finish(error));
    });
  });
}

export function untilCanceled<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error(messages.signInCanceled));
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new Error(messages.signInCanceled));
    signal.addEventListener('abort', cancel, { once: true });
    void operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
  });
}

const callbackHeaders = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; frame-ancestors 'none'",
};

function callbackPage(success: boolean): string {
  const resources = new URL(import.meta.url.endsWith('/main.js') ? './' : '../../../', import.meta.url);
  return readFileSync(new URL('login-callback.html', resources), 'utf8')
    .replace('{{font}}', readFileSync(new URL('font-app.ttf', resources)).toString('base64'))
    .replace('{{logo}}', readFileSync(new URL('tray.png', resources)).toString('base64'))
    .replaceAll('{{heading}}', success ? 'Continue in Inheriti® Go' : 'Sign-in failed')
    .replace('{{statusLabel}}', success ? 'Browser step complete' : 'Sign-in error')
    .replace('{{statusClass}}', success ? '' : 'failed')
    .replace('{{message}}', success
      ? 'You can close this tab and return to Inheriti® Go to finish signing in.'
      : 'Return to Inheriti® Go and try signing in again.');
}
