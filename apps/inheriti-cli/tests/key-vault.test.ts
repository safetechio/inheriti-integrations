import { beforeEach, expect, it, vi } from 'vitest';
import type { OperatorSession } from '@safetech/inheriti-elements-core';
import { CliKeyVault } from '../src/key-vault.js';

const backend = vi.hoisted(() => ({ values: new Map<string, string>(), unavailable: false }));
vi.mock('@napi-rs/keyring', () => ({
  AsyncEntry: class {
    private readonly id: string;
    constructor(service: string, account: string) {
      if (backend.unavailable) throw new Error('locked');
      this.id = `${service}\0${account}`;
    }
    async getPassword() { return backend.values.get(this.id); }
    async setPassword(value: string) { backend.values.set(this.id, value); }
    async deletePassword() { return backend.values.delete(this.id); }
  },
  findCredentialsAsync: async (service: string) => Array.from(backend.values.entries())
    .filter(([id]) => id.startsWith(`${service}\0`))
    .map(([id, password]) => ({ account: id.slice(service.length + 1), password })),
}));

const ref = { system: 'INHERITI_BUSINESS' as const, contextId: 'org-1' };
const key = new Uint8Array(32).fill(42);
function session(sessionId = 'login-1', subject = 'operator-1'): OperatorSession {
  return {
    accessToken: 'access', tokenType: 'Bearer', expiresAt: Date.now() + 60_000,
    principal: { issuer: 'https://issuer.test', environment: 'TEST', authorizedParty: 'cli',
      audience: 'integrations', subject, sessionId, tokenId: 'token-1', scopes: [] },
  };
}
function vault(login = session(), apiUrl = 'https://business.test/integrations/', path = '/tmp/cli-session.json') {
  return new CliKeyVault(path, apiUrl, 'TEST', async () => login);
}
beforeEach(() => { backend.values.clear(); backend.unavailable = false; });

it('reuses a key in a new CLI process and isolates organization, login, account, deployment and state path', async () => {
  await vault().store(ref, key);
  expect(await vault().load(ref)).toEqual(key);
  expect(await vault().load({ system: ref.system, contextId: 'org-2' })).toBeUndefined();
  expect(await vault(session('login-2')).load(ref)).toBeUndefined();
  expect(await vault(session('login-1', 'operator-2')).load(ref)).toBeUndefined();
  expect(await vault(session(), 'https://other.test/integrations/').load(ref)).toBeUndefined();
  expect(await vault(session(), undefined, '/tmp/other-session.json').load(ref)).toBeUndefined();
});

it('falls back to memory when the OS store is unavailable without breaking the reveal', async () => {
  backend.unavailable = true;
  const held = vault();
  await expect(held.store(ref, key)).resolves.toBeUndefined();
  expect(await held.load(ref)).toEqual(key);
  expect(held.unavailable).toBe(true);
  const next = vault();
  expect(await next.load(ref)).toBeUndefined();
  expect(next.unavailable).toBe(true);
});

it('does not store a released key under a different login if another command changes the session', async () => {
  let current = session();
  const held = new CliKeyVault('/tmp/cli-session.json', 'https://business.test/', 'TEST', async () => current);
  await held.load(ref);
  current = session('login-2', 'operator-2');
  await expect(held.store(ref, key)).rejects.toMatchObject({ code: 'operator_session_changed' });
  expect(backend.values.size).toBe(0);
});

it('clears every organization key on logout while preserving other deployments', async () => {
  const held = vault();
  await held.store(ref, key);
  await held.store({ system: ref.system, contextId: 'org-2' }, key);
  const other = vault(session(), 'https://other.test/integrations/');
  await other.store(ref, key);
  await held.clear();
  expect(await held.load(ref)).toBeUndefined();
  expect(await vault().load({ system: ref.system, contextId: 'org-2' })).toBeUndefined();
  expect(await other.load(ref)).toEqual(key);
  expect(backend.values.size).toBe(1);
});

it('forgets one key without discarding another organization', async () => {
  const held = vault();
  await held.store(ref, key);
  await held.store({ system: ref.system, contextId: 'org-2' }, key);
  await held.remove(ref);
  expect(await vault().load(ref)).toBeUndefined();
  expect(await vault().load({ system: ref.system, contextId: 'org-2' })).toEqual(key);
});

it('rejects malformed stored material and never stores keys without a login', async () => {
  await vault().store(ref, key);
  for (const id of backend.values.keys()) backend.values.set(id, 'invalid-key');
  expect(await vault().load(ref)).toBeUndefined();
  const unsigned = new CliKeyVault('/tmp/cli-session.json', 'https://business.test/', 'TEST', async () => undefined);
  await unsigned.store(ref, key);
  expect(await unsigned.load(ref)).toBeUndefined();
  expect(backend.values.size).toBe(1);
  await expect(vault().store(ref, new Uint8Array(1))).rejects.toThrow('invalid_master_key_material');
});


it('wipes owned keys on replacement and removal without wiping caller or load copies', async () => {
  const held = vault();
  const caller = key.slice();
  await held.store(ref, caller);
  const memory = (held as unknown as { memory: Map<string, Uint8Array> }).memory;
  const previous = Array.from(memory.values())[0]!;
  const loaded = await held.load(ref);
  const replacement = new Uint8Array(32).fill(7);
  await held.store(ref, replacement);
  expect(previous).toEqual(new Uint8Array(32));
  expect(caller).toEqual(key);
  expect(loaded).toEqual(key);
  const current = Array.from(memory.values())[0]!;
  await held.remove(ref);
  expect(current).toEqual(new Uint8Array(32));
  expect(replacement).toEqual(new Uint8Array(32).fill(7));
  expect(await held.load(ref)).toBeUndefined();
});
