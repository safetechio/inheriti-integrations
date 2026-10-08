import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { DeviceTransaction } from '@safetech/inheriti-elements-core';
import type { CliContext } from '../session.js';
import type { Terminal } from '../output.js';
import { SessionStoreUnreadable } from '../session-store.js';

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
  if (await context.sessions.load()) await context.keyVault?.clear();
  const callbackUrl = await waitForCallback(context, terminal);
  await context.core.auth.completeAuthorizationCode(callbackUrl);
  if (!(await context.sessions.load())) throw new SessionStoreUnreadable('session_file_unreadable');
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
  if (await context.sessions.load()) await context.keyVault?.clear();
  const started = await context.core.auth.beginDeviceAuthorization() as DeviceTransaction;
  terminal.write(`Open ${started.verificationUri} and enter the code: ${started.userCode}`);
  terminal.write('Waiting for approval…');
  await context.core.auth.pollDeviceAuthorization();
  if (!(await context.sessions.load())) throw new SessionStoreUnreadable('session_file_unreadable');
  terminal.write('Signed in.');
  return 0;
}

function waitForCallback(context: CliContext, terminal: Terminal): Promise<string> {
  const redirect = new URL(context.authConfiguration.redirectUri);
  if (redirect.protocol !== 'http:' || redirect.hostname !== '127.0.0.1'
    || redirect.username || redirect.password || redirect.hash) {
    throw new Error('login_requires_an_http_ipv4_loopback_callback');
  }
  return new Promise((resolveCallback, reject) => {
    let settled = false;
    let ready = false;
    const server = createServer((request, response) => {
      let url: URL;
      try { url = new URL(request.url ?? '/', redirect); }
      catch { response.writeHead(400).end(); return; }
      if (url.origin !== redirect.origin || url.pathname !== redirect.pathname) {
        response.writeHead(404).end(); return;
      }
      if (settled || !ready) { response.writeHead(400).end(); return; }
      if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
        response.writeHead(404).end(); return;
      }
      const failure = url.searchParams.get('error_description') ?? url.searchParams.get('error');
      response.once('finish', () => server.closeAllConnections());
      response.writeHead(failure ? 400 : 200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(callbackPage(failure));
      finish(failure ? new Error(failure) : undefined, url.toString(), true);
    });
    const finish = (error?: unknown, callbackUrl?: string, responding = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.close();
      if (!responding) server.closeAllConnections();
      if (error !== undefined) { reject(error); return; }
      resolveCallback(callbackUrl!);
    };
    const timeout = setTimeout(() => finish(new Error('login_browser_callback_timed_out')), 300_000);
    server.once('error', (error) => finish(error));
    server.listen(0, '127.0.0.1', () => {
      if (settled) { server.close(); return; }
      const address = server.address();
      if (!address || typeof address === 'string') { finish(new Error('login_invalid_callback_address')); return; }
      redirect.port = String(address.port);
      context.authConfiguration.redirectUri = redirect.toString();
      void Promise.resolve().then(async () => {
        if (settled) return;
        const started = await context.core.auth.beginAuthorizationCode();
        if (settled) return;
        ready = true;
        terminal.write('Opening your browser to sign in…');
        terminal.write(`Waiting for the browser… if it did not open, visit:\n  ${started.authorizationUrl}`);
        openBrowser(started.authorizationUrl);
      }).catch((error: unknown) => finish(error));
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
  const logo = readFileSync(new URL('assets/tray.png', resources)).toString('base64');
  return readFileSync(new URL('templates/login-callback.html', resources), 'utf8')
    .replace('{{font}}', font)
    .replace('{{logo}}', logo)
    .replaceAll('{{heading}}', signedIn ? 'Return to your terminal' : 'Sign-in failed')
    .replace('{{statusLabel}}', signedIn ? 'Finalizing sign-in' : 'Sign-in error')
    .replace('{{statusClass}}', signedIn ? '' : 'failed')
    .replace('{{message}}', signedIn ? 'Sign-in is complete only when your terminal says Signed in.' : escapeHtml(failure));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/gu, (character) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character] ?? character
  ));
}

/** Best effort: a browser that will not open is a printed URL, not a failed login. */
export function openBrowser(url: string, platform = process.platform): void {
  // Set where no browser should ever be launched — a test, or a shell that only wants the URL.
  if (process.env.INHERITI_ELEMENTS_NO_BROWSER) return;
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'powershell.exe' : 'xdg-open';
  const args = platform === 'win32'
    ? ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath '${url.replaceAll("'", "''")}'`]
    : [url];
  try {
    const browser = spawn(command, args, platform === 'win32' ? { stdio: 'ignore' } : { stdio: 'ignore', detached: true });
    browser.once('error', () => undefined);
    if (platform !== 'win32') browser.unref();
  } catch {
    // The URL is already on screen; the operator can open it themselves.
  }
}
