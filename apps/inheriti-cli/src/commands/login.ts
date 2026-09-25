import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
  const resources = new URL(import.meta.url.endsWith('/main.js') ? './' : '../', import.meta.url);
  const font = readFileSync(new URL('assets/font-app.ttf', resources)).toString('base64');
  const logo = readFileSync(new URL('assets/inheriti-business-logo.png', resources)).toString('base64');
  return readFileSync(new URL('templates/login-callback.html', resources), 'utf8')
    .replace('{{font}}', font)
    .replace('{{logo}}', logo)
    .replaceAll('{{heading}}', signedIn ? 'Signed in' : 'Sign-in failed')
    .replace('{{statusLabel}}', signedIn ? 'Sign-in complete' : 'Sign-in error')
    .replace('{{statusClass}}', signedIn ? '' : 'failed')
    .replace('{{message}}', signedIn ? 'You can close this tab and go back to your terminal.' : escapeHtml(failure));
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
