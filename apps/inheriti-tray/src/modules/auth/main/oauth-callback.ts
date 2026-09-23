import { createServer } from 'node:http';
import { trayMessages as messages } from '../../../messages.js';

export function waitForCallback(authorizationUrl: string, openBrowser: (url: string) => Promise<void>, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error(messages.signInCanceled)); return; }
    const server = createServer((request, response) => {
      let url: URL;
      try { url = new URL(request.url ?? '/', 'http://127.0.0.1:53682'); }
      catch { response.writeHead(400).end(); return; }
      if (url.pathname !== '/oauth/callback') { response.writeHead(404).end(); return; }
      server.close();
      const error = url.searchParams.get('error');
      if (error) { response.writeHead(400).end(messages.signInBrowserFailed); reject(new Error(error)); return; }
      if (!url.searchParams.has('code') || !url.searchParams.has('state')) { response.writeHead(400).end(); reject(new Error(messages.invalidSignInCallback)); return; }
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(messages.signInBrowserDone);
      resolve(url.toString());
    });
    const timeout = setTimeout(() => { server.close(); reject(new Error(messages.signInTimedOut)); }, 300_000);
    signal.addEventListener('abort', () => { server.close(); reject(new Error(messages.signInCanceled)); }, { once: true });
    server.once('close', () => clearTimeout(timeout));
    server.once('error', reject);
    server.listen(53682, '127.0.0.1', () => {
      void openBrowser(authorizationUrl).catch((error: unknown) => { server.close(); reject(error); });
    });
  });
}

export function untilCanceled<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error(messages.signInCanceled));
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new Error(messages.signInCanceled));
    signal.addEventListener('abort', cancel, { once: true });
    void operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
  });
}
