import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { createNodeSafeKeyProDevice } from '@safetech/inheriti-core-sdk/node';
import { businessDeployment, businessUiRpId } from '@safetech/inheriti-elements-core/node';

const canceled = () => new Error('local_delivery_canceled');
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const image = (name: string) => `data:image/png;base64,${readFileSync(new URL(`./assets/${name}.png`, import.meta.url)).toString('base64')}`;
const logo = image('inheriti-business-logo');
const pro = image('safekey-pro');
const mobile = image('safekey-mobile');
const styles = `<style>
  :root{font-family:Arial,sans-serif;color:#101828;background:#f9fafb;font-synthesis:none}
  *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}
  main{width:min(100%,640px);background:#fff;border:1px solid #eaecf0;border-radius:16px;box-shadow:0 16px 48px #0a1c4d12;overflow:hidden}
  header{padding:24px 32px;border-bottom:1px solid #eaecf0}header img{display:block;width:180px;height:auto}
  .content{padding:32px}.eyebrow{color:#1642ba;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
  h1{font-size:26px;line-height:1.25;margin:10px 0 8px}p{line-height:1.5;color:#475467;margin:0 0 20px}
  .details{background:#fafcff;border:1px solid #e3f2fd;border-radius:8px;padding:16px;margin:24px 0}
  dl{display:grid;grid-template-columns:110px minmax(0,1fr);gap:8px 12px;margin:0;font-size:13px}dt{color:#475467}dd{margin:0;overflow-wrap:anywhere;font-weight:600}
  .choices{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
  button{font:inherit;cursor:pointer}button:focus-visible,input:focus-visible{outline:3px solid #75a9ff;outline-offset:2px}
  .choice{display:flex;align-items:center;gap:12px;width:100%;padding:16px;text-align:left;background:#fff;border:1px solid #d0d5dd;border-radius:8px;color:#101828}
  .choice:hover{border-color:#2962ff;background:#fafcff}.choice img{width:56px;height:56px;object-fit:contain;flex:none}
  .choice strong,.choice small{display:block}.choice small{color:#475467;font-size:12px;line-height:1.4;margin-top:4px}
  label{display:block;font-size:14px;font-weight:600;margin:0 0 8px}input{width:100%;height:44px;padding:10px 12px;border:1px solid #d0d5dd;border-radius:8px;font:inherit}
  .primary{background:#2962ff;color:#fff;border:0;border-radius:8px;padding:12px 20px;font-weight:600;margin-top:20px}.primary:hover{background:#1642ba}
  .status{display:flex;gap:12px;align-items:flex-start;background:#fafcff;border:1px solid #e3f2fd;border-radius:8px;padding:16px;color:#101828}
  .dot{width:12px;height:12px;flex:none;border-radius:50%;background:#2962ff;box-shadow:0 0 0 5px #e3f2fd;margin-top:4px}
  footer{padding:16px 32px;border-top:1px solid #eaecf0;color:#475467;font-size:12px}
  @media(max-width:520px){body{padding:12px}header,.content{padding:20px}footer{padding:16px 20px}dl{grid-template-columns:1fr}dd{margin-bottom:6px}}
</style>`;

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
  let cachedPin: Uint8Array | undefined;
  let rejectChoice: ((reason: Error) => void) | undefined;
  let rejectPin: ((reason: Error) => void) | undefined;
  const sockets = new Set<Socket>();
  const page = (title: string, body: string, refresh = false) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Inheriti Business</title>${refresh ? '<meta http-equiv="refresh" content="2">' : ''}${styles}</head><body><main><header><img src="${logo}" alt="Inheriti Business"></header><div class="content"><span class="eyebrow">Local approval</span><h1>${title}</h1>${body}<div class="details"><dl><dt>Organisation</dt><dd>${escapeHtml(context.organizationId)}</dd><dt>Plan</dt><dd>${escapeHtml(context.planId)}</dd><dt>${context.kind === 'ASSET' ? 'Asset' : 'Field'}</dt><dd>${escapeHtml(context.selector)}</dd></dl></div></div><footer>This approval stays on your device. Keep this page open until the request completes.</footer></main></body></html>`;
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; form-action 'self'; style-src 'unsafe-inline'; base-uri 'none'");
    if (request.headers.host !== `127.0.0.1:${port}` || request.url !== path) { response.writeHead(404).end(); return; }
    if (request.method === 'GET') {
      const title = state === 'choice' ? 'Choose your custodian device' : state === 'pin' ? 'Connect SafeKey Pro' : state === 'touch' ? 'Confirm on SafeKey Pro' : 'Waiting for authorisation';
      const body = state === 'choice'
        ? `<p>Where should this plan share be stored?</p><form method="post" class="choices">${device && rpId ? `<button class="choice" name="choice" value="pro"><img src="${pro}" alt=""><span><strong>SafeKey Pro</strong><small>Use your connected hardware device.</small></span></button>` : ''}<button class="choice" name="choice" value="mobile"><img src="${mobile}" alt=""><span><strong>SafeKey Mobile</strong><small>Approve the claim in your mobile app.</small></span></button></form>`
        : state === 'pin' ? '<p>Your custodian share is stored on your SafeKey Pro. Connect it and enter your PIN to continue.</p><form method="post"><label for="pin">Device PIN</label><input id="pin" type="password" name="pin" autocomplete="off" required maxlength="128" autofocus><button class="primary" type="submit">Connect &amp; collect</button></form>'
          : state === 'touch' ? `<p>Keep your SafeKey Pro connected.</p><div class="status" role="status"><span class="dot"></span><span>SafeKey Pro ${escapeHtml(touch)}: press and release the touch button.</span></div>`
            : '<p>The request is in progress.</p><div class="status" role="status"><span class="dot"></span><span>Waiting for the authorised reveal.</span></div>';
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
    }, proDevice, close: () => { signal.removeEventListener('abort', abort); clearPin(); rejectChoice?.(canceled()); rejectPin?.(canceled()); for (const socket of sockets) socket.destroy(); server.close(); } };
  } catch (error) {
    signal.removeEventListener('abort', abort); for (const socket of sockets) socket.destroy(); server.close(); throw error;
  }
}
