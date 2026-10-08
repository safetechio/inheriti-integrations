import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { OperatorAuthFacade } from '@safetech/inheriti-elements-core/node-base';

const callbackHeaders = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
};

export async function beginBrowserLogin(
  auth: Pick<OperatorAuthFacade, 'beginAuthorizationCode' | 'completeAuthorizationCode'>,
  configuration: { redirectUri: string },
  open = openBrowser,
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
    response.once('finish', () => server.closeAllConnections());
    void (async () => {
      try {
        if (callback.searchParams.has('error')) throw new Error('access_denied');
        await auth.completeAuthorizationCode(callback.toString());
        response.writeHead(200, callbackHeaders).end('<h1>Signed in</h1><p>Return to your MCP client.</p>');
        finish(undefined, true);
      } catch (error) {
        response.writeHead(400, callbackHeaders).end('<h1>Sign-in failed</h1><p>Return to your MCP client and try again.</p>');
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
  const timeout = setTimeout(() => finish(new Error('login_browser_callback_timed_out')), 300_000);

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('login_invalid_callback_address');
    redirect.port = String(address.port);
    configuration.redirectUri = redirect.toString();
    const { authorizationUrl } = await auth.beginAuthorizationCode();
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
