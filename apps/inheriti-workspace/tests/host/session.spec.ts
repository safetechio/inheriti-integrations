import { describe, expect, it, vi } from 'vitest';
import { WorkspaceSession } from '../../src-tauri/sidecar/session.js';
import { createNodeIntegrationCore } from '../../../../packages/core/src/node-base.js';
import type { WorkspaceCore, WorkspaceApi } from '../../src-tauri/sidecar/session.js';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sealInheritiFile } from '../../../../../inheriti-client-sdk/sdk/src/elements/inheriti-file.js';
import { encryptRSAOAEP } from '../../../../../../inheriti-core-sdk/crypto.js';
import { checkGuestPolicy, checkPreviewPolicy } from '../../src-tauri/sidecar/access/policy.js';

vi.mock('../../../../packages/core/src/node-base.js', () => ({ createNodeIntegrationCore: vi.fn(() => ({})) }));
const keychain = vi.hoisted(() => new Map<string, string>());
vi.mock('@napi-rs/keyring', () => ({
  AsyncEntry: class {
    private readonly id: string;
    constructor(service: string, account: string) { this.id = `${service}\0${account}`; }
    async getPassword() { return keychain.get(this.id); }
    async setPassword(value: string) { keychain.set(this.id, value); }
    async deletePassword() { keychain.delete(this.id); }
  },
}));

const organizationId = '13ac865a-d60c-4f8c-a783-050bd478f967';
const copyId = '58513941-c2ca-448a-a7b1-2d41316a54f0';

it('admits bounded PDF and text to a guest on every platform without broadening host preview', async () => {
  const binding = { deployment: 'dev', origin: 'REVEAL' as const, copyId, recipient: 'member', expiresAt: '2099-10-18T00:00:00.000Z', allowedUses: 1 };
  const pdf = (await sealInheritiFile({ plaintext: new Uint8Array([1]), binding, mimeType: 'application/pdf' })).fileBytes;
  const text = (await sealInheritiFile({ plaintext: new Uint8Array([1]), binding, mimeType: 'text/plain' })).fileBytes;
  const image = (await sealInheritiFile({ plaintext: new Uint8Array([1]), binding, mimeType: 'image/webp' })).fileBytes;
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  try {
    for (const name of ['linux', 'darwin', 'win32']) {
      Object.defineProperty(process, 'platform', { ...platform, value: name });
      expect(checkGuestPolicy(pdf, 'application/pdf').mimeType).toBe('application/pdf');
      expect(checkGuestPolicy(text, 'text/plain').mimeType).toBe('text/plain');
      expect(() => checkGuestPolicy(image, 'image/webp')).toThrow('unsupported_file_type');
      if (name !== 'linux') expect(() => checkPreviewPolicy(pdf, 'application/pdf')).toThrow('unsupported_file_type');
    }
  } finally { Object.defineProperty(process, 'platform', platform); }
});

it('admits bounded office files only to the guest on every platform', async () => {
  const binding = { deployment: 'dev', origin: 'REVEAL' as const, copyId, recipient: 'member', expiresAt: '2099-10-18T00:00:00.000Z', allowedUses: 1 };
  for (const mime of [
    'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ]) {
    const small = (await sealInheritiFile({ plaintext: new Uint8Array([1]), binding, mimeType: mime })).fileBytes;
    expect(checkGuestPolicy(small, mime).mimeType).toBe(mime);
    expect(() => checkPreviewPolicy(small, mime)).toThrow('unsupported_file_type');
    const oversized = (await sealInheritiFile({ plaintext: new Uint8Array(1024 * 1024 + 1), binding, mimeType: mime })).fileBytes;
    expect(() => checkGuestPolicy(oversized, mime)).toThrow('file_too_large');
  }
});

describe('Workspace session', () => {
  it('obtains its own session from an existing browser sign-in', async () => {
    let token: string | undefined;
    const core = {
      auth: {
        getAccessToken: vi.fn(async () => token),
        beginAuthorizationCode: vi.fn(async () => ({ authorizationUrl: 'https://issuer.test/auth', expiresAt: Date.now() + 1000 })),
        completeAuthorizationCode: vi.fn(async () => { token = 'viewer-token'; }),
      },
      listOrganizations: vi.fn(async () => [{ id: organizationId, name: 'Team' }]),
    } as unknown as WorkspaceCore;
    const host = new WorkspaceSession('dev', {
      core,
      apiForOrganization: () => ({}) as WorkspaceApi,
      configuration: { issuer: 'https://issuer.test', clientId: 'client', audience: 'audience', environment: 'TEST', redirectUri: 'http://127.0.0.1/oauth/callback', scopes: [] },
      waitForCallback: vi.fn(async (authorize: (redirectUri: string) => Promise<string>) => {
        await authorize('http://127.0.0.1:1234/oauth/callback');
        return 'http://127.0.0.1:1234/oauth/callback?code=code&state=state';
      }) as unknown as typeof import('./oauth-callback.js').waitForOAuthCallback,
      openBrowser: vi.fn(async () => undefined),
    });

    expect(await host.tryBrowserSignIn()).toBe(true);
    expect(await host.status()).toEqual({ signedIn: true });
    expect(core.auth.beginAuthorizationCode).toHaveBeenCalledWith({ prompt: 'none' });
    expect(core.listOrganizations).toHaveBeenCalledOnce();
  });

  it('tries browser SSO once and keeps interactive sign-in available after a refusal', async () => {
    let token: string | undefined;
    const beginAuthorizationCode = vi.fn(async (options?: { prompt?: 'none' }) => ({ authorizationUrl: `https://issuer.test/auth?prompt=${options?.prompt ?? 'login'}`, expiresAt: Date.now() + 1000 }));
    const completeAuthorizationCode = vi.fn(async (callback: string) => {
      if (callback.includes('error=login_required')) throw new Error('login_required');
      token = 'private-token';
    });
    const core = {
      auth: { getAccessToken: vi.fn(async () => token), beginAuthorizationCode, completeAuthorizationCode },
      listOrganizations: vi.fn(async () => [{ id: organizationId, name: 'Team' }]),
    } as unknown as WorkspaceCore;
    const openBrowser = vi.fn(async () => undefined);
    const waitForCallback = vi.fn(async (authorize: (redirectUri: string) => Promise<string>, browser: typeof openBrowser) => {
      const url = await authorize('http://127.0.0.1:1234/oauth/callback');
      await browser(url);
      return url.includes('prompt=none')
        ? 'http://127.0.0.1:1234/oauth/callback?error=login_required&state=state'
        : 'http://127.0.0.1:1234/oauth/callback?code=code&state=state';
    });
    const host = new WorkspaceSession('dev', {
      core,
      apiForOrganization: () => ({}) as WorkspaceApi,
      configuration: { issuer: 'https://issuer.test', clientId: 'client', audience: 'audience', environment: 'TEST', redirectUri: 'http://127.0.0.1/oauth/callback', scopes: [] },
      waitForCallback: waitForCallback as unknown as typeof import('./oauth-callback.js').waitForOAuthCallback,
      openBrowser,
    });

    expect(await host.tryBrowserSignIn()).toBe(false);
    expect(await host.status()).toEqual({ signedIn: false });
    await host.signIn();
    expect(await host.status()).toEqual({ signedIn: true });
    expect(core.listOrganizations).toHaveBeenCalledOnce();
    expect(beginAuthorizationCode.mock.calls.map(([options]) => options)).toEqual([{ prompt: 'none' }, undefined]);
    expect(openBrowser).toHaveBeenCalledTimes(2);
    expect(await host.tryBrowserSignIn()).toBe(true);
    expect(openBrowser).toHaveBeenCalledTimes(2);
  });

  it('restores through the host store without requesting extra scopes', () => {
    new WorkspaceSession('dev');
    expect(vi.mocked(createNodeIntegrationCore).mock.lastCall?.[0].configuration.scopes).toEqual(['openid', 'profile']);
    expect(vi.mocked(createNodeIntegrationCore).mock.lastCall?.[0].sessions).toBeDefined();
  });

  it('clears the SDK session and current organization on sign-out', async () => {
    keychain.clear();
    let token: string | undefined = 'private-token';
    const clear = vi.fn(async () => { token = undefined; });
    const core = {
      auth: { getAccessToken: vi.fn(async () => token), clear },
      listOrganizations: vi.fn(async () => [{ id: organizationId, name: 'Team' }]),
    } as unknown as WorkspaceCore;
    const host = new WorkspaceSession('dev', {
      core, apiForOrganization: () => ({}) as WorkspaceApi,
      configuration: { issuer: 'https://issuer.test', clientId: 'client', audience: 'audience', environment: 'TEST', redirectUri: 'http://127.0.0.1/oauth/callback', scopes: [] },
    });
    await host.listOrganizations();
    await host.selectOrganization(organizationId);
    await host.signOut();
    expect(clear).toHaveBeenCalledOnce();
    expect(await host.status()).toEqual({ signedIn: false });
    await expect(host.selectOrganization(organizationId)).rejects.toThrow('sign_in_required');
  });

  it('does not silently sign in after an explicit sign-out, even after restart', async () => {
    keychain.clear();
    let token: string | undefined = 'private-token';
    const beginAuthorizationCode = vi.fn(async () => ({ authorizationUrl: 'https://issuer.test/auth', expiresAt: Date.now() + 1000 }));
    const core = {
      auth: {
        getAccessToken: vi.fn(async () => token),
        clear: vi.fn(async () => { token = undefined; }),
        beginAuthorizationCode,
        completeAuthorizationCode: vi.fn(async () => { token = 'private-token'; }),
      },
      listOrganizations: vi.fn(async () => [{ id: organizationId, name: 'Team' }]),
    } as unknown as WorkspaceCore;
    const configuration = { issuer: 'https://issuer.test', clientId: 'client', audience: 'audience', environment: 'TEST', redirectUri: 'http://127.0.0.1/oauth/callback', scopes: [] };
    const waitForCallback = vi.fn(async (authorize: (redirectUri: string) => Promise<string>) => {
      await authorize('http://127.0.0.1:1234/oauth/callback');
      return 'http://127.0.0.1:1234/oauth/callback?code=code&state=state';
    }) as unknown as typeof import('./oauth-callback.js').waitForOAuthCallback;
    const dependencies = { core, apiForOrganization: () => ({}) as WorkspaceApi, configuration, waitForCallback };
    await new WorkspaceSession('dev', dependencies).signOut();
    const restarted = new WorkspaceSession('dev', dependencies);
    expect(await restarted.tryBrowserSignIn()).toBe(false);
    expect(beginAuthorizationCode).not.toHaveBeenCalled();
    await restarted.signIn();
    expect(beginAuthorizationCode).toHaveBeenCalledOnce();
    token = undefined;
    expect(await new WorkspaceSession('dev', dependencies).tryBrowserSignIn()).toBe(true);
  });

  it('requires the signed-in member to select an organization before reading a binding', async () => {
    const getFileAccess = vi.fn(async () => ({ copyId, status: 'READY', deployment: 'dev', origin: 'REVEAL', recipient: 'member', expiresAt: null, allowedUses: 1 }));
    const core = {
      auth: { getAccessToken: vi.fn(async () => 'private-token') },
      listOrganizations: vi.fn(async () => [{ id: organizationId, name: 'Team' }]),
    } as unknown as WorkspaceCore;
    const host = new WorkspaceSession('dev', {
      core,
      apiForOrganization: (id) => {
        expect(id).toBe(organizationId);
        return { getFileAccess } as WorkspaceApi;
      },
      configuration: { issuer: 'https://issuer.test', clientId: 'client', audience: 'audience', environment: 'TEST', redirectUri: 'http://127.0.0.1/oauth/callback', scopes: [] },
    });

    await expect(host.getFileAccess(copyId)).rejects.toThrow('organization_required');
    expect(await host.listOrganizations()).toEqual([{ id: organizationId, name: 'Team' }]);
    await host.selectOrganization(organizationId);
    await host.getFileAccess(copyId);
    expect(getFileAccess).toHaveBeenCalledWith(copyId);
  });
});

it('inspects a bounded startup file and rejects a changed server binding or symlink', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'inheriti-workspace-'));
  const path = join(directory, 'copy.inheriti');
  const binding = { deployment: 'dev', origin: 'REVEAL' as const, copyId, recipient: 'member', expiresAt: '2026-10-18T00:00:00.000Z', allowedUses: 1 };
  const getFileAccess = vi.fn(async () => ({ ...binding, status: 'READY' as const }));
  const core = {
    auth: { getAccessToken: vi.fn(async () => 'private-token') },
    listOrganizations: vi.fn(async () => [{ id: organizationId, name: 'Team' }]),
  } as unknown as WorkspaceCore;
  const host = new WorkspaceSession('dev', {
    core, apiForOrganization: () => ({ getFileAccess }) as WorkspaceApi,
    configuration: { issuer: 'https://issuer.test', clientId: 'client', audience: 'audience', environment: 'TEST', redirectUri: 'http://127.0.0.1/oauth/callback', scopes: [] },
  }, path);
  try {
    const sealed = await sealInheritiFile({ plaintext: new Uint8Array([1]), binding, mimeType: 'text/plain' });
    await writeFile(path, sealed.fileBytes);
    await expect(host.inspectStartupFile()).rejects.toThrow('organization_required');
    await host.listOrganizations();
    await host.selectOrganization(organizationId);
    await expect(host.inspectStartupFile()).resolves.toMatchObject(binding);
    getFileAccess.mockResolvedValueOnce({ ...binding, status: 'READY', allowedUses: 2 });
    await expect(host.inspectStartupFile()).rejects.toThrow('file_binding_mismatch');
    const link = join(directory, 'link.inheriti');
    await symlink(path, link);
    const linkedHost = new WorkspaceSession('dev', {
      core, apiForOrganization: () => ({ getFileAccess }) as WorkspaceApi,
      configuration: { issuer: 'https://issuer.test', clientId: 'client', audience: 'audience', environment: 'TEST', redirectUri: 'http://127.0.0.1/oauth/callback', scopes: [] },
    }, link);
    await linkedHost.listOrganizations();
    await linkedHost.selectOrganization(organizationId);
    await expect(linkedHost.inspectStartupFile()).rejects.toThrow();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('opens a verified text copy through mobile or the active Reveal and confirms delivery', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'inheriti-workspace-'));
  const path = join(directory, 'copy.inheriti');
  const binding = { deployment: 'dev', origin: 'REVEAL' as const, copyId, recipient: 'member', expiresAt: '2099-10-18T00:00:00.000Z', allowedUses: 1 };
  const sealed = await sealInheritiFile({ plaintext: new TextEncoder().encode('private fixture'), binding, mimeType: 'text/plain' });
  const requestFileAccessOpening = vi.fn(async (_copyId: string, input: { sessionId: string; clientPublicKey: string }) => {
    const publicPem = `-----BEGIN PUBLIC KEY-----\n${input.clientPublicKey}\n-----END PUBLIC KEY-----`;
    encryptedFileKey = await encryptRSAOAEP(Buffer.from(sealed.fileKey).toString('base64'), publicPem);
    return { sessionId: input.sessionId, expiresAt: '2099-10-18T00:00:00.000Z' };
  });
  let encryptedFileKey = '';
  const readFileAccessOpening = vi.fn(async () => ({ status: 'READY' as const, expiresAt: '2099-10-18T00:00:00.000Z', encryptedFileKey }));
  const confirmFileAccessDelivery = vi.fn(async () => undefined);
  const api = { getFileAccess: vi.fn(async () => ({ ...binding, status: 'READY' as const })), requestFileAccessOpening, readFileAccessOpening, confirmFileAccessDelivery };
  const core = { auth: { getAccessToken: vi.fn(async () => 'private-token') }, listOrganizations: vi.fn(async () => [{ id: organizationId, name: 'Team' }]) } as unknown as WorkspaceCore;
  const host = new WorkspaceSession('dev', { core, apiForOrganization: () => api, configuration: { issuer: 'https://issuer.test', clientId: 'client', audience: 'audience', environment: 'TEST', redirectUri: 'http://127.0.0.1/oauth/callback', scopes: [] } }, path);
  try {
    await writeFile(path, sealed.fileBytes);
    await host.listOrganizations();
    await host.selectOrganization(organizationId);
    expect(await host.openStartupFile()).toEqual({ mimeType: 'text/plain', contentBase64: Buffer.from('private fixture').toString('base64'), expiresAt: binding.expiresAt });
    expect(requestFileAccessOpening).toHaveBeenCalledOnce();
    expect(readFileAccessOpening).toHaveBeenCalledWith(copyId, expect.any(String), expect.stringMatching(/^[a-f0-9]{64}$/), expect.any(AbortSignal));
    expect(confirmFileAccessDelivery).toHaveBeenCalledOnce();

    const onPairingCode = vi.fn();
    expect(await host.openStartupFile('REVEAL', onPairingCode)).toEqual({ mimeType: 'text/plain', contentBase64: Buffer.from('private fixture').toString('base64'), expiresAt: binding.expiresAt });
    expect(requestFileAccessOpening).toHaveBeenLastCalledWith(copyId, expect.objectContaining({ delivery: 'REVEAL' }));
    expect(onPairingCode).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{12}$/));
    expect(confirmFileAccessDelivery).toHaveBeenCalledTimes(2);

    api.getFileAccess.mockResolvedValueOnce({ ...binding, status: 'REVOKED' });
    await expect(host.openStartupFile()).rejects.toThrow('file_access_unavailable');
    expect(requestFileAccessOpening).toHaveBeenCalledTimes(2);
    api.getFileAccess.mockResolvedValueOnce({ ...binding, allowedUses: 2, status: 'READY' });
    await expect(host.openStartupFile()).rejects.toThrow('file_binding_mismatch');
    expect(requestFileAccessOpening).toHaveBeenCalledTimes(2);
    const expired = { ...binding, expiresAt: '2000-01-01T00:00:00.000Z' };
    await writeFile(path, (await sealInheritiFile({ plaintext: new TextEncoder().encode('old'), binding: expired, mimeType: 'text/plain' })).fileBytes);
    api.getFileAccess.mockResolvedValueOnce({ ...expired, status: 'READY' });
    await expect(host.openStartupFile()).rejects.toThrow('file_access_unavailable');
    expect(requestFileAccessOpening).toHaveBeenCalledTimes(2);
    await writeFile(path, sealed.fileBytes);
    requestFileAccessOpening.mockRejectedValueOnce(new Error('request failed before delivery'));
    await expect(host.openStartupFile('REVEAL')).rejects.toThrow('reveal_delivery_unavailable');
    expect(confirmFileAccessDelivery).toHaveBeenCalledTimes(2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('rejects unsupported or oversized content before requesting an opening', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'inheriti-workspace-'));
  const path = join(directory, 'copy.inheriti');
  const binding = { deployment: 'dev', origin: 'REVEAL' as const, copyId, recipient: 'member', expiresAt: '2099-10-18T00:00:00.000Z', allowedUses: 1 };
  const requestFileAccessOpening = vi.fn();
  const core = { auth: { getAccessToken: vi.fn(async () => 'private-token') }, listOrganizations: vi.fn(async () => [{ id: organizationId, name: 'Team' }]) } as unknown as WorkspaceCore;
  const host = new WorkspaceSession('dev', { core, apiForOrganization: () => ({ getFileAccess: vi.fn(async () => ({ ...binding, status: 'READY' })), requestFileAccessOpening } as unknown as WorkspaceApi), configuration: { issuer: 'https://issuer.test', clientId: 'client', audience: 'audience', environment: 'TEST', redirectUri: 'http://127.0.0.1/oauth/callback', scopes: [] } }, path);
  try {
    await host.listOrganizations();
    await host.selectOrganization(organizationId);
    await writeFile(path, (await sealInheritiFile({ plaintext: new Uint8Array(1024 * 1024 + 1), binding, mimeType: 'application/pdf' })).fileBytes);
    await expect(host.openStartupFile()).rejects.toThrow('file_too_large');
    await writeFile(path, (await sealInheritiFile({ plaintext: new Uint8Array(46 * 1024), binding, mimeType: 'text/plain' })).fileBytes);
    await expect(host.openStartupFile()).rejects.toThrow('file_too_large');
    await writeFile(path, (await sealInheritiFile({ plaintext: new Uint8Array([1]), binding, mimeType: 'image/webp' })).fileBytes);
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    try {
      for (const unsupported of ['darwin', 'win32']) {
        Object.defineProperty(process, 'platform', { ...platform, value: unsupported });
        await expect(host.openStartupFile()).rejects.toThrow('unsupported_file_type');
        await writeFile(path, (await sealInheritiFile({ plaintext: new Uint8Array([1]), binding, mimeType: 'application/pdf' })).fileBytes);
        await expect(host.openStartupFile()).rejects.toThrow('unsupported_file_type');
        await writeFile(path, (await sealInheritiFile({ plaintext: new Uint8Array([1]), binding, mimeType: 'image/webp' })).fileBytes);
      }
    } finally {
      Object.defineProperty(process, 'platform', platform);
    }
    expect(requestFileAccessOpening).not.toHaveBeenCalled();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
