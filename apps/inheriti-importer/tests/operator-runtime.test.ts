import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';

let directory = mkdtempSync(join(tmpdir(), 'operator-runtime-'));
let storageAvailable = true;
const electron = {
  app: { whenReady: async () => {}, getPath: () => directory },
  safeStorage: {
    isEncryptionAvailable: () => storageAvailable, getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (value: string) => Buffer.from(`sealed:${Buffer.from(value).toString('base64')}`),
    decryptString: (value: Buffer) => Buffer.from(value.toString().slice(7), 'base64').toString(),
  },
};
const require = createRequire(import.meta.url);
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (id: string, parent: unknown, isMain: boolean) {
  return id === 'electron' ? electron : originalLoad.call(this, id, parent, isMain);
};
const { OperatorRuntime } = require('../electron/lib/operator-runtime.cjs');
Module._load = originalLoad;

let subject = 'alice';
let credentialSuffix = 'alice';
const revoked: string[] = [];
let releaseOrganizations: (() => void) | undefined;
let revokeWait: Promise<void> | undefined;
const sdk = {
  BUSINESS_INTERACTIVE_CLIENT_ID: 'business-client',
  MemoryOperatorSessionStore: class {
    session: unknown;
    async load() { return this.session; }
    async save(session: unknown) { this.session = session; }
    async clear() { this.session = undefined; }
  },
  createNodeIntegrationCore(options: any) {
    return {
      auth: {
        beginAuthorizationCode: async () => ({ authorizationUrl: `https://issuer/authorize?redirect_uri=${encodeURIComponent(options.configuration.redirectUri)}`, expiresAt: 1 }),
        completeAuthorizationCode: async () => options.sessions.save({ kind: 'business', principal: { issuer: 'https://issuer', subject },
          familyId: `family-${credentialSuffix}`, accessToken: `access-${credentialSuffix}`, refreshToken: `refresh-${credentialSuffix}`,
          tokenType: 'Bearer', expiresAt: 1000, sessionExpiresAt: 2000 }),
        getAccessToken: async () => (await options.sessions.load())?.accessToken,
        clear: async () => { const session = await options.sessions.load(); await options.sessions.clear(); revoked.push(session.familyId); await revokeWait; },
      },
      listOrganizations: async () => { if (releaseOrganizations) await new Promise<void>((resolve) => { releaseOrganizations = resolve; }); return [{ id: 'org' }]; },
    };
  },
};
const create = async () => {
  const runtime = new OperatorRuntime({ environment: 'dev', apiOrigin: 'https://api', issuer: 'https://issuer', loadCore: async () => sdk });
  await runtime.initialize();
  return runtime;
};
const openBrowser = async (authorizationUrl: string) => {
  const redirect = new URL(authorizationUrl).searchParams.get('redirect_uri')!;
  await fetch(`${redirect}?code=code&state=state`);
};

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  directory = mkdtempSync(join(tmpdir(), 'operator-runtime-'));
  revoked.length = 0;
  releaseOrganizations = undefined;
  revokeWait = undefined;
  storageAvailable = true;
  subject = 'alice';
  credentialSuffix = 'alice';
});

it('keeps the active core aligned when index persistence fails', async () => {
  const runtime = await create();
  await runtime.login(openBrowser);
  const fs = require('node:fs');
  const rename = fs.renameSync;
  let indexRenameAttempts = 0;
  fs.renameSync = (source: string, destination: string) => {
    if (destination.includes('operator-accounts-')) { ++indexRenameAttempts; throw new Error('disk full'); }
    return rename(source, destination);
  };
  try {
    subject = 'bob';
    await expect(runtime.login(openBrowser)).rejects.toThrow('disk full');
    expect(runtime.list().activeSubject).toBe('alice');
    expect(await runtime.getAccessToken()).toBe('access-alice');
    expect(runtime.isCurrent(runtime.capture())).toBe(true);
    expect(indexRenameAttempts).toBe(1);
  } finally { fs.renameSync = rename; }
});

it('restores the previous encrypted session when the index write fails after replacement', async () => {
  const runtime = await create();
  await runtime.login(openBrowser);
  const fs = require('node:fs');
  const rename = fs.renameSync;
  fs.renameSync = (source: string, destination: string) =>
    destination.includes('operator-accounts-') ? (() => { throw new Error('disk full'); })() : rename(source, destination);
  try {
    credentialSuffix = 'new';
    await expect(runtime.login(openBrowser)).rejects.toThrow('disk full');
    expect(await runtime.getAccessToken()).toBe('access-alice');
    expect((await runtime.store('alice').load())?.familyId).toBe('family-alice');
  } finally { fs.renameSync = rename; }
});

it('re-enrolls the same subject after SDK clear retires its store', async () => {
  const runtime = await create();
  await runtime.login(openBrowser);
  const retired = runtime.store('alice');
  const oldSession = await retired.load();
  await runtime.activeCore.auth.clear();
  credentialSuffix = 'new';
  await runtime.login(openBrowser);
  expect(await runtime.getAccessToken()).toBe('access-new');
  expect(await runtime.sessionDescriptor()).toEqual({ sessionFamilyId: 'family-new', subject: 'alice', expiresAt: new Date(2000).toISOString() });
  await expect(retired.save(oldSession)).rejects.toThrow('operator_session_retired');
  expect((await runtime.store('alice').load())?.familyId).toBe('family-new');
});

it('fences a delayed old refresh across same-subject enrollment and restart', async () => {
  const runtime = await create();
  await runtime.login(openBrowser);
  const oldStore = runtime.store('alice');
  let release!: () => void;
  const delayedRefresh = new Promise<void>((resolve) => { release = resolve; })
    .then(() => oldStore.save({ kind: 'business', principal: { issuer: 'https://issuer', subject: 'alice' },
      familyId: 'family-old-rotation', accessToken: 'access-old-rotation', refreshToken: 'refresh-old-rotation',
      tokenType: 'Bearer', expiresAt: 1000, sessionExpiresAt: 2000 }));
  credentialSuffix = 'new';
  await runtime.login(openBrowser);
  release();
  await expect(delayedRefresh).rejects.toThrow('operator_session_retired');
  expect(await runtime.getAccessToken()).toBe('access-new');
  const restarted = await create();
  expect(await restarted.getAccessToken()).toBe('access-new');
  expect(await restarted.sessionDescriptor()).toMatchObject({ sessionFamilyId: 'family-new' });
});

it('adds a different account without switching and rejects duplicate add', async () => {
  const runtime = await create();
  await runtime.login(openBrowser);
  const capture = runtime.capture();
  subject = 'bob';
  credentialSuffix = 'bob';
  await runtime.login(openBrowser, undefined, { activate: false });
  expect(runtime.list()).toEqual({ accounts: [{ subject: 'alice' }, { subject: 'bob' }], activeSubject: 'alice' });
  expect(await runtime.getAccessToken()).toBe('access-alice');
  expect(runtime.isCurrent(capture)).toBe(true);
  expect(await runtime.getAccountAccessToken('bob')).toBe('access-bob');
  await expect(runtime.login(openBrowser, undefined, { activate: false })).rejects.toThrow('operator_account_already_enrolled');
  expect(runtime.list().activeSubject).toBe('alice');
  runtime.activate('bob');
  expect(await runtime.getAccessToken()).toBe('access-bob');
});

it('keeps a signed-out chooser inactive when adding an account', async () => {
  const runtime = await create();
  await runtime.login(openBrowser, undefined, { activate: false });
  expect(runtime.list()).toEqual({ accounts: [{ subject: 'alice' }], activeSubject: undefined });
  expect(await runtime.getAccessToken()).toBeUndefined();
  expect(await runtime.sessionDescriptor()).toBeNull();
  expect(await runtime.getAccountAccessToken('alice')).toBe('access-alice');
});

it('keeps an active capture valid when removing an inactive account', async () => {
  const runtime = await create();
  await runtime.login(openBrowser);
  subject = 'bob';
  credentialSuffix = 'bob';
  await runtime.login(openBrowser, undefined, { activate: false });
  const capture = runtime.capture();
  await runtime.remove('bob');
  expect(runtime.isCurrent(capture)).toBe(true);
  expect(await runtime.getAccessToken(capture)).toBe('access-alice');
});

it('propagates transient token failures while keeping stored sessions available for retry', async () => {
  const runtime = await create();
  await runtime.login(openBrowser);
  subject = 'bob';
  credentialSuffix = 'bob';
  await runtime.login(openBrowser, undefined, { activate: false });
  const active = runtime.activeCore;
  const inactive = runtime.accountCore('bob');
  const activeGet = active.auth.getAccessToken;
  const inactiveGet = inactive.auth.getAccessToken;
  active.auth.getAccessToken = async () => { throw new Error('network unavailable'); };
  inactive.auth.getAccessToken = async () => { throw new Error('network unavailable'); };
  await expect(runtime.sessionDescriptor()).rejects.toThrow('network unavailable');
  await expect(runtime.getAccountAccessToken('bob')).rejects.toThrow('network unavailable');
  active.auth.getAccessToken = activeGet;
  inactive.auth.getAccessToken = inactiveGet;
  expect(await runtime.sessionDescriptor()).toMatchObject({ sessionFamilyId: 'family-alice' });
  expect(await runtime.getAccountAccessToken('bob')).toBe('access-bob');
});

it('shares one SDK auth client between active and per-account token reads', async () => {
  const runtime = await create();
  await runtime.login(openBrowser);
  const active = runtime.activeCore;
  let release!: () => void;
  let refreshCalls = 0;
  let flight: Promise<string> | undefined;
  active.auth.getAccessToken = () => {
    if (!flight) {
      ++refreshCalls;
      flight = new Promise<string>((resolve) => { release = () => resolve('refreshed'); });
    }
    return flight;
  };
  const first = runtime.getAccessToken();
  const second = runtime.getAccountAccessToken('alice');
  await vi.waitFor(() => expect(refreshCalls).toBe(1));
  expect(runtime.accountCore('alice')).toBe(active);
  release();
  expect(await Promise.all([first, second])).toEqual(['refreshed', 'refreshed']);
  expect(refreshCalls).toBe(1);
});

it('retains memory-only sessions across switches but not restart', async () => {
  storageAvailable = false;
  const runtime = await create();
  await runtime.login(openBrowser);
  subject = 'bob';
  credentialSuffix = 'bob';
  await runtime.login(openBrowser);
  runtime.activate('alice');
  expect(await runtime.getAccessToken()).toBe('access-alice');
  expect(await runtime.getAccountAccessToken('bob')).toBe('access-bob');
  expect(await runtime.getAccountAccessToken('unknown')).toBeUndefined();
  runtime.activate('bob');
  expect(await runtime.getAccessToken()).toBe('access-bob');
  const restarted = await create();
  expect(await restarted.getAccessToken()).toBeUndefined();
});

it('does not erase a newer enrollment while prior revocation waits', async () => {
  const runtime = await create();
  await runtime.login(openBrowser);
  let release!: () => void;
  revokeWait = new Promise<void>((resolve) => { release = resolve; });
  const removing = runtime.remove('alice');
  await vi.waitFor(() => expect(revoked).toEqual(['family-alice']));
  const enrolling = runtime.login(openBrowser);
  await new Promise((resolve) => setTimeout(resolve, 20));
  release();
  await removing;
  await enrolling;
  expect(await runtime.getAccessToken()).toBe('access-alice');
  expect(runtime.list().accounts).toEqual([{ subject: 'alice' }]);
});

it('rejects a malformed callback request without crashing the listener', async () => {
  const runtime = await create();
  const pending = runtime.login(async (authorizationUrl: string) => {
    const redirect = new URL(new URL(authorizationUrl).searchParams.get('redirect_uri')!);
    const response = await new Promise<string>((resolve) => {
      const socket = connect(Number(redirect.port), '127.0.0.1', () =>
        socket.write('GET http://[ HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n'));
      let body = '';
      socket.on('data', (chunk) => { body += chunk.toString(); });
      socket.on('end', () => resolve(body));
    });
    expect(response).toContain('400 Bad Request');
    await fetch(`${redirect}?code=code&state=state`);
  });
  await expect(pending).resolves.toMatchObject({ activeSubject: 'alice' });
});

it('enrolls isolated encrypted sessions after SDK organization access and revokes one family', async () => {
  const runtime = await create();
  await runtime.login(openBrowser);
  subject = 'bob';
  credentialSuffix = 'bob';
  await runtime.login(openBrowser);
  expect(runtime.list()).toEqual({ accounts: [{ subject: 'alice' }, { subject: 'bob' }], activeSubject: 'bob' });
  runtime.activate('alice');
  expect(await runtime.getAccessToken()).toBe('access-alice');
  await runtime.remove('alice');
  expect(revoked).toEqual(['family-alice']);
  expect(runtime.list()).toEqual({ accounts: [{ subject: 'bob' }], activeSubject: undefined });
  expect(await runtime.getAccessToken()).toBeUndefined();
  expect(await runtime.sessionDescriptor()).toBeNull();
  expect((await create()).list()).toEqual({ accounts: [{ subject: 'bob' }], activeSubject: undefined });
  runtime.activate('bob');
  expect(await runtime.getAccessToken()).toBe('access-bob');
  for (const file of readdirSync(directory)) expect(readFileSync(join(directory, file), 'utf8')).not.toContain('refresh-');
});

it('does not enroll a candidate after account generation changes', async () => {
  const runtime = await create();
  releaseOrganizations = () => {};
  const pending = runtime.login(openBrowser);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await runtime.logoutAll();
  releaseOrganizations?.();
  await expect(pending).rejects.toThrow('operator_context_changed');
  expect(runtime.list().accounts).toEqual([]);
});
