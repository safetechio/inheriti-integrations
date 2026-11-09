import { describe, expect, it } from 'vitest';
import type { OperatorSession } from '@safetech/inheriti-elements-core';
import { MASTER_KEY_CACHE_PREFIX } from '../src/shared/stored-configuration.js';
import { operatorProfileId, SessionStorageOperatorSessionStore } from '../src/background/session-store.js';
import type { OperatorSessionBackup } from '../src/background/session-store.js';
import type { ChromeConfiguration } from '../src/shared/configuration.js';

function login(subject: string, sessionId = subject): OperatorSession {
  return {
    accessToken: subject + '-access', refreshToken: subject + '-refresh', tokenType: 'Bearer',
    expiresAt: Date.now() + 60_000,
    principal: {
      issuer: 'https://safeid.test/realms/elements', audience: 'inheriti-elements-api',
      authorizedParty: 'elements-test-chrome', environment: 'TEST',
      subject, sessionId, tokenId: subject + '-token', scopes: ['plan:list'],
    },
  };
}

function sessionArea() {
  const values = new Map<string, unknown>();
  const area = {
    get: async (keys: string | string[] | null) => keys === null ? Object.fromEntries(values)
      : Object.fromEntries((typeof keys === 'string' ? [keys] : keys).filter((key) => values.has(key)).map((key) => [key, values.get(key)])),
    set: async (entries: Record<string, unknown>) => { for (const [key, value] of Object.entries(entries)) values.set(key, value); },
    remove: async (keys: string | string[]) => { for (const key of typeof keys === 'string' ? [keys] : keys) values.delete(key); },
  } as unknown as chrome.storage.StorageArea;
  return { area, values };
}

async function enroll(store: SessionStorageOperatorSessionStore, session: OperatorSession) {
  await (await store.beginEnrollment()).save(session);
}

describe('SessionStorageOperatorSessionStore', () => {
  it('restores a session into a fresh session area and removes revoked credentials from the backup', async () => {
    let saved: Awaited<ReturnType<OperatorSessionBackup['load']>>;
    const backup: OperatorSessionBackup = {
      load: async () => saved,
      save: async (registry) => { saved = structuredClone(registry); },
      clear: async () => { saved = undefined; },
    };
    const first = new SessionStorageOperatorSessionStore(sessionArea().area, backup);
    const account = login('restored');
    await enroll(first, account);
    const restarted = new SessionStorageOperatorSessionStore(sessionArea().area, backup);
    expect(await restarted.load()).toEqual(account);
    await (await restarted.forProfile(operatorProfileId(account))).clear();
    const afterRevoke = new SessionStorageOperatorSessionStore(sessionArea().area, backup);
    expect(await afterRevoke.load()).toBeUndefined();
    expect((await afterRevoke.profiles())[0]?.needsSignIn).toBe(true);
    await afterRevoke.clearAll();
    expect(saved).toBeUndefined();
    expect(await new SessionStorageOperatorSessionStore(sessionArea().area, backup).profiles()).toEqual([]);
  });

  it('rejects a malformed durable registry and clears its backup', async () => {
    let cleared = false;
    const backup: OperatorSessionBackup = {
      load: async () => ({ profiles: [{ id: 'invalid', epoch: 1, issuer: 'x', environment: 'x',
        authorizedParty: 'x', subject: 'x', session: login('stolen') }], generation: 1 }),
      save: async () => undefined,
      clear: async () => { cleared = true; },
    };
    const store = new SessionStorageOperatorSessionStore(sessionArea().area, backup);
    expect(await store.load()).toBeUndefined();
    expect(cleared).toBe(true);
  });

  it('preserves a backup after a temporary read failure and restores it on retry', async () => {
    let saved: Awaited<ReturnType<OperatorSessionBackup['load']>>;
    let failing = false;
    let cleared = false;
    const backup: OperatorSessionBackup = {
      load: async () => { if (failing) throw new Error('indexeddb_unavailable'); return saved; },
      save: async (registry) => { saved = structuredClone(registry); },
      clear: async () => { cleared = true; saved = undefined; },
    };
    const account = login('retry');
    await enroll(new SessionStorageOperatorSessionStore(sessionArea().area, backup), account);
    const restarted = new SessionStorageOperatorSessionStore(sessionArea().area, backup);
    failing = true;
    await expect(restarted.load()).rejects.toThrow('indexeddb_unavailable');
    expect(cleared).toBe(false);
    expect(saved).toBeDefined();
    failing = false;
    expect(await restarted.load()).toEqual(account);
  });

  it('preserves a backup when restoring session storage fails temporarily', async () => {
    let saved: Awaited<ReturnType<OperatorSessionBackup['load']>>;
    let cleared = false;
    const backup: OperatorSessionBackup = {
      load: async () => saved,
      save: async (registry) => { saved = structuredClone(registry); },
      clear: async () => { cleared = true; saved = undefined; },
    };
    const account = login('retry-write');
    await enroll(new SessionStorageOperatorSessionStore(sessionArea().area, backup), account);
    const fresh = sessionArea();
    let failing = true;
    const area = { get: fresh.area.get, remove: fresh.area.remove, set: async (entries: Record<string, unknown>) => {
      if (failing) throw new Error('storage_unavailable');
      await fresh.area.set(entries);
    } } as chrome.storage.StorageArea;
    const restarted = new SessionStorageOperatorSessionStore(area, backup);
    await expect(restarted.load()).rejects.toThrow('storage_unavailable');
    expect(cleared).toBe(false);
    failing = false;
    expect(await restarted.load()).toEqual(account);
  });

  it('does not invalidate a bound session when a cold worker checks generation before binding configuration', async () => {
    const { area } = sessionArea();
    let saved: Awaited<ReturnType<OperatorSessionBackup['load']>>;
    const backup: OperatorSessionBackup = {
      load: async () => saved,
      save: async (registry) => { saved = structuredClone(registry); },
      clear: async () => { saved = undefined; },
    };
    const account = login('cold-worker');
    const configuration: ChromeConfiguration = { apiUrl: 'https://api.test/', issuer: account.principal.issuer,
      clientId: account.principal.authorizedParty, environment: 'TEST', scopes: ['openid'], masterKeyCustody: 'EXTERNAL',
      applicationId: 'application' };
    const first = new SessionStorageOperatorSessionStore(area, backup);
    first.bind(configuration);
    await enroll(first, account);
    const restarted = new SessionStorageOperatorSessionStore(area, backup);
    expect((await restarted.snapshot()).session).toEqual(account);
    expect((await restarted.profiles())[0]?.needsSignIn).toBe(false);
    expect(saved?.profiles[0]?.session).toEqual(account);
    restarted.bind(configuration);
    expect(await restarted.load()).toEqual(account);
    const incompatible = new SessionStorageOperatorSessionStore(area, backup);
    incompatible.bind({ ...configuration, clientId: 'other-client' });
    expect(await incompatible.load()).toBeUndefined();
  });

  it('keeps an OIDC Business session and accepts a bound refresh', async () => {
    const { area } = sessionArea();
    const store = new SessionStorageOperatorSessionStore(area);
    const session = Object.assign(login('oidc-user'), { kind: 'safeid-oidc-business' as const,
      businessApiUrl: 'https://api/integrations/', audience: 'inheriti-integrations-api',
      clientId: 'elements-test-chrome', issuer: 'https://safeid.test/realms/elements', environment: 'TEST' as const });
    session.principal.audience = 'inheriti-integrations-api';
    await enroll(store, session);
    const adapter = await store.forProfile(operatorProfileId(session));
    await adapter.save({ ...session, accessToken: 'new-access' });
    expect((await new SessionStorageOperatorSessionStore(area).load())?.accessToken).toBe('new-access');
  });
  it('keeps a compatible saved Business session when adding context binding', async () => {
    const { area, values } = sessionArea();
    const session = Object.assign(login('business-user'), {
      kind: 'business' as const, familyId: 'family-1', sessionExpiresAt: Date.now() + 300_000,
    });
    session.principal.audience = 'inheriti-integrations-api';
    const oldStore = new SessionStorageOperatorSessionStore(area);
    await enroll(oldStore, session);
    const upgraded = new SessionStorageOperatorSessionStore(area);
    upgraded.bind({ apiUrl: 'https://api/integrations/', issuer: session.principal.issuer,
      clientId: session.principal.authorizedParty, environment: 'TEST', scopes: ['openid'], masterKeyCustody: 'EXTERNAL' });
    expect(await upgraded.load()).toEqual(session);
    expect(JSON.parse(String(values.get('inheriti.operatorProfiles')))[0].context).toBeTruthy();
    expect(await upgraded.load()).toEqual(session);
  });
  it('invalidates saved credentials when the configured client or API changes', async () => {
    const { area } = sessionArea();
    const store = new SessionStorageOperatorSessionStore(area);
    const current = login('alice');
    const configuration: ChromeConfiguration = { apiUrl: 'https://api-a/integrations/', issuer: current.principal.issuer,
      clientId: current.principal.authorizedParty, environment: 'TEST', scopes: ['openid'], masterKeyCustody: 'EXTERNAL',
      applicationId: 'application' };
    store.bind(configuration);
    await enroll(store, current);
    const wrongMode = Object.assign(login('bob'), { kind: 'safeid-oidc-business' as const });
    await expect(enroll(store, wrongMode)).rejects.toThrow('operator_session_changed');
    store.bind({ ...configuration, clientId: 'other-client' });
    expect(await store.load()).toBeUndefined();
    expect((await store.profiles())[0]?.needsSignIn).toBe(true);
    store.bind(configuration);
    await enroll(store, current);
    store.bind({ ...configuration, apiUrl: 'https://api-b/integrations/' });
    expect(await store.load()).toBeUndefined();
  });
  it('starts signed out and discards the legacy credential without adopting it', async () => {
    const { area, values } = sessionArea();
    values.set('inheriti.operatorSession', JSON.stringify(login('legacy')));
    values.set('device-preference', 'keep');
    const store = new SessionStorageOperatorSessionStore(area);
    await expect(store.load()).resolves.toBeUndefined();
    expect(values.has('inheriti.operatorSession')).toBe(false);
    expect(values.get('device-preference')).toBe('keep');
    expect(await store.profiles()).toEqual([]);
  });

  it('enrolls two identities, switches A/B/A, and scopes refresh writes', async () => {
    const { area, values } = sessionArea();
    const store = new SessionStorageOperatorSessionStore(area);
    const a = login('a');
    const b = login('b');
    await enroll(store, a);
    const aAdapter = await store.forProfile(operatorProfileId(a));
    await enroll(store, b);
    const generation = (await store.snapshot()).generation;
    expect((await store.profiles()).map(({ subject, active }) => [subject, active])).toEqual([['a', false], ['b', true]]);
    const refreshedA = login('a');
    refreshedA.accessToken = 'new-a-access';
    await aAdapter.save(refreshedA);
    await expect(store.save(a)).rejects.toThrow('operator_session_changed');
    expect(await store.load()).toEqual(b);
    expect(await store.activate(operatorProfileId(a))).toBe(true);
    expect((await store.snapshot()).generation).toBeGreaterThan(generation);
    expect((await store.load())?.accessToken).toBe('new-a-access');
    expect(await store.activate(operatorProfileId(b))).toBe(true);
    expect(await store.load()).toEqual(b);
    expect(values.has('inheriti.operatorProfiles')).toBe(true);
    expect(values.has('inheriti.operatorSession')).toBe(false);
  });

  it('re-enrollment replaces one profile and invalidates its old bound adapter', async () => {
    const store = new SessionStorageOperatorSessionStore(sessionArea().area);
    const a = login('a');
    await enroll(store, a);
    const old = await store.forProfile(operatorProfileId(a));
    const replacement = login('a', 'new-login');
    await enroll(store, replacement);
    expect(await store.profiles()).toHaveLength(1);
    expect(await store.load()).toEqual(replacement);
    await expect(old.save(a)).rejects.toThrow('operator_session_changed');
    expect(await old.load()).toBeUndefined();
  });

  it('fences an old adapter after re-enrollment with the same SafeID session id', async () => {
    const store = new SessionStorageOperatorSessionStore(sessionArea().area);
    const original = login('a');
    await enroll(store, original);
    const old = await store.forProfile(operatorProfileId(original));
    const replacement = login('a');
    replacement.accessToken = 'replacement-access';
    await enroll(store, replacement);
    await expect(old.save(original)).rejects.toThrow('operator_session_changed');
    await old.clear();
    expect(await old.load()).toBeUndefined();
    expect(await store.load()).toEqual(replacement);
    expect((await store.profiles())[0]?.needsSignIn).toBe(false);
  });

  it('rejects a late enrollment after activation changes', async () => {
    const store = new SessionStorageOperatorSessionStore(sessionArea().area);
    const pending = await store.beginEnrollment();
    const a = login('a');
    await enroll(store, a);
    await expect(pending.save(login('b'))).rejects.toThrow('operator_session_changed');
    expect(await store.profiles()).toHaveLength(1);
  });

  it('keeps an enrollment adapter bound after login for immediate token reads and refresh', async () => {
    const store = new SessionStorageOperatorSessionStore(sessionArea().area);
    const adapter = await store.beginEnrollment();
    const a = login('a');
    await adapter.save(a);
    expect(await adapter.load()).toEqual(a);
    const refreshed = login('a');
    refreshed.accessToken = 'refreshed-access';
    await adapter.save(refreshed);
    expect((await adapter.load())?.accessToken).toBe('refreshed-access');
    await enroll(store, login('b'));
    await expect(adapter.save(login('b'))).rejects.toThrow('operator_session_changed');
    expect((await store.load())?.principal.subject).toBe('b');
  });

  it('invalidates an organization context without losing saved sessions', async () => {
    const { area, values } = sessionArea();
    const store = new SessionStorageOperatorSessionStore(area);
    const a = login('a');
    await enroll(store, a);
    const bound = await store.forProfile(operatorProfileId(a));
    const before = (await store.snapshot()).generation;
    values.set(MASTER_KEY_CACHE_PREFIX + 'org-a', 'a'.repeat(64));
    await store.bumpGeneration();
    expect((await store.snapshot()).generation).toBeGreaterThan(before);
    expect(await bound.load()).toEqual(a);
    expect(values.has(MASTER_KEY_CACHE_PREFIX + 'org-a')).toBe(false);
  });

  it('keeps a token-free needs-sign-in row after B is revoked while A stays usable', async () => {
    const { area, values } = sessionArea();
    const store = new SessionStorageOperatorSessionStore(area);
    const a = login('a');
    const b = login('b');
    await enroll(store, a);
    await enroll(store, b);
    values.set(MASTER_KEY_CACHE_PREFIX + 'a', 'a'.repeat(64));
    await (await store.forProfile(operatorProfileId(b))).clear();
    expect((await store.profiles()).map(({ subject, needsSignIn }) => [subject, needsSignIn]))
      .toEqual([['a', false], ['b', true]]);
    expect(await store.load()).toBeUndefined();
    expect(JSON.stringify(values.get('inheriti.operatorProfiles'))).not.toContain('b-access');
    expect(JSON.stringify(values.get('inheriti.operatorProfiles'))).not.toContain('b-refresh');
    expect(values.has(MASTER_KEY_CACHE_PREFIX + 'a')).toBe(false);
    expect(await store.activate(operatorProfileId(b))).toBe(false);
    await store.activate(operatorProfileId(a));
    expect(await store.load()).toEqual(a);
    await enroll(store, b);
    expect((await store.profiles()).map(({ subject, needsSignIn }) => [subject, needsSignIn]))
      .toEqual([['a', false], ['b', false]]);
    await store.remove(operatorProfileId(b));
    expect((await store.profiles()).map(({ subject }) => subject)).toEqual(['a']);
    await store.clearAll();
    expect(await store.profiles()).toEqual([]);
    expect([...values.keys()].sort()).toEqual(['inheriti.operatorProfiles', 'inheriti.operatorSessionGeneration'].sort());
  });

  it('keeps a readable SafeID label after a credential is revoked', async () => {
    const store = new SessionStorageOperatorSessionStore(sessionArea().area);
    const session = Object.assign(login('b'), {
      idToken: `header.${Buffer.from(JSON.stringify({ name: 'E2E Manager' })).toString('base64url')}.signature`,
    });
    await enroll(store, session);
    expect((await store.profiles())[0]?.label).toBe('E2E Manager');
    await (await store.forProfile(operatorProfileId(session))).clear();
    expect((await store.profiles())[0]?.label).toBe('E2E Manager');
  });

  it('discards saved provider credentials for Business while retaining the account row', async () => {
    const { area, values } = sessionArea();
    const store = new SessionStorageOperatorSessionStore(area);
    const session = login('business-user');
    session.principal.audience = 'inheriti-integrations-api';
    await enroll(store, session);
    values.set(MASTER_KEY_CACHE_PREFIX + 'org-a', 'a'.repeat(64));

    const configured = new SessionStorageOperatorSessionStore(area);
    configured.bind({ apiUrl: 'https://api.test/integrations/', issuer: session.principal.issuer,
      clientId: session.principal.authorizedParty, environment: 'TEST', scopes: ['openid'], masterKeyCustody: 'EXTERNAL' });
    expect(await configured.load()).toBeUndefined();
    expect((await store.profiles())[0]).toMatchObject({ subject: 'business-user', needsSignIn: true, active: false });
    expect(String(values.get('inheriti.operatorProfiles'))).not.toContain('business-user-refresh');
    expect(values.has(MASTER_KEY_CACHE_PREFIX + 'org-a')).toBe(false);
  });

  it('stores a Business session without a provider ID token or refresh credential', async () => {
    const { area, values } = sessionArea();
    const store = new SessionStorageOperatorSessionStore(area);
    const session = Object.assign(login('business-user'), {
      kind: 'business' as const, familyId: 'family-1', sessionExpiresAt: Date.now() + 300_000,
    });
    session.principal.audience = 'inheriti-integrations-api';
    await enroll(store, session);
    expect((await store.profiles())[0]?.label).toBe('business-user');
    expect(await store.load()).toEqual(session);
    const persisted = String(values.get('inheriti.operatorProfiles'));
    expect(persisted).toContain('family-1');
    expect(persisted).not.toContain('idToken');
  });

  it('fails closed on malformed profiles and leaves unrelated storage intact', async () => {
    const { area, values } = sessionArea();
    const store = new SessionStorageOperatorSessionStore(area);
    await enroll(store, login('a'));
    values.set('inheriti.operatorProfiles', '{bad');
    values.set('device-preference', 'keep');
    await expect(store.load()).resolves.toBeUndefined();
    expect(await store.profiles()).toEqual([]);
    expect(values.get('device-preference')).toBe('keep');
    expect(values.has('inheriti.operatorProfiles')).toBe(false);
  });
});
