import { describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { handleLine, runProtocol } from '../../src-tauri/sidecar/protocol.js';
import type { WorkspaceSession } from '../../src-tauri/sidecar/session.js';

const organizationId = '13ac865a-d60c-4f8c-a783-050bd478f967';
const copyId = '58513941-c2ca-448a-a7b1-2d41316a54f0';

function session() {
  return {
    status: vi.fn(async () => ({ signedIn: true })),
    signIn: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    tryBrowserSignIn: vi.fn(async () => false),
    listOrganizations: vi.fn(async () => [{ id: organizationId, name: 'Team' }]),
    selectOrganization: vi.fn(async () => undefined),
    getFileAccess: vi.fn(async () => ({ copyId, status: 'READY', deployment: 'dev', origin: 'REVEAL', recipient: 'member-1', expiresAt: null, allowedUses: 1, secret: 'must-not-leak' })),
    inspectStartupFile: vi.fn(async () => ({ copyId, status: 'READY', deployment: 'dev', origin: 'REVEAL', recipient: 'member-1', expiresAt: null, allowedUses: 1, secret: 'must-not-leak' })),
  };
}

describe('Workspace host protocol', () => {
  it('accepts only bounded operations and fixed request fields', async () => {
    const host = session();
    expect(await handleLine(JSON.stringify({ id: '1', op: 'selectOrganization', organizationId }), host as unknown as WorkspaceSession))
      .toEqual({ id: '1', ok: true, result: { signedIn: true } });
    expect(host.selectOrganization).toHaveBeenCalledWith(organizationId);
    expect(await handleLine(JSON.stringify({ id: '2', op: 'getFileAccess', copyId }), host as unknown as WorkspaceSession))
      .toEqual({ id: '2', ok: true, result: { copyId, status: 'READY', deployment: 'dev', origin: 'REVEAL', recipient: 'member-1', expiresAt: null, allowedUses: 1 } });
    expect(await handleLine(JSON.stringify({ id: '3', op: 'getFileAccess', copyId: '../invalid' }), host as unknown as WorkspaceSession))
      .toEqual({ id: '3', ok: false, code: 'invalid_copy_id' });
    expect(await handleLine(JSON.stringify({ id: '4', op: 'opening' }), host as unknown as WorkspaceSession))
      .toEqual({ id: '4', ok: false, code: 'unsupported_operation' });
    expect(await handleLine(JSON.stringify({ id: '5', op: 'inspectStartupFile', filePath: '/ignored/attacker.inheriti' }), host as unknown as WorkspaceSession))
      .toEqual({ id: '5', ok: true, result: { copyId, status: 'READY', deployment: 'dev', origin: 'REVEAL', recipient: 'member-1', expiresAt: null, allowedUses: 1 } });
  });

  it('never exposes raw errors or oversized input', async () => {
    const host = session();
    host.signIn.mockRejectedValueOnce(new Error('raw bearer token secret'));
    expect(await handleLine(JSON.stringify({ id: 'auth', op: 'signIn' }), host as unknown as WorkspaceSession))
      .toEqual({ id: 'auth', ok: false, code: 'operation_failed' });
    expect(await handleLine('x'.repeat(8193), host as unknown as WorkspaceSession))
      .toEqual({ id: '', ok: false, code: 'request_too_large' });
    expect(await handleLine('{bad', host as unknown as WorkspaceSession))
      .toEqual({ id: '', ok: false, code: 'invalid_request' });
  });

  it('exposes only the recoverable Reveal request code', async () => {
    const host = {
      ...session(),
      openStartupFile: vi.fn(async () => { throw new Error('reveal_delivery_unavailable'); }),
    };
    expect(await handleLine(JSON.stringify({ id: 'viewer', op: 'openStartupFileFromReveal' }), host as unknown as WorkspaceSession))
      .toEqual({ id: 'viewer', ok: false, code: 'reveal_delivery_unavailable' });
    host.openStartupFile.mockRejectedValueOnce(new Error('sensitive raster failure'));
    expect(await handleLine(JSON.stringify({ id: 'viewer', op: 'openStartupFileFromReveal' }), host as unknown as WorkspaceSession))
      .toEqual({ id: 'viewer', ok: false, code: 'operation_failed' });
  });

  it('returns only the local status after browser SSO fails', async () => {
    const host = session();
    host.status.mockResolvedValueOnce({ signedIn: false });
    expect(await handleLine(JSON.stringify({ id: 'auth', op: 'tryBrowserSignIn' }), host as unknown as WorkspaceSession))
      .toEqual({ id: 'auth', ok: true, result: { signedIn: false } });
    expect(host.tryBrowserSignIn).toHaveBeenCalledOnce();
  });

  it('signs out without returning stored credentials', async () => {
    const host = session();
    expect(await handleLine(JSON.stringify({ id: 'auth', op: 'signOut' }), host as unknown as WorkspaceSession))
      .toEqual({ id: 'auth', ok: true, result: { signedIn: false } });
    expect(host.signOut).toHaveBeenCalledOnce();
  });

  it('frames coalesced requests and discards an oversized line across chunks', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const host = { ...session(), cancel: vi.fn() };
    const lines: string[] = [];
    output.on('data', (chunk: Buffer) => lines.push(...chunk.toString('utf8').trim().split('\n')));
    runProtocol(input, output, host as unknown as WorkspaceSession);

    input.write(`${JSON.stringify({ id: '1', op: 'status' })}\n${JSON.stringify({ id: '2', op: 'organizations' })}\n`);
    input.write('x'.repeat(5000));
    input.write(`${'x'.repeat(3200)}\n${JSON.stringify({ id: '3', op: 'status' })}\n`);
    await new Promise((resolve) => setImmediate(resolve));

    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { id: '1', ok: true, result: { signedIn: true } },
      { id: '2', ok: true, result: [{ id: organizationId, name: 'Team' }] },
      { id: '', ok: false, code: 'request_too_large' },
      { id: '3', ok: true, result: { signedIn: true } },
    ]);
  });

  it('emits only the bounded pairing code before the Reveal response', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const host = {
      ...session(), cancel: vi.fn(),
      openStartupFile: vi.fn(async (_delivery: string, onPairingCode: (code: string) => void) => {
        onPairingCode('abcdef123456');
        onPairingCode('secret material');
        return { mimeType: 'text/plain', contentBase64: 'b2s=', expiresAt: null };
      }),
    };
    const lines: unknown[] = [];
    output.on('data', (chunk: Buffer) => lines.push(...chunk.toString('utf8').trim().split('\n').map(line => JSON.parse(line))));
    runProtocol(input, output, host as unknown as WorkspaceSession);
    input.write(`${JSON.stringify({ id: 'viewer', op: 'openStartupFileFromReveal' })}\n`);
    await new Promise(resolve => setImmediate(resolve));
    expect(lines).toEqual([
      { id: 'viewer', event: 'pairingCode', code: 'abcdef123456' },
      { id: 'viewer', ok: true, result: { mimeType: 'text/plain', contentBase64: 'b2s=', expiresAt: null } },
    ]);
  });

  it('skips queued operations after EOF', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const host = { ...session(), cancel: vi.fn() };
    const lines: string[] = [];
    output.on('data', (chunk: Buffer) => lines.push(chunk.toString('utf8')));
    runProtocol(input, output, host as unknown as WorkspaceSession);

    input.write(`${JSON.stringify({ id: '1', op: 'signIn' })}\n`);
    input.emit('end');
    await new Promise((resolve) => setImmediate(resolve));

    expect(host.cancel).toHaveBeenCalledOnce();
    expect(host.signIn).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });
});
