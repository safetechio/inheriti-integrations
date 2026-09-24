import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { createNodeSafeKeyProDevice } from '@safetech/inheriti-core-sdk/node';
import { brandPage, mobile, pro, renderTemplate } from './local-page.js';
import { businessDeployment, businessUiRpId, custodianShareCopy, waitForSafeKeyProDevice } from '@safetech/inheriti-elements-core/node';

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
  const details = renderTemplate('approval-details', { organization: escapeHtml(context.organizationId), plan: escapeHtml(context.planId), kind: context.kind === 'ASSET' ? 'Asset' : 'Field', selector: escapeHtml(context.selector) });
  const page = (title: string, body: string, refresh = false) => brandPage(title, body + details, { refresh, footer: 'This approval stays on your device. Keep this page open until the request completes.' });
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; font-src data:; form-action 'self'; style-src 'unsafe-inline'; base-uri 'none'");
    if (request.headers.host !== `127.0.0.1:${port}` || request.url !== path) { response.writeHead(404).end(); return; }
    if (request.method === 'GET') {
      const title = state === 'complete' ? 'Request complete' : state === 'failed' ? 'Request could not finish' : state === 'canceled' ? 'Request canceled'
        : state === 'choice' ? custodianShareCopy.choice.title
        : state === 'pin' ? firstClaim ? 'Save to SafeKey PRO' : 'Collect from SafeKey PRO'
          : state === 'touch' ? touch?.operation === 'write' ? 'Writing to SafeKey PRO' : touch?.operation === 'read' ? 'Reading from SafeKey PRO' : 'Unlock SafeKey PRO'
            : selectedDevice === 'mobile' ? 'Continue in SafeKey Mobile' : 'Completing your plan request';
      const body = state === 'complete' || state === 'failed' || state === 'canceled'
        ? renderTemplate('status', { message: state === 'complete' ? 'The protected data was delivered to a separate local page. You can close this approval page.' : state === 'failed' ? 'Return to your MCP client to check the request status and try again.' : 'The request was canceled. No further device action is needed.' })
        : state === 'choice'
          ? renderTemplate('device-choice', { intro: escapeHtml(custodianShareCopy.choice.intro), proChoice: rpId ? renderTemplate('pro-choice', { pro, title: custodianShareCopy.choice.proOption, description: custodianShareCopy.choice.proDescription }) : '', mobile, mobileTitle: custodianShareCopy.choice.mobileOption, mobileDescription: custodianShareCopy.choice.mobileDescription })
          : state === 'pin'
            ? renderTemplate('device-pin', { message: escapeHtml(firstClaim ? custodianShareCopy.firstAccess.proPin : custodianShareCopy.laterAccess.proPin), pro, action: firstClaim ? 'Write to device' : 'Connect &amp; collect' })
            : state === 'touch'
              ? renderTemplate('device-touch', { pro, touchPrompt: custodianShareCopy.choice.proTouch, message: touch?.operation === 'write' ? 'Saving the custodian share' : touch?.operation === 'read' ? 'Reading device data' : 'Connecting to device', attempt: String(touch?.attempt ?? ''), limit: String(touch?.limit ?? '') })
              : renderTemplate('device-waiting', { message: selectedDevice === 'mobile' ? escapeHtml(custodianShareCopy.firstAccess.mobileClaim) : selectedDevice === 'pro' ? escapeHtml(custodianShareCopy.choice.proConnect) : 'Keep this page open while Inheriti completes the authorised reveal.', image: selectedDevice === 'mobile' ? mobile : pro, alt: selectedDevice === 'mobile' ? 'SafeKey Mobile' : 'SafeKey PRO device', status: selectedDevice === 'mobile' ? 'Waiting for SafeKey Mobile' : selectedDevice === 'pro' ? 'Waiting for SafeKey PRO' : 'Continuing securely' });
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
        if (selected !== 'mobile' && (selected !== 'pro' || !rpId)) { response.writeHead(400).end(); return; }
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
    const connectPro = async (signal?: AbortSignal) => createNodeSafeKeyProDevice({ device: await waitForSafeKeyProDevice(device, signal), rpId: rpId!,
      getPin: async () => {
        if (signal?.aborted) throw canceled();
        if (cachedPin) return cachedPin.slice();
        selectedDevice = 'pro';
        state = 'pin';
        const requested = new Promise<Uint8Array>((resolve, reject) => { pin = resolve; rejectPin = reject; });
        openPage();
        return requested;
      },
      onTouch: (operation, attempt, limit) => { state = 'touch'; touch = { operation, attempt, limit }; },
    });
    const proDevice = rpId ? {
      write: async (share: Parameters<ReturnType<typeof createNodeSafeKeyProDevice>['write']>[0], operationSignal?: AbortSignal) =>
        (await connectPro(operationSignal ?? signal)).write(share, operationSignal),
      read: async (request: Parameters<ReturnType<typeof createNodeSafeKeyProDevice>['read']>[0], operationSignal?: AbortSignal) =>
        (await connectPro(operationSignal ?? signal)).read(request, operationSignal),
    } : undefined;
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
