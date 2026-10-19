/** Receive the local OAuth redirect and hand the callback to the shared integration core. */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import logo from '../../../ui/assets/inheriti-brandmark-full-color.svg';
import font from '../../../ui/assets/font-app.ttf';

const callbackPath = '/oauth/callback';

export async function openSystemBrowser(url: string): Promise<void> {
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', shell: false });
    child.once('error', reject);
    child.once('spawn', resolve);
  });
}

export function waitForOAuthCallback(
  authorize: (redirectUri: string) => Promise<string>,
  openBrowser: (url: string) => Promise<void>,
  signal: AbortSignal,
  createListener: typeof createServer = createServer,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createListener((request, response) => {
      if (!redirectUri) { response.writeHead(503).end(); return; }
      let callback: URL;
      try { callback = new URL(request.url ?? '/', redirectUri); }
      catch { response.writeHead(400).end(); return; }
      if (request.method !== 'GET' || callback.pathname !== callbackPath) {
        response.writeHead(404).end();
        return;
      }
      if (settled) { response.writeHead(400).end(); return; }
      const error = callback.searchParams.get('error');
      if (!callback.searchParams.has('state') || (!callback.searchParams.has('code') && !error)) {
        response.once('finish', () => finish(new Error('invalid_callback')));
        response.writeHead(400, callbackHeaders).end(callbackPage(false));
        return;
      }
      response.once('finish', () => finish(error ? new Error(error) : undefined, callback.toString()));
      response.writeHead(error ? 400 : 200, callbackHeaders).end(callbackPage(!error));
    });

    let redirectUri: string | undefined;
    let settled = false;
    const timer = setTimeout(() => finish(new Error('timeout')), 300_000);
    const cancel = () => finish(new Error('canceled'));
    const finish = (error?: Error, callback?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      server.closeAllConnections();
      server.close();
      if (error) reject(error);
      else resolve(callback!);
    };

    if (signal.aborted) { finish(new Error('canceled')); return; }
    signal.addEventListener('abort', cancel, { once: true });
    server.once('error', () => finish(new Error('listener_failed')));
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') { finish(new Error('listener_failed')); return; }
      redirectUri = `http://127.0.0.1:${address.port}${callbackPath}`;
      void authorize(redirectUri).then(async (url) => {
        if (settled || signal.aborted) return;
        await openBrowser(url);
      }).catch(() => finish(new Error('authorization_failed')));
    });
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${success ? 'Continue in Inheriti Workspace' : 'Sign-in failed'} · Inheriti Workspace</title><style>
    @font-face{font-family:AppFont;src:url(data:font/ttf;base64,${font}) format('truetype');font-display:swap}
    :root{color-scheme:light;--ground:#f9fafb;--card:#fff;--ink:#101828;--muted:#475467;--line:#eaecf0;--danger:#c21e2e}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:24px;background:var(--ground);color:var(--ink);font:16px/1.5 AppFont,ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
    .card{width:min(100%,440px);background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(10,28,77,.06)}
    .brand{display:flex;align-items:center;gap:12px;padding:24px 32px;border-bottom:1px solid var(--line);font-weight:700;color:#101828}.brand img{display:block;width:40px;height:40px;object-fit:contain}
    .content{padding:32px}.eyebrow{margin:0 0 8px;color:#1642ba;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}h1{margin:0 0 8px;font-size:24px;line-height:1.3}h1.failed{color:var(--danger)}.message{margin:0;color:var(--muted)}
    @media(max-width:420px){.brand{padding:20px 24px}.content{padding:24px}}
  </style></head><body><main class="card"><header class="brand"><img src="data:image/svg+xml;base64,${logo}" alt="" />Inheriti Workspace</header><div class="content"><p class="eyebrow">${success ? 'Browser step complete' : 'Sign-in error'}</p><h1${success ? '' : ' class="failed"'}>${success ? 'Continue in Inheriti Workspace' : 'Sign-in failed'}</h1><p class="message">${success ? 'You can close this tab and return to Inheriti Workspace to finish signing in.' : 'Return to Inheriti Workspace and try signing in again.'}</p></div></main></body></html>`;
}
