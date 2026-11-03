import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import type { OperatorAuthFacade } from '@safetech/inheriti-elements-core/node-base';

const callbackHeaders = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; frame-ancestors 'none'",
};

function callbackPage(status: 'success' | 'continue' | 'failed'): string {
  const resources = new URL('./', import.meta.url);
  const font = readFileSync(new URL('assets/font-app.ttf', resources)).toString('base64');
  const logo = readFileSync(new URL('assets/inheriti-mark.png', resources)).toString('base64');
  const heading = status === 'success' ? 'Signed in' : status === 'continue' ? 'Continue sign-in' : 'Sign-in failed';
  const message = status === 'failed' ? 'Return to your MCP client and try again.' : 'Return to your MCP client.';
  return readFileSync(new URL('templates/login-callback.html', resources), 'utf8')
    .replace('{{font}}', font)
    .replace('{{logo}}', logo)
    .replaceAll('{{heading}}', heading)
    .replace('{{statusLabel}}', status === 'failed' ? 'Sign-in error' : status === 'continue' ? 'Sign-in required' : 'Browser step complete')
    .replace('{{statusClass}}', status === 'failed' ? 'failed' : '')
    .replace('{{message}}', message);
}

export async function beginBrowserLogin(
  auth: Pick<OperatorAuthFacade, 'beginAuthorizationCode' | 'completeAuthorizationCode'>,
  configuration: { redirectUri: string },
  open = openBrowser,
  options: { prompt?: 'none'; timeoutMs?: number } = {},
): Promise<{ authorizationUrl: string; completed: Promise<void>; cancel: () => void }> {
  const redirect = new URL(configuration.redirectUri);
  if (redirect.protocol !== 'http:' || redirect.hostname !== '127.0.0.1' || redirect.username || redirect.password || redirect.hash) {
    throw new Error('login_requires_an_http_ipv4_loopback_callback');
  }

  let settled = false;
  let handling = false;
  let resolveCompletion!: () => void;
  let rejectCompletion!: (error: unknown) => void;
  const completed = new Promise<void>((resolve, reject) => { resolveCompletion = resolve; rejectCompletion = reject; });
  void completed.catch(() => undefined);
  const server = createServer((request, response) => {
    let callback: URL;
    try { callback = new URL(request.url ?? '/', redirect); }
    catch { response.writeHead(400).end(); return; }
    if (callback.origin !== redirect.origin || callback.pathname !== redirect.pathname) { response.writeHead(404).end(); return; }
    if (settled || handling) { response.writeHead(400).end(); return; }
    if (!callback.searchParams.has('code') && !callback.searchParams.has('error')) { response.writeHead(404).end(); return; }
    handling = true;
    clearTimeout(timeout);
    response.once('finish', () => server.closeAllConnections());
    void (async () => {
      try {
        await auth.completeAuthorizationCode(callback.toString());
        response.writeHead(200, callbackHeaders).end(callbackPage('success'));
        finish(undefined, true);
      } catch (error) {
        if (options.prompt === 'none' && ['login_required', 'interaction_required'].includes((error as { code?: unknown } | null)?.code as string)) {
          response.writeHead(200, callbackHeaders).end(callbackPage('continue'));
          finish(error, true);
          return;
        }
        response.writeHead(400, callbackHeaders).end(callbackPage('failed'));
        finish(error, true);
      }
    })();
  });
  const finish = (error?: unknown, responding = false) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    server.close();
    if (!responding) server.closeAllConnections();
    if (error === undefined) resolveCompletion();
    else rejectCompletion(error);
  };
  const timeout = setTimeout(() => finish(new Error('login_browser_callback_timed_out')), options.timeoutMs ?? 300_000);

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('login_invalid_callback_address');
    redirect.port = String(address.port);
    configuration.redirectUri = redirect.toString();
    const { authorizationUrl } = await auth.beginAuthorizationCode(options.prompt ? { prompt: options.prompt } : undefined);
    open(authorizationUrl);
    return { authorizationUrl, completed, cancel: () => finish(new Error('login_canceled')) };
  } catch (error) {
    finish(error);
    throw error;
  }
}

export function openBrowser(url: string, platform = process.platform): void {
  if (process.env.INHERITI_ELEMENTS_NO_BROWSER) return;
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'powershell.exe' : 'xdg-open';
  const args = platform === 'win32'
    ? ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath '${url.replaceAll("'", "''")}'`]
    : [url];
  try {
    const browser = spawn(command, args, platform === 'win32' ? { stdio: 'ignore' } : { stdio: 'ignore', detached: true });
    browser.once('error', () => undefined);
    if (platform !== 'win32') browser.unref();
  } catch { /* The returned URL can be opened manually. */ }
}
