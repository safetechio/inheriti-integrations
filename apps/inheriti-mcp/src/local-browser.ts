import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import type { Socket } from 'node:net';
import { brandPage, renderTemplate } from './local-page.js';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const display = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value);

export function openLocalBrowser(url: string, onFailure: (error: Error) => void): void {
  const child = spawn(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open', [url], { detached: true, stdio: 'ignore' });
  const fail = () => onFailure(new Error('local_browser_unavailable'));
  child.once('error', fail);
  child.once('exit', (code, signal) => { if ((process.platform !== 'win32' && code !== 0) || signal) fail(); });
  child.unref();
}

/** No URL or value leaves this process through the MCP transport. Resolves only after local delivery. */
export async function deliverInBrowser(selector: string, value: unknown, options: { timeoutMs?: number; open?: (url: string) => void; signal?: AbortSignal } = {}): Promise<void> {
  return deliverFieldsInBrowser([{ selector, value }], options);
}

export async function deliverFieldsInBrowser(fields: ReadonlyArray<{ selector: string; value: unknown }>, options: { timeoutMs?: number; open?: (url: string) => void; signal?: AbortSignal } = {}): Promise<void> {
  return deliverSelectionInBrowser(fields, [], options);
}

export async function deliverSelectionInBrowser(
  fields: ReadonlyArray<{ selector: string; value: unknown }>,
  assets: ReadonlyArray<{ selector: string; fileName: string; bytes: Uint8Array; mimeType?: string }>,
  options: { timeoutMs?: number; open?: (url: string) => void; signal?: AbortSignal } = {},
): Promise<void> {
  if (options.signal?.aborted) throw new Error('local_delivery_canceled');
  const single = fields.length === 1 && assets.length === 0;
  const path = `/${randomBytes(24).toString('hex')}`;
  const files = assets.map((asset, index) => ({
    selector: asset.selector,
    name: asset.fileName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'asset.bin',
    bytes: asset.bytes,
    path: `${path}/${index}`,
    consumed: false,
  }));
  let approved = false;
  let pending = 1 + files.length;
  let delivered = false;
  let complete: (() => void) | undefined;
  let port = 0;
  const sockets = new Set<Socket>();
  let fail: ((error: Error) => void) | undefined;
  const consumed = new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
  const finished = () => { pending -= 1; if (pending === 0) complete?.(); };
  const onAbort = () => { complete = undefined; fail?.(new Error('local_delivery_canceled')); };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; font-src data:; form-action 'self'; style-src 'unsafe-inline'; base-uri 'none'");
    const file = files.find(item => item.path === request.url);
    if (request.headers.host !== `127.0.0.1:${port}` || (request.url !== path && !file)) {
      response.writeHead(404).end(); return;
    }
    if (file) {
      if (request.method !== 'POST') { response.writeHead(405).end(); return; }
      if (!approved) { response.writeHead(403).end(); return; }
      if (file.consumed || !complete) { response.writeHead(410).end(); return; }
      file.consumed = true;
      response.once('finish', finished);
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${file.name}"`, 'Content-Length': file.bytes.byteLength });
      response.end(file.bytes);
      return;
    }
    if (approved || !complete) { response.writeHead(410).end(); return; }
    if (request.method === 'GET') {
      const selectors = fields.map(field => escapeHtml(field.selector)).concat(files.map(file => `${escapeHtml(file.selector)} (${escapeHtml(file.name)})`));
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(brandPage(single ? 'Reveal protected field' : assets.length ? 'Reveal protected data' : 'Reveal protected fields', renderTemplate('reveal-confirm', {
        prompt: single ? 'Reveal this field on your device?' : `Reveal these ${selectors.length} items on your device?`,
        label: single ? 'Field' : assets.length ? 'Selected data' : 'Fields',
        selector: selectors.join('</dd><dd>'),
      }), { eyebrow: 'Protected plan data', footer: single ? 'The field is shown only after you approve it here. This link works once.' : 'The selected data is delivered only after you approve it here. Each item works once.' }));
      return;
    }
    if (request.method === 'POST') {
      approved = true;
      const values = fields.map(field => renderTemplate('reveal-result', { selector: escapeHtml(field.selector), value: escapeHtml(display(field.value) ?? '') })).join('');
      const downloads = files.map(file => renderTemplate('download-confirm', {
        extension: escapeHtml(file.name.includes('.') ? file.name.split('.').at(-1)!.toUpperCase().slice(0, 5) : 'FILE'),
        name: escapeHtml(file.name),
        size: escapeHtml(file.bytes.byteLength < 1024 ? '<1 KB' : `${(file.bytes.byteLength / 1024).toFixed(1)} KB`),
        action: file.path,
      })).join('');
      response.once('finish', finished);
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(brandPage(single ? 'Protected field revealed' : assets.length ? 'Protected data approved' : 'Protected fields revealed', values + downloads, { eyebrow: 'Protected plan data', footer: single ? 'This value was delivered once. Close this page when you are done.' : assets.length ? 'Download each file once. Keep this page open until all files are delivered.' : 'These values were delivered once. Close this page when you are done.' }));
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
    else openLocalBrowser(url, error => fail?.(error));
    const timer = setTimeout(() => { complete = undefined; fail?.(new Error('local_delivery_expired')); }, options.timeoutMs ?? (assets.length ? 300_000 : 45_000));
    try { await consumed; delivered = true; } finally { clearTimeout(timer); }
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
    complete = undefined;
    if (!delivered) for (const socket of sockets) socket.destroy();
    server.close();
  }
}

/** The MCP result contains status only; a person must accept this one-time attachment locally. */
export async function deliverAssetInBrowser(fileName: string, bytes: Uint8Array, options: { timeoutMs?: number; open?: (url: string) => void; signal?: AbortSignal; mimeType?: string } = {}): Promise<void> {
  if (options.signal?.aborted) throw new Error('local_delivery_canceled');
  const token = randomBytes(24).toString('hex');
  const path = `/${token}`;
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'asset.bin';
  const extension = safeName.includes('.') ? safeName.split('.').at(-1)!.toUpperCase().slice(0, 5) : options.mimeType?.split('/')[1]?.toUpperCase().slice(0, 5) ?? 'FILE';
  const size = bytes.byteLength < 1024 ? '<1 KB' : bytes.byteLength < 1024 * 1024 ? `${(bytes.byteLength / 1024).toFixed(1)} KB` : `${(bytes.byteLength / (1024 * 1024)).toFixed(1)} MB`;
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
    response.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; font-src data:; form-action 'self'; style-src 'unsafe-inline'; base-uri 'none'");
    if (request.headers.host !== `127.0.0.1:${port}` || request.url !== path) { response.writeHead(404).end(); return; }
    if (request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(brandPage('Download protected file', renderTemplate('download-confirm', { extension: escapeHtml(extension), name: escapeHtml(safeName), size: escapeHtml(size) }), { eyebrow: 'Protected plan data', footer: 'This file is delivered once to your device. The download link will then close.' }));
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
    else openLocalBrowser(url, error => fail?.(error));
    const timer = setTimeout(() => { complete = undefined; fail?.(new Error('local_delivery_expired')); }, options.timeoutMs ?? 45_000);
    try { await consumed; delivered = true; } finally { clearTimeout(timer); }
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
    complete = undefined;
    if (!delivered) for (const socket of sockets) socket.destroy();
    server.close();
  }
}
