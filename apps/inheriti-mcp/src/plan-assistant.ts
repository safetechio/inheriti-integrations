import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import type { Socket } from 'node:net';
import { getLocalAssistantInstallStatus, installLocalAssistant } from '@safetech/inheriti-elements-core/node-base';
import type { LocalAssistantInstallProgress } from '@safetech/inheriti-elements-core/node-base';
import { planAssistantSetupPage } from './plan-assistant-page.js';

function secureResponse(response: ServerResponse) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Referrer-Policy', 'same-origin');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
}

async function readForm(request: IncomingMessage): Promise<URLSearchParams> {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1024) throw new Error('setup_request_too_large');
  }
  return new URLSearchParams(body);
}

async function serveFont(response: ServerResponse) {
  try { response.writeHead(200, { 'Content-Type': 'font/ttf' }).end(await readFile(new URL('./assets/font-app.ttf', import.meta.url))); }
  catch { response.writeHead(404).end(); }
}

/** Consent and installation stay in the ephemeral desktop window. */
export async function ensureLocalAssistant(signal: AbortSignal, open: (url: string) => void): Promise<{ executablePath: string; modelPath: string }> {
  const installed = await getLocalAssistantInstallStatus();
  if (signal.aborted) throw new Error('local_plan_canceled');
  if (installed.installed) return installed;
  const path = `/${randomBytes(24).toString('hex')}`;
  const csrf = randomBytes(24).toString('hex');
  let port = 0;
  let state: 'consent' | 'installing' | 'failed' = 'consent';
  let progress: LocalAssistantInstallProgress | undefined;
  let settled = false;
  const installation = new AbortController();
  const sockets = new Set<Socket>();
  let resolve!: (value: { executablePath: string; modelPath: string }) => void;
  let reject!: (error: Error) => void;
  const result = new Promise<{ executablePath: string; modelPath: string }>((yes, no) => { resolve = yes; reject = no; });
  const fail = (error: Error) => { if (!settled) { settled = true; installation.abort(); reject(error); } };
  const page = () => planAssistantSetupPage(path, csrf, state, progress);
  const startInstall = () => {
    state = 'installing';
    void installLocalAssistant({ signal: installation.signal, onProgress: value => { progress = value; } })
      .then(value => { if (!settled) { settled = true; resolve(value); } })
      .catch(() => { state = 'failed'; fail(new Error('local_assistant_install_failed')); });
  };
  const handleRequest = async (request: IncomingMessage, response: ServerResponse) => {
    secureResponse(response);
    if (request.headers.host !== `127.0.0.1:${port}`) { response.writeHead(404).end(); return; }
    if (request.url === `${path}/font-app.ttf` && request.method === 'GET') return serveFont(response);
    if (request.url !== path) { response.writeHead(404).end(); return; }
    if (request.method === 'GET') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page()); return; }
    if (request.method !== 'POST' || request.headers.origin !== `http://127.0.0.1:${port}` || state === 'failed' || settled) { response.writeHead(403).end(); return; }
    const data = await readForm(request);
    if (data.get('csrf') !== csrf) { response.writeHead(403).end(); return; }
    if (data.get('action') === 'cancel') { response.writeHead(200).end('Canceled.'); fail(new Error('local_plan_canceled')); return; }
    if (data.get('action') !== 'install' || state !== 'consent') { response.writeHead(400).end(); return; }
    startInstall();
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page());
  };
  const server = createServer((request, response) => {
    void handleRequest(request, response).catch(() => { if (!response.headersSent) response.writeHead(400).end(); });
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  const abort = () => fail(new Error('local_plan_canceled'));
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) abort();
    if (settled) return await result;
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    if (signal.aborted) abort();
    if (settled) return await result;
    port = (server.address() as { port: number }).port;
    open(`http://127.0.0.1:${port}${path}`);
    const timer = setTimeout(() => fail(new Error('local_plan_expired')), 10 * 60_000);
    try { return await result; } finally { clearTimeout(timer); }
  } finally {
    signal.removeEventListener('abort', abort);
    for (const socket of sockets) socket.destroy();
    server.close();
  }
}
