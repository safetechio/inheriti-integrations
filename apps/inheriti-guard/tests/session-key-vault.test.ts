import { describe, expect, it } from 'vitest';
import type { MasterKeyRef, OperatorSession } from '@safetech/inheriti-elements-core';
import { SessionStorageKeyVault } from '../src/background/session-key-vault.js';
import { SessionStorageOperatorSessionStore } from '../src/background/session-store.js';
import { resolveConfiguration } from '../src/shared/configuration.js';
import { MASTER_KEY_CACHE_PREFIX } from '../src/shared/stored-configuration.js';

const configuration = resolveConfiguration({ apiUrl: 'https://business.test/integrations/',
  issuer: 'https://safeid.test', clientId: 'chrome-business', environment: 'TEST' });
const ref: MasterKeyRef = { system: 'INHERITI_BUSINESS', contextId: 'org-a' };
const key = Uint8Array.from({ length: 32 }, (_, index) => index);
function login(): OperatorSession {
  return { accessToken: 'access', tokenType: 'Bearer', expiresAt: Date.now() + 60_000,
    principal: { issuer: configuration.issuer, audience: 'inheriti-integrations-api', authorizedParty: configuration.clientId,
      environment: 'TEST', subject: 'operator-a', sessionId: 'login-a', tokenId: 'token-a', scopes: ['openid'] } };
}
function storage() {
  const values: Record<string, unknown> = {};
  const area = {
    get: async (keys: string | string[] | null) => keys === null ? Object.fromEntries(Object.entries(values))
      : Object.fromEntries(Object.entries(values).filter(([name]) => (typeof keys === 'string' ? [keys] : keys).includes(name))),
    set: async (entries: Record<string, unknown>) => { Object.assign(values, entries); },
    remove: async (keys: string | string[]) => { for (const name of typeof keys === 'string' ? [keys] : keys) delete values[name]; },
  } as unknown as chrome.storage.StorageArea;
  const sessions = new SessionStorageOperatorSessionStore(area);
  return { area, values, sessions, vault: () => new SessionStorageKeyVault(area, sessions, configuration,
    { session: typeof values['inheriti.operatorSession'] === 'string' ? JSON.parse(values['inheriti.operatorSession']) as OperatorSession : undefined,
      generation: values['inheriti.operatorSessionGeneration'] as number ?? 0 }) };
}

describe('SessionStorageKeyVault', () => {
  it('retains keys across worker/client recreation and isolates key references', async () => {
    const state = storage();
    await state.sessions.save(login());
    await state.vault().store(ref, key);
    await expect(state.vault().load(ref)).resolves.toEqual(key);
    await expect(state.vault().load({ system: 'INHERITI_BUSINESS', contextId: 'org-b' })).resolves.toBeUndefined();
    await expect(state.vault().load({ system: 'INHERITI_ELEMENTS', contextId: 'org-a' })).resolves.toBeUndefined();
    const different = resolveConfiguration({ apiUrl: configuration.apiUrl, issuer: configuration.issuer,
      clientId: configuration.clientId, environment: 'TEST' });
    different.apiUrl = 'https://other-api.test/';
    await expect(new SessionStorageKeyVault(state.area, state.sessions, different, await state.sessions.snapshot()).load(ref)).resolves.toBeUndefined();
    different.apiUrl = configuration.apiUrl;
    different.environment = 'LIVE';
    await expect(new SessionStorageKeyVault(state.area, state.sessions, different, await state.sessions.snapshot()).load(ref)).resolves.toBeUndefined();
  });

  it('keeps a refreshed login bound to the same key', async () => {
    const state = storage();
    const session = login();
    await state.sessions.save(session);
    const vault = state.vault();
    await vault.store(ref, key);
    session.accessToken = 'new-access';
    session.principal.tokenId = 'new-token';
    await state.sessions.save(session);
    await expect(vault.load(ref)).resolves.toEqual(key);
  });

  it.each(['subject', 'sessionId', 'issuer', 'authorizedParty', 'environment'] as const)(
    'rejects an old vault when the login %s changes', async (property) => {
      const state = storage();
      const session = login();
      await state.sessions.save(session);
      const vault = state.vault();
      await vault.store(ref, key);
      if (property === 'environment') session.principal.environment = 'LIVE';
      else session.principal[property] = 'different';
      await state.sessions.save(session);
      await expect(vault.load(ref)).rejects.toThrow('master_key_session_changed');
      await expect(vault.store(ref, key)).rejects.toThrow('master_key_session_changed');
      await expect(vault.remove(ref)).rejects.toThrow('master_key_session_changed');
      await expect(state.vault().load(ref)).resolves.toBeUndefined();
      expect(Object.keys(state.values).some((name) => name.startsWith(MASTER_KEY_CACHE_PREFIX))).toBe(false);
    });

  it('rejects an old vault after logout and an identical SSO login', async () => {
    const state = storage();
    const session = login();
    await state.sessions.save(session);
    const vault = state.vault();
    await vault.store(ref, key);
    await state.sessions.clear();
    await state.sessions.save(session);
    await expect(vault.load(ref)).rejects.toThrow('master_key_session_changed');
    await expect(vault.store(ref, key)).rejects.toThrow('master_key_session_changed');
    await expect(state.vault().load(ref)).resolves.toBeUndefined();
  });

  it('cannot bind an old core to a login that changed before vault creation', async () => {
    const state = storage();
    const original = login();
    await state.sessions.save(original);
    const snapshot = await state.sessions.snapshot();
    const replacement = login();
    replacement.principal.sessionId = 'login-b';
    await state.sessions.save(replacement);
    const oldVault = new SessionStorageKeyVault(state.area, state.sessions, configuration, snapshot);
    await expect(oldVault.store(ref, key)).rejects.toThrow('master_key_session_changed');
  });

  it('rejects missing login and invalid key material', async () => {
    const state = storage();
    const unsigned = state.vault();
    await state.sessions.save(login());
    await expect(unsigned.store(ref, key)).rejects.toThrow('master_key_session_changed');
    await expect(state.vault().store(ref, new Uint8Array(31))).rejects.toThrow('invalid_master_key_material');
    await expect(state.vault().store(ref, new Uint8Array(33))).rejects.toThrow('invalid_master_key_material');
  });

  it.each(['bad-hex', 'a'.repeat(63), Array(32).fill(1)])(
    'discards malformed stored material %#', async (invalid) => {
      const state = storage();
      await state.sessions.save(login());
      const vault = state.vault();
      await vault.store(ref, key);
      const name = Object.keys(state.values).find((name) => name.startsWith(MASTER_KEY_CACHE_PREFIX))!;
      state.values[name] = invalid;
      await expect(vault.load(ref)).resolves.toBeUndefined();
      expect(state.values[name]).toBeUndefined();
    });

  it('explicit removal requires reacquisition', async () => {
    const state = storage();
    await state.sessions.save(login());
    const vault = state.vault();
    await vault.store(ref, key);
    await expect(vault.load(ref)).resolves.toEqual(key);
    await vault.remove(ref);
    await expect(state.vault().load(ref)).resolves.toBeUndefined();
  });

  it.each([false, true])('cleans a late write after logout (identical SSO login: %s)', async (newLogin) => {
    const state = storage();
    await state.sessions.save(login());
    const vault = state.vault();
    await vault.load(ref);
    const originalSet = state.area.set.bind(state.area);
    let writing!: () => void;
    let resume!: () => void;
    const started = new Promise<void>((resolve) => { writing = resolve; });
    const wait = new Promise<void>((resolve) => { resume = resolve; });
    state.area.set = (async (entries: Record<string, unknown>) => {
      if (Object.keys(entries).some((name) => name.startsWith(MASTER_KEY_CACHE_PREFIX))) { writing(); await wait; }
      await originalSet(entries);
    }) as typeof state.area.set;
    const pending = vault.store(ref, key);
    const outcome = expect(pending).rejects.toThrow('master_key_session_changed');
    await started;
    await state.sessions.clear();
    if (newLogin) {
      const session = login();
      await state.sessions.save(session);
    }
    resume();
    await outcome;
    expect(Object.keys(state.values).some((name) => name.startsWith(MASTER_KEY_CACHE_PREFIX))).toBe(false);
  });
});
