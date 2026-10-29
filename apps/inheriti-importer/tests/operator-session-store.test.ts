import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';

const secure = vi.hoisted(() => ({ directory: '', available: true, backend: 'gnome_libsecret' }));
const electron = {
  app: { whenReady: async () => {}, getPath: () => secure.directory },
  safeStorage: {
    isEncryptionAvailable: () => secure.available,
    getSelectedStorageBackend: () => secure.backend,
    encryptString: (value: string) => Buffer.from(`sealed:${Buffer.from(value).toString('base64')}`),
    decryptString: (value: Buffer) => {
      if (!value.toString().startsWith('sealed:')) throw new Error('corrupt');
      return Buffer.from(value.toString().slice(7), 'base64').toString();
    },
  },
};

const require = createRequire(import.meta.url);
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (id: string, parent: unknown, isMain: boolean) {
  return id === 'electron' ? electron : originalLoad.call(this, id, parent, isMain);
};
const { ProtectedOperatorSessionStore } = require('../electron/lib/operator-session-store.cjs');
Module._load = originalLoad;
const create = (subject = 'alice', apiOrigin = 'https://api') =>
  new ProtectedOperatorSessionStore('TEST', apiOrigin, 'https://issuer', subject, 'business', 'business-client');
const session = (subject = 'alice') => ({
  kind: 'business', principal: { issuer: 'https://issuer', subject, environment: 'TEST',
    authorizedParty: 'business-client', audience: 'inheriti-integrations-api' }, familyId: 'family',
  accessToken: 'secret-access', refreshToken: 'secret-refresh', tokenType: 'Bearer',
  expiresAt: 1000, sessionExpiresAt: 2000,
});

afterEach(() => {
  rmSync(secure.directory, { recursive: true, force: true });
  secure.available = true;
  secure.backend = 'gnome_libsecret';
});

it('encrypts round trips and isolates accounts', async () => {
  secure.directory = mkdtempSync(join(tmpdir(), 'importer-session-'));
  await create().save(session());
  await create('bob').save(session('bob'));
  expect(await create().load()).toEqual(session());
  expect((await create('bob').load())?.principal.subject).toBe('bob');
  expect(await create('alice', 'https://other-api').load()).toBeUndefined();
  for (const file of readdirSync(secure.directory)) {
    const bytes = readFileSync(join(secure.directory, file));
    expect(bytes.toString()).not.toContain('secret-refresh');
  }
});

it('does not reuse a session across authority or client changes', async () => {
  secure.directory = mkdtempSync(join(tmpdir(), 'importer-session-'));
  await create().save(session());
  const otherAuthority = new ProtectedOperatorSessionStore('TEST', 'https://api', 'https://issuer', 'alice',
    'safeid-oidc-business', 'business-client');
  const otherClient = new ProtectedOperatorSessionStore('TEST', 'https://api', 'https://issuer', 'alice',
    'business', 'other-client');
  expect(await otherAuthority.load()).toBeUndefined();
  expect(await otherClient.load()).toBeUndefined();
});

it('rejects a session without a refresh credential', async () => {
  secure.directory = mkdtempSync(join(tmpdir(), 'importer-session-'));
  await expect(create().save({ ...session(), refreshToken: '' })).rejects.toThrow('Invalid operator session');
});

it('uses memory only when protection is unavailable', async () => {
  secure.directory = mkdtempSync(join(tmpdir(), 'importer-session-'));
  secure.available = false;
  const store = create();
  await store.save(session());
  expect(await store.load()).toEqual(session());
  expect(await create().load()).toBeUndefined();
  expect(readdirSync(secure.directory)).toEqual([]);
});

it('fails closed on corrupt data and unavailable persisted protection', async () => {
  secure.directory = mkdtempSync(join(tmpdir(), 'importer-session-'));
  await create().save(session());
  const file = join(secure.directory, readdirSync(secure.directory)[0]);
  writeFileSync(file, 'corrupt');
  expect(await create().load()).toBeUndefined();
  secure.available = false;
  await expect(create().save(session())).rejects.toThrow('protected_storage_unavailable');
});

it('fences stale writes after clear', async () => {
  secure.directory = mkdtempSync(join(tmpdir(), 'importer-session-'));
  const stale = create();
  const current = create();
  await stale.save(session());
  await current.clear();
  await expect(stale.save(session())).rejects.toThrow('operator_session_retired');
  expect(await create().load()).toBeUndefined();
});

it('does not expose a replacement family to a retired pending load', async () => {
  secure.directory = mkdtempSync(join(tmpdir(), 'importer-session-'));
  const old = create();
  await old.save(session());
  const ready = old.ready.bind(old);
  let resume!: (value: unknown) => void;
  old.ready = () => new Promise((resolve) => { resume = resolve; });
  const pending = old.load();
  old.retire();
  await create().save({ ...session(), familyId: 'replacement' });
  resume(await ready());
  expect(await pending).toBeUndefined();
  expect((await create().load())?.familyId).toBe('replacement');
});

it('removes ciphertext when protection becomes unavailable', async () => {
  secure.directory = mkdtempSync(join(tmpdir(), 'importer-session-'));
  const store = create();
  await store.save(session());
  secure.available = false;
  await store.clear();
  secure.available = true;
  expect(await create().load()).toBeUndefined();
  expect(readdirSync(secure.directory)).toEqual([]);
});
