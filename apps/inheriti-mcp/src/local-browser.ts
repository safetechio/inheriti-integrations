import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import type { Socket } from 'node:net';
import { brandPage } from './local-page.js';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const display = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value);

/** No URL or value leaves this process through the MCP transport. Resolves only after local delivery. */
export async function deliverInBrowser(selector: string, value: unknown, options: { timeoutMs?: number; open?: (url: string) => void; signal?: AbortSignal } = {}): Promise<void> {
  const token = randomBytes(24).toString('hex');
  const path = `/${token}`;
  const timeoutMs = options.timeoutMs ?? 45_000;
  let complete: (() => void) | undefined;
  let port = 0;
  const sockets = new Set<Socket>();
  let fail: ((error: Error) => void) | undefined;
  const consumed = new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
  const onAbort = () => { complete = undefined; fail?.(new Error('local_delivery_canceled')); };
  if (options.signal?.aborted) throw new Error('local_delivery_canceled');
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; form-action 'self'; style-src 'unsafe-inline'; base-uri 'none'");
    if (request.headers.host !== `127.0.0.1:${port}` || request.url !== path) {
      response.writeHead(404).end(); return;
    }
    if (request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(brandPage('Reveal protected field', `<p>Reveal this field on your device?</p><div class="details"><dl><dt>Field</dt><dd>${escapeHtml(selector)}</dd></dl></div><form method="post"><button class="primary" type="submit">Reveal once</button></form>`, { eyebrow: 'Protected plan data', footer: 'The field is shown only after you approve it here. This link works once.' }));
      return;
    }
    if (request.method === 'POST' && !complete) { response.writeHead(410).end(); return; }
    if (request.method === 'POST' && complete) {
      const done = complete; complete = undefined;
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(brandPage('Protected field revealed', `<p>${escapeHtml(selector)}</p><pre class="secret">${escapeHtml(display(value))}</pre>`, { eyebrow: 'Protected plan data', footer: 'This value was delivered once. Close this page when you are done.' }));
      done(); return;
    }
    response.writeHead(405).end();
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    if (options.signal?.aborted) throw new Error('local_delivery_canceled');
    port = (server.address() as { port: number }).port;
    const url = `http://127.0.0.1:${port}${path}`;
    if (options.open) options.open(url);
    else {
      const child = spawn(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open', [url], { detached: true, stdio: 'ignore' });
      child.on('error', () => fail?.(new Error('local_browser_unavailable')));
      child.unref();
    }
    const timer = setTimeout(() => { complete = undefined; fail?.(new Error('local_delivery_expired')); }, timeoutMs);
    try { await consumed; } finally { clearTimeout(timer); }
  } finally { options.signal?.removeEventListener('abort', onAbort); complete = undefined; for (const socket of sockets) socket.destroy(); server.close(); }
}

/** The MCP result contains status only; a person must accept this one-time attachment locally. */
export async function deliverAssetInBrowser(fileName: string, bytes: Uint8Array, options: { timeoutMs?: number; open?: (url: string) => void; signal?: AbortSignal; mimeType?: string } = {}): Promise<void> {
  if (options.signal?.aborted) throw new Error('local_delivery_canceled');
  const token = randomBytes(24).toString('hex');
  const path = `/${token}`;
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'asset.bin';
  const extension = safeName.includes('.') ? safeName.split('.').at(-1)!.toUpperCase().slice(0, 5) : options.mimeType?.split('/')[1]?.toUpperCase().slice(0, 5) ?? 'FILE';
  const size = bytes.byteLength < 1024 ? '<1 KB' : bytes.byteLength < 1024 * 1024 ? `${(bytes.byteLength / 1024).toFixed(1)} KB` : `${(bytes.byteLength / (1024 * 1024)).toFixed(1)} MB`;
  const fileCard = `<div class="file-card"><span class="file-icon" aria-hidden="true">${escapeHtml(extension)}</span><span><strong>${escapeHtml(safeName)}</strong><small>${escapeHtml(extension)} file · ${escapeHtml(size)}</small></span></div>`;
  const sockets = new Set<Socket>();
  let port = 0;
  let delivered = false;
  let complete: (() => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  const consumed = new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
  const onAbort = () => { complete = undefined; fail?.(new Error('local_delivery_canceled')); };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; form-action 'self'; style-src 'unsafe-inline'; base-uri 'none'");
    if (request.headers.host !== `127.0.0.1:${port}` || request.url !== path) { response.writeHead(404).end(); return; }
    if (request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(brandPage('Download protected file', `<p>Review the file details before downloading.</p>${fileCard}<form method="post"><button class="primary" type="submit">Download file</button></form>`, { eyebrow: 'Protected plan data', footer: 'This file is delivered once to your device. The download link will then close.' }));
      return;
    }
    if (request.method === 'POST' && !complete) { response.writeHead(410).end(); return; }
    if (request.method === 'POST' && complete) {
      const done = complete; complete = undefined;
      response.once('finish', done);
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${safeName}"`, 'Content-Length': bytes.byteLength });
      response.end(bytes);
      return;
    }
    response.writeHead(405).end();
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    if (options.signal?.aborted) throw new Error('local_delivery_canceled');
    port = (server.address() as { port: number }).port;
    const url = `http://127.0.0.1:${port}${path}`;
    if (options.open) options.open(url);
    else {
      const child = spawn(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open', [url], { detached: true, stdio: 'ignore' });
      child.on('error', () => fail?.(new Error('local_browser_unavailable')));
      child.unref();
    }
    const timer = setTimeout(() => { complete = undefined; fail?.(new Error('local_delivery_expired')); }, options.timeoutMs ?? 45_000);
    try { await consumed; delivered = true; } finally { clearTimeout(timer); }
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
    complete = undefined;
    if (!delivered) for (const socket of sockets) socket.destroy();
    server.close();
  }
}
