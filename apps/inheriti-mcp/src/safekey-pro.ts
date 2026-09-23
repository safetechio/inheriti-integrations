import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { createNodeSafeKeyProDevice } from '@safetech/inheriti-core-sdk/node';
import { brandPage, mobile, pro } from './local-page.js';
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
  let state: 'choice' | 'pin' | 'touch' | 'waiting' | 'complete' | 'failed' | 'canceled' = 'waiting';
  let touch: { operation: 'login' | 'read' | 'write'; attempt: number; limit: number } | undefined;
  let selectedDevice: 'mobile' | 'pro' | undefined;
  let firstClaim = false;
  let choose: ((value: 'SK_MOBILE' | 'SK_PRO') => void) | undefined;
  let pin: ((value: Uint8Array) => void) | undefined;
  let cachedPin: Uint8Array | undefined;
  let rejectChoice: ((reason: Error) => void) | undefined;
  let rejectPin: ((reason: Error) => void) | undefined;
  const sockets = new Set<Socket>();
  let closingTimer: ReturnType<typeof setTimeout> | undefined;
  const page = (title: string, body: string, refresh = false) => brandPage(title, `${body}<div class="details"><dl><dt>Organisation</dt><dd>${escapeHtml(context.organizationId)}</dd><dt>Plan</dt><dd>${escapeHtml(context.planId)}</dd><dt>${context.kind === 'ASSET' ? 'Asset' : 'Field'}</dt><dd>${escapeHtml(context.selector)}</dd></dl></div>`, { refresh, footer: 'This approval stays on your device. Keep this page open until the request completes.' });
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; form-action 'self'; style-src 'unsafe-inline'; base-uri 'none'");
    if (request.headers.host !== `127.0.0.1:${port}` || request.url !== path) { response.writeHead(404).end(); return; }
    if (request.method === 'GET') {
      const title = state === 'complete' ? 'Request complete' : state === 'failed' ? 'Request could not finish' : state === 'canceled' ? 'Request canceled'
        : state === 'choice' ? 'Choose your custodian device'
        : state === 'pin' ? firstClaim ? 'Save to SafeKey Pro' : 'Collect from SafeKey Pro'
          : state === 'touch' ? touch?.operation === 'write' ? 'Writing to SafeKey Pro' : touch?.operation === 'read' ? 'Reading from SafeKey Pro' : 'Unlock SafeKey Pro'
            : selectedDevice === 'mobile' ? 'Continue in SafeKey Mobile' : 'Completing your plan request';
      const body = state === 'complete' ? '<p>The protected data was delivered to a separate local page. You can close this approval page.</p>'
        : state === 'failed' ? '<p>Return to your MCP client to check the request status and try again.</p>'
          : state === 'canceled' ? '<p>The request was canceled. No further device action is needed.</p>'
            : state === 'choice'
        ? `<p>Where should this plan share be stored?</p><form method="post" class="choices">${device && rpId ? `<button class="choice" name="choice" value="pro"><img src="${pro}" alt=""><span><strong>SafeKey Pro</strong><small>Use your connected hardware device.</small></span></button>` : ''}<button class="choice" name="choice" value="mobile"><img src="${mobile}" alt=""><span><strong>SafeKey Mobile</strong><small>Approve the claim in your mobile app.</small></span></button></form>`
        : state === 'pin' ? `<p>${firstClaim ? 'Connect your SafeKey Pro and enter its PIN to save the custodian share.' : 'Your custodian share is stored on SafeKey Pro. Connect it and enter its PIN to continue.'}</p><div class="device-panel"><img src="${pro}" alt="SafeKey Pro device"><span>Keep your device connected during this request.</span></div><form method="post"><label for="pin">Device PIN</label><input id="pin" type="password" name="pin" autocomplete="off" required maxlength="128" autofocus><button class="primary" type="submit">${firstClaim ? 'Write to device' : 'Connect &amp; collect'}</button></form>`
          : state === 'touch' ? `<p>Keep your SafeKey Pro connected and press and release its touch button.</p><div class="device-panel"><img src="${pro}" alt="SafeKey Pro device"><div class="status" role="status"><span class="dot"></span><span>${touch?.operation === 'write' ? 'Saving the custodian share' : touch?.operation === 'read' ? 'Reading device data' : 'Connecting to device'}<small>Touch request ${touch?.attempt} of ${touch?.limit}</small></span></div></div>`
            : `<p>${selectedDevice === 'mobile' ? 'Open SafeKey Mobile and approve the custodian share request.' : 'Keep this page open while Inheriti completes the authorised reveal.'}</p><div class="device-panel"><img src="${selectedDevice === 'mobile' ? mobile : pro}" alt="${selectedDevice === 'mobile' ? 'SafeKey Mobile' : 'SafeKey Pro device'}"><div class="status" role="status"><span class="dot"></span><span>${selectedDevice === 'mobile' ? 'Waiting for SafeKey Mobile' : 'Continuing securely'}</span></div></div>`;
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page(title, body, state === 'touch' || state === 'waiting'));
      return;
    }
    if (request.method !== 'POST' || request.headers.origin !== `http://127.0.0.1:${port}`) { response.writeHead(405).end(); return; }
    if (state !== 'choice' && state !== 'pin') { response.writeHead(303, { Location: path }).end(); return; }
    let body = '';
    request.on('data', chunk => { body += chunk; if (body.length > 512) request.destroy(); });
    request.on('end', () => {
      if (body.length > 512) { response.writeHead(413).end(); return; }
      const fields = new URLSearchParams(body);
      if (state === 'choice') {
        const selected = fields.get('choice');
        if (selected !== 'mobile' && (selected !== 'pro' || !device || !rpId)) { response.writeHead(400).end(); return; }
        selectedDevice = selected; firstClaim = selected === 'pro';
        state = 'waiting'; choose?.(selected === 'pro' ? 'SK_PRO' : 'SK_MOBILE'); choose = undefined;
      } else {
        const value = fields.get('pin');
        if (!value || value.length > 128 || !/^[\x20-\x7e]+$/.test(value)) { response.writeHead(400).end(); return; }
        cachedPin = Uint8Array.from(Buffer.from(value, 'ascii'));
        state = 'waiting'; pin?.(cachedPin.slice()); pin = undefined;
      }
      response.writeHead(303, { Location: path }).end();
    });
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  const clearPin = () => { cachedPin?.fill(0); cachedPin = undefined; };
  const abort = () => { clearPin(); rejectChoice?.(canceled()); rejectPin?.(canceled()); };
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
        if (cachedPin) return cachedPin.slice();
        selectedDevice = 'pro';
        state = 'pin';
        const requested = new Promise<Uint8Array>((resolve, reject) => { pin = resolve; rejectPin = reject; });
        openPage();
        return requested;
      },
      onTouch: (operation, attempt, limit) => { state = 'touch'; touch = { operation, attempt, limit }; },
    }) : undefined;
    const shutdown = () => {
      if (closingTimer) clearTimeout(closingTimer);
      signal.removeEventListener('abort', abort); clearPin(); rejectChoice?.(canceled()); rejectPin?.(canceled());
      for (const socket of sockets) socket.destroy(); server.close();
    };
    return { selectCustodianDevice: () => {
      if (signal.aborted) throw canceled();
      state = 'choice';
      const choice = new Promise<'SK_MOBILE' | 'SK_PRO'>((resolve, reject) => { choose = resolve; rejectChoice = reject; });
      openPage();
      return choice;
    }, proDevice, close: (outcome?: 'complete' | 'failed' | 'canceled') => {
      if (!outcome || !opened) { shutdown(); return; }
      state = outcome;
      signal.removeEventListener('abort', abort); clearPin(); rejectChoice?.(canceled()); rejectPin?.(canceled());
      closingTimer = setTimeout(shutdown, 15_000);
      closingTimer.unref();
    } };
  } catch (error) {
    signal.removeEventListener('abort', abort); for (const socket of sockets) socket.destroy(); server.close(); throw error;
  }
}
