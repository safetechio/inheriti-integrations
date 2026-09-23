import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { createNodeSafeKeyProDevice } from '@safetech/inheriti-core-sdk/node';
import { businessDeployment, businessUiRpId } from '@safetech/inheriti-elements-core/node';

const canceled = () => new Error('local_delivery_canceled');
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

/** Human-only browser side channel. Its token, PIN and URL never enter an MCP result. */
export async function openSafeKeyProPrompt(deployment: unknown, device: string | undefined,
  context: { organizationId: string; planId: string; selector: string; kind: 'FIELD' | 'ASSET' }, signal: AbortSignal,
  open?: (url: string) => void) {
  if (signal.aborted) throw canceled();
  const channel = businessDeployment(deployment);
  const rpId = channel ? businessUiRpId(channel) : undefined;
  const token = randomBytes(24).toString('hex');
  const path = `/${token}`;
  let port = 0;
  let state: 'choice' | 'pin' | 'touch' | 'waiting' = 'waiting';
  let touch = '';
  let choose: ((value: 'SK_MOBILE' | 'SK_PRO') => void) | undefined;
  let pin: ((value: Uint8Array) => void) | undefined;
  let rejectChoice: ((reason: Error) => void) | undefined;
  let rejectPin: ((reason: Error) => void) | undefined;
  const sockets = new Set<Socket>();
  const page = (body: string, refresh = false) => `<!doctype html><html><head><title>Inheriti local approval</title>${refresh ? '<meta http-equiv="refresh" content="2">' : ''}</head><body><h1>Inheriti local approval</h1><p>Organization: ${escapeHtml(context.organizationId)}</p><p>Plan: ${escapeHtml(context.planId)}</p><p>${context.kind === 'ASSET' ? 'Download asset' : 'Reveal field'}: ${escapeHtml(context.selector)}</p>${body}</body></html>`;
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; form-action 'self'; style-src 'unsafe-inline'; base-uri 'none'");
    if (request.headers.host !== `127.0.0.1:${port}` || request.url !== path) { response.writeHead(404).end(); return; }
    if (request.method === 'GET') {
      const body = state === 'choice'
        ? `<p>Where should this plan share be stored?</p><form method="post"><button name="choice" value="mobile">SafeKey Mobile</button>${device && rpId ? '<button name="choice" value="pro">SafeKey PRO (connected locally)</button>' : ''}</form>`
        : state === 'pin' ? '<p>Enter your SafeKey PRO PIN on this device.</p><form method="post"><input type="password" name="pin" autocomplete="off" required maxlength="128"><button type="submit">Continue</button></form>'
          : state === 'touch' ? `<p>SafeKey PRO ${touch}: press and release the touch button.</p>`
            : '<p>Waiting for the authorized reveal. Keep this page open.</p>';
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page(body, state === 'touch' || state === 'waiting'));
      return;
    }
    if (request.method !== 'POST' || (state !== 'choice' && state !== 'pin') || request.headers.origin !== `http://127.0.0.1:${port}`) { response.writeHead(405).end(); return; }
    let body = '';
    request.on('data', chunk => { body += chunk; if (body.length > 512) request.destroy(); });
    request.on('end', () => {
      if (body.length > 512) { response.writeHead(413).end(); return; }
      const fields = new URLSearchParams(body);
      if (state === 'choice') {
        const selected = fields.get('choice');
        if (selected !== 'mobile' && (selected !== 'pro' || !device || !rpId)) { response.writeHead(400).end(); return; }
        state = 'waiting'; choose?.(selected === 'pro' ? 'SK_PRO' : 'SK_MOBILE'); choose = undefined;
      } else {
        const value = fields.get('pin');
        if (!value || value.length > 128 || !/^[\x20-\x7e]+$/.test(value)) { response.writeHead(400).end(); return; }
        const bytes = Uint8Array.from(Buffer.from(value, 'ascii'));
        state = 'waiting'; pin?.(bytes); pin = undefined;
      }
      response.writeHead(303, { Location: path }).end();
    });
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  const abort = () => { rejectChoice?.(canceled()); rejectPin?.(canceled()); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    port = (server.address() as { port: number }).port;
    const url = `http://127.0.0.1:${port}${path}`;
    let opened = false;
    const openPage = () => {
      if (opened) return;
      opened = true;
      if (open) open(url);
      else {
        const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
        const child = spawn(command, [url], { detached: true, stdio: 'ignore' });
        child.on('error', abort); child.unref();
      }
    };
    const proDevice = device && rpId ? createNodeSafeKeyProDevice({ device, rpId,
      getPin: async () => {
        if (signal.aborted) throw canceled();
        state = 'pin';
        const requested = new Promise<Uint8Array>((resolve, reject) => { pin = resolve; rejectPin = reject; });
        openPage();
        return requested;
      },
      onTouch: (operation, attempt, limit) => { state = 'touch'; touch = `${operation} ${attempt}/${limit}`; },
    }) : undefined;
    return { selectCustodianDevice: () => {
      if (signal.aborted) throw canceled();
      state = 'choice';
      const choice = new Promise<'SK_MOBILE' | 'SK_PRO'>((resolve, reject) => { choose = resolve; rejectChoice = reject; });
      openPage();
      return choice;
    }, proDevice, close: () => { signal.removeEventListener('abort', abort); rejectChoice?.(canceled()); rejectPin?.(canceled()); for (const socket of sockets) socket.destroy(); server.close(); } };
  } catch (error) {
    signal.removeEventListener('abort', abort); for (const socket of sockets) socket.destroy(); server.close(); throw error;
  }
}
