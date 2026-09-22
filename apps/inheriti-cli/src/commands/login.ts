import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import type { DeviceTransaction } from '@safetech/inheriti-elements-core';
import type { CliContext } from '../session.js';
import type { Terminal } from '../output.js';

export class InteractiveTerminalRequired extends Error {
  constructor() {
    super('login_requires_an_interactive_terminal');
    this.name = 'InteractiveTerminalRequired';
  }
}

export class BrowserUnavailable extends Error {
  constructor() {
    super('login_could_not_open_a_browser');
    this.name = 'BrowserUnavailable';
  }
}

/**
 * Signs the operator in, in the browser, and keeps the token that comes back.
 *
 * This is the default because it provides the browser callback for interactive operators. The reveal
 * engine still decides whether access is direct or governed from the plan and its policy; the login
 * mode does not choose or bypass that policy.
 */
export async function login(context: CliContext, terminal: Terminal): Promise<number> {
  if (!terminal.interactive) throw new InteractiveTerminalRequired();
  const started = await context.core.auth.beginAuthorizationCode();
  terminal.write('Opening your browser to sign in…');
  const callback = waitForCallback(started.authorizationUrl, terminal);
  openBrowser(started.authorizationUrl);
  await context.core.auth.completeAuthorizationCode(await callback);
  terminal.write('Signed in.');
  return 0;
}

/**
 * The headless login: a code read here and approved elsewhere.
 *
 * Kept for the shells this harness cannot open a browser from — CI, a container, an SSH session —
 * where the alternative is no login at all. The resulting session can enter governed reveals; the
 * plan policy remains responsible for approvals and release progression.
 */
export async function loginWithDevice(context: CliContext, terminal: Terminal): Promise<number> {
  const started = await context.core.auth.beginDeviceAuthorization() as DeviceTransaction;
  terminal.write(`Open ${started.verificationUri} and enter the code: ${started.userCode}`);
  terminal.write('Waiting for approval…');
  await context.core.auth.pollDeviceAuthorization();
  terminal.write('Signed in.');
  return 0;
}

/**
 * Catches the redirect on the port the client is registered for.
 *
 * The whole callback URL is handed back rather than its parts: state and code are the SDK's to
 * check, and a CLI that parsed them itself would be a second implementation of that check.
 */
function waitForCallback(authorizationUrl: string, terminal: Terminal): Promise<string> {
  const { port } = new URL(authorizationUrl.includes('redirect_uri=')
    ? decodeURIComponent(new URL(authorizationUrl).searchParams.get('redirect_uri') ?? '')
    : 'http://127.0.0.1:53682');
  return new Promise((resolveCallback, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
      if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
        response.writeHead(404).end();
        return;
      }
      const failure = url.searchParams.get('error_description') ?? url.searchParams.get('error');
      response.writeHead(failure ? 400 : 200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(callbackPage(failure));
      server.close();
      if (failure) {
        reject(new Error(failure));
        return;
      }
      resolveCallback(url.toString());
    });
    server.once('error', reject);
    server.listen(Number(port), '127.0.0.1', () => {
      terminal.write(`Waiting for the browser… if it did not open, visit:\n  ${authorizationUrl}`);
    });
  });
}

/**
 * The one page this CLI ever renders. It carries the product's own palette because it is the last
 * thing an operator sees before coming back to the terminal, and an unstyled paragraph reads like
 * something went wrong even when nothing did.
 */
function callbackPage(failure: string | null): string {
  const signedIn = failure === null;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Inheriti</title>
<style>
  :root {
    color-scheme: light dark;
    --primary: #0066FF; --ground: #F9FAFB; --card: #FFFFFF; --ink: #101828;
    --muted: #535862; --line: #EAECF0; --danger: #DC3545;
  }
  @media (prefers-color-scheme: dark) {
    :root { --primary: #75A9FF; --ground: #0C111D; --card: #1D2939; --ink: #F9FAFB; --muted: #A3B3BF; --line: #22303F; }
  }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--ground);
    color: var(--ink); font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .card {
    background: var(--card); border: 1px solid var(--line); border-radius: 14px;
    padding: 36px 40px; text-align: center; max-width: 34rem;
    box-shadow: 0 1px 3px rgba(16, 24, 40, .10);
  }
  .wordmark { font-size: 11px; letter-spacing: .22em; font-weight: 600; color: var(--primary); }
  h1 { margin: 12px 0 6px; font-size: 19px; font-weight: 600; letter-spacing: -.01em; }
  h1.failed { color: var(--danger); }
  p { margin: 0; color: var(--muted); }
</style></head>
<body><div class="card">
  <div class="wordmark">INHERITI</div>
  <h1${signedIn ? '' : ' class="failed"'}>${signedIn ? 'Signed in' : 'Sign-in failed'}</h1>
  <p>${signedIn ? 'You can close this tab and go back to your terminal.' : escapeHtml(failure)}</p>
</div></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/gu, (character) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character] ?? character
  ));
}

/** Best effort: a browser that will not open is a printed URL, not a failed login. */
function openBrowser(url: string): void {
  // Set where no browser should ever be launched — a test, or a shell that only wants the URL.
  if (process.env.INHERITI_ELEMENTS_NO_BROWSER) return;
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(command, [url], { stdio: 'ignore', detached: true }).unref();
  } catch {
    // The URL is already on screen; the operator can open it themselves.
  }
}
