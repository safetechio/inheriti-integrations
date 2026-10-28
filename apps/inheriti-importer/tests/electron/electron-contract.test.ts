import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const electronRoot = resolve(process.cwd(), 'electron');
const preloadSource = readFileSync(resolve(electronRoot, 'preload.cjs'), 'utf8');

// `main.cjs` delegates to `electron/lib/*.cjs`, so the security contract is
// scanned across the whole main-process source tree, not just the entry file.
const mainSource = [
  readFileSync(resolve(electronRoot, 'main.cjs'), 'utf8'),
  ...readdirSync(resolve(electronRoot, 'lib'))
    .filter((name) => name.endsWith('.cjs'))
    .map((name) => readFileSync(resolve(electronRoot, 'lib', name), 'utf8')),
  ...readdirSync(resolve(electronRoot, 'lib/auth'))
    .filter((name) => name.endsWith('.cjs'))
    .map((name) => readFileSync(resolve(electronRoot, 'lib/auth', name), 'utf8')),
  ...readdirSync(resolve(electronRoot, 'ipc'))
    .filter((name) => name.endsWith('.cjs'))
    .map((name) => readFileSync(resolve(electronRoot, 'ipc', name), 'utf8')),
].join('\n');

// Strip comments before scanning for forbidden tokens, so prose like "the
// main process holds them" doesn't false-positive against the `process`
// global / Node built-ins the preload script must not reference.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}
const preloadCode = stripComments(preloadSource);

describe('Electron security contract', () => {
  it('keeps renderer isolation enabled', () => {
    expect(mainSource).toContain('contextIsolation: true');
    expect(mainSource).toContain('nodeIntegration: false');
    expect(mainSource).toContain('sandbox: true');
    expect(mainSource).toContain('webSecurity: true');
  });

  it('applies a restrictive response CSP and denies unsafe navigation', () => {
    expect(mainSource).toContain("default-src 'self'");
    expect(mainSource).toContain("object-src 'none'");
    expect(mainSource).toContain("frame-ancestors 'none'");
    expect(mainSource).toContain(`? "'self' 'wasm-unsafe-eval'"`);
    expect(mainSource).toContain('event.preventDefault()');
    expect(mainSource).toContain("return { action: 'deny' }");
    expect(mainSource).toContain('event.preventDefault()');
  });

  it('exposes only the documented IPC bridge surface', () => {
    expect(preloadSource).toContain("contextBridge.exposeInMainWorld('inheriti'");
    expect(preloadSource).toContain("ipcRenderer.invoke('vault:openFiles')");
    expect(preloadSource).toContain("ipcRenderer.invoke('api:request'");
    expect(preloadSource).toContain("ipcRenderer.invoke('development:deliverMasterKey'");
    expect(preloadSource).toContain("ipcRenderer.invoke('auth:login'");
    expect(preloadCode).not.toMatch(/\bprocess\b/);
    expect(preloadCode).not.toMatch(/require\(\s*['"](?!electron['"])/);
  });

  it('limits the local Organization Key simulator to its dedicated relay channel', () => {
    expect(mainSource).toContain("handle('development:deliverMasterKey'");
    expect(mainSource).toContain(
      'path: `/organizations/${encodeURIComponent(organizationId)}/master-key-relay`',
    );
    expect(mainSource).toContain('if (app.isPackaged) throw new Error');
  });

  it('validates API method and absolute path at the main-process boundary', () => {
    expect(mainSource).toContain('request.path must be an absolute API path');
    expect(mainSource).toContain('Unsupported method: ${method}');
    expect(mainSource).toContain("['GET', 'POST', 'PUT', 'PATCH', 'DELETE']");
  });

  it('rejects IPC calls from an untrusted sender', () => {
    expect(mainSource).toContain('Untrusted IPC sender');
    expect(mainSource).toContain('trustedWebContentsIds.has(event.sender.id)');
  });

  it('keeps OIDC and socket credentials in the main process', () => {
    expect(mainSource).toContain("code_challenge_method: 'S256'");
    expect(mainSource).toContain("path: '/user/login'");
    expect(mainSource).toContain('extraHeaders: cookieHeader');
    expect(mainSource).toContain(
      "const SOCKET_EVENTS = new Set(['tenant_changed', 'master_key_delivered'])",
    );
    expect(preloadSource).toContain("ipcRenderer.invoke('socket:subscribe'");
    expect(preloadSource).toContain("ipcRenderer.invoke('socket:unsubscribe'");
  });
});
