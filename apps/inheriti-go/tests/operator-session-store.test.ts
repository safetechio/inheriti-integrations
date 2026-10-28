import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { OperatorSession } from '@safetech/inheriti-elements-core/node';

const secure = vi.hoisted(() => ({ directory: '', available: true }));
vi.mock('electron', () => ({
  app: { getPath: () => secure.directory },
  safeStorage: {
    isEncryptionAvailable: () => secure.available,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => value.toString().slice('encrypted:'.length),
  },
}));

import { ProtectedOperatorSessionStore } from '../src/modules/launcher/main/operator-session-store.js';

const session = (issuer: string): OperatorSession => ({
  accessToken: 'private-access-token', refreshToken: 'private-refresh-token', idToken: 'private-id-token',
  tokenType: 'Bearer', expiresAt: Date.now() + 60_000,
  principal: { issuer, audience: 'test', authorizedParty: 'go', environment: 'TEST', subject: 'member',
    sessionId: 'session', tokenId: 'token', scopes: [] },
});

afterEach(() => { rmSync(secure.directory, { recursive: true, force: true }); secure.available = true; });

it('restores only the matching deployment and issuer, then clears on sign-out', async () => {
  secure.directory = mkdtempSync(join(tmpdir(), 'go-session-'));
  const first = new ProtectedOperatorSessionStore('dev', 'https://issuer.test');
  const original = session('https://issuer.test');
  await first.save(original);
  first.saveSelectedOrganization('org-b');
  expect(readFileSync(join(secure.directory, 'protected-checkpoint'), 'utf8')).not.toContain('private-refresh-token');
  const restarted = new ProtectedOperatorSessionStore('dev', 'https://issuer.test');
  expect(await restarted.load()).toEqual(original);
  expect(restarted.selectedOrganization()).toBe('org-b');
  expect(await new ProtectedOperatorSessionStore('stg', 'https://issuer.test').load()).toBeUndefined();
  expect(await new ProtectedOperatorSessionStore('dev', 'https://other.test').load()).toBeUndefined();
  await first.clear();
  expect(await new ProtectedOperatorSessionStore('dev', 'https://issuer.test').load()).toBeUndefined();
  expect(restarted.selectedOrganization()).toBeUndefined();
});

it('keeps the session in memory only when secure storage is unavailable', async () => {
  secure.directory = mkdtempSync(join(tmpdir(), 'go-session-'));
  secure.available = false;
  const store = new ProtectedOperatorSessionStore('dev', 'https://issuer.test');
  const original = session('https://issuer.test');
  await store.save(original);
  expect(await store.load()).toEqual(original);
  expect(await new ProtectedOperatorSessionStore('dev', 'https://issuer.test').load()).toBeUndefined();
  await store.clear();
  expect(await store.load()).toBeUndefined();
});

it('rejects corrupt or wrong-issuer sessions', async () => {
  secure.directory = mkdtempSync(join(tmpdir(), 'go-session-'));
  const store = new ProtectedOperatorSessionStore('dev', 'https://issuer.test');
  await expect(store.save(session('https://other.test'))).rejects.toThrow('Invalid operator session');
  await store.save(session('https://issuer.test'));
  const file = join(secure.directory, 'protected-checkpoint');
  const encoded = readFileSync(file, 'utf8');
  const values = JSON.parse(Buffer.from(encoded, 'base64').toString().slice('encrypted:'.length)) as Record<string, unknown>;
  values[Object.keys(values)[0]!] = { accessToken: 'bad' };
  const { writeFileSync } = await import('node:fs');
  writeFileSync(file, Buffer.from(`encrypted:${JSON.stringify(values)}`).toString('base64'));
  await expect(new ProtectedOperatorSessionStore('dev', 'https://issuer.test').load()).resolves.toBeUndefined();
  await expect(new ProtectedOperatorSessionStore('dev', 'https://issuer.test').load()).resolves.toBeUndefined();
});

it('preserves the checkpoint when decryption fails', async () => {
  secure.directory = mkdtempSync(join(tmpdir(), 'go-session-'));
  const store = new ProtectedOperatorSessionStore('dev', 'https://issuer.test');
  await store.save(session('https://issuer.test'));
  const file = join(secure.directory, 'protected-checkpoint');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(file, Buffer.from('unreadable').toString('base64'));
  const before = readFileSync(file, 'utf8');
  await expect(new ProtectedOperatorSessionStore('dev', 'https://issuer.test').load()).rejects.toThrow();
  expect(readFileSync(file, 'utf8')).toBe(before);
});

it('migrates the legacy session and keeps its organization preference', async () => {
  secure.directory = mkdtempSync(join(tmpdir(), 'go-session-'));
  const legacyPath = `operator-session/dev/${createHash('sha256').update('https://issuer.test').digest('hex')}`;
  const file = join(secure.directory, 'protected-checkpoint');
  const original = session('https://issuer.test');
  const values = { [legacyPath]: original, [`${legacyPath}/organisation/member`]: 'org-a' };
  const { writeFileSync } = await import('node:fs');
  writeFileSync(file, Buffer.from(`encrypted:${JSON.stringify(values)}`).toString('base64'));
  const store = new ProtectedOperatorSessionStore('dev', 'https://issuer.test');
  expect(await store.load()).toEqual(original);
  expect(store.selectedOrganization()).toBe('org-a');
  expect(await store.listProfiles()).toEqual(['member']);
  const migrated = JSON.parse(Buffer.from(readFileSync(file, 'utf8'), 'base64').toString().slice('encrypted:'.length)) as Record<string, unknown>;
  expect(migrated[legacyPath]).toBeUndefined();
  expect(migrated[`${legacyPath}/active`]).toBe('member');
});

it('keeps profiles and preferences separate across activation and duplicate enrollment', async () => {
  secure.directory = mkdtempSync(join(tmpdir(), 'go-session-'));
  const store = new ProtectedOperatorSessionStore('dev', 'https://issuer.test');
  const member = session('https://issuer.test');
  const other = { ...session('https://issuer.test'), principal: { ...member.principal, subject: 'other' }, refreshToken: 'other-refresh' };
  await store.save(member);
  store.saveSelectedOrganization('org-a');
  await store.enroll(other);
  expect(await store.load()).toEqual(member);
  await expect(store.save(other)).rejects.toThrow('operator_account_changed');
  await store.activate('other');
  const otherStore = new ProtectedOperatorSessionStore('dev', 'https://issuer.test');
  expect(await otherStore.load()).toEqual(other);
  expect(otherStore.selectedOrganization()).toBeUndefined();
  otherStore.saveSelectedOrganization('org-b');
  await store.enroll({ ...other, refreshToken: 'rotated' });
  expect(await store.listProfiles()).toEqual(['member', 'other']);
  await store.activate('member');
  const memberStore = new ProtectedOperatorSessionStore('dev', 'https://issuer.test');
  expect(await memberStore.load()).toEqual(member);
  expect(memberStore.selectedOrganization()).toBe('org-a');
  await store.activate('other');
  const rotatedStore = new ProtectedOperatorSessionStore('dev', 'https://issuer.test');
  expect((await rotatedStore.load())?.refreshToken).toBe('rotated');
  expect(rotatedStore.selectedOrganization()).toBe('org-b');
  await rotatedStore.clear();
  expect(await store.listProfiles()).toEqual(['member']);
  expect(await new ProtectedOperatorSessionStore('dev', 'https://issuer.test').load()).toBeUndefined();
  await store.activate('member');
  expect(await new ProtectedOperatorSessionStore('dev', 'https://issuer.test').load()).toEqual(member);
});

it('keeps multiple profiles in memory only when protected storage is unavailable', async () => {
  secure.directory = mkdtempSync(join(tmpdir(), 'go-session-'));
  secure.available = false;
  const store = new ProtectedOperatorSessionStore('dev', 'https://issuer.test');
  const member = session('https://issuer.test');
  const other = { ...member, principal: { ...member.principal, subject: 'other' } };
  await store.save(member);
  await store.enroll(other);
  await store.activate('other');
  expect(await store.load()).toEqual(member);
  expect(await store.listProfiles()).toEqual(['member', 'other']);
  expect(await new ProtectedOperatorSessionStore('dev', 'https://issuer.test').listProfiles()).toEqual([]);
});

it('keeps a newer active profile when an old refresh saves and clears', async () => {
  secure.directory = mkdtempSync(join(tmpdir(), 'go-session-'));
  const oldCoreStore = new ProtectedOperatorSessionStore('dev', 'https://issuer.test');
  const member = session('https://issuer.test');
  const other = { ...member, principal: { ...member.principal, subject: 'other' } };
  await oldCoreStore.save(member);
  await oldCoreStore.enroll(other);
  await oldCoreStore.activate('other');
  const newCoreStore = new ProtectedOperatorSessionStore('dev', 'https://issuer.test');
  expect(await newCoreStore.load()).toEqual(other);
  await oldCoreStore.save({ ...member, refreshToken: 'late-refresh' });
  expect(await newCoreStore.load()).toEqual(other);
  await oldCoreStore.clear();
  expect(await newCoreStore.load()).toEqual(other);
  expect(await newCoreStore.listProfiles()).toEqual(['other']);
  await expect(oldCoreStore.save(member)).rejects.toThrow('operator_session_retired');
  expect(await oldCoreStore.load()).toBeUndefined();
  expect(await newCoreStore.load()).toEqual(other);
});

it('preserves a memory-only session when protection becomes available', async () => {
  secure.directory = mkdtempSync(join(tmpdir(), 'go-session-'));
  secure.available = false;
  const store = new ProtectedOperatorSessionStore('dev', 'https://issuer.test');
  const member = session('https://issuer.test');
  await store.save(member);
  secure.available = true;
  expect(await store.load()).toEqual(member);
  expect(await new ProtectedOperatorSessionStore('dev', 'https://issuer.test').load()).toEqual(member);
});

it('does not replace a persisted active profile when an in-memory profile becomes protected', async () => {
  secure.directory = mkdtempSync(join(tmpdir(), 'go-session-'));
  const persisted = session('https://issuer.test');
  await new ProtectedOperatorSessionStore('dev', 'https://issuer.test').save(persisted);
  secure.available = false;
  const memoryStore = new ProtectedOperatorSessionStore('dev', 'https://issuer.test');
  const memory = { ...persisted, principal: { ...persisted.principal, subject: 'memory' } };
  await memoryStore.save(memory);
  secure.available = true;
  expect(await memoryStore.load()).toEqual(memory);
  expect(await new ProtectedOperatorSessionStore('dev', 'https://issuer.test').load()).toEqual(persisted);
});

it('switches memory-only profiles through fresh adapters without reviving a removed one', async () => {
  secure.directory = mkdtempSync(join(tmpdir(), 'go-session-'));
  secure.available = false;
  const registry = new ProtectedOperatorSessionStore('dev', 'https://issuer.test');
  const member = session('https://issuer.test');
  const other = { ...member, principal: { ...member.principal, subject: 'other' } };
  await registry.save(member);
  await registry.enroll(other);
  await registry.activate('other');
  const otherCore = registry.fork();
  expect(await otherCore.load()).toEqual(other);
  await registry.activate('member');
  const memberCore = registry.fork();
  expect(await memberCore.load()).toEqual(member);
  await memberCore.clear();
  await expect(memberCore.save(member)).rejects.toThrow('operator_session_retired');
  expect(await memberCore.load()).toBeUndefined();
  await registry.activate('other');
  expect(await registry.fork().load()).toEqual(other);
  expect(await registry.listProfiles()).toEqual(['other']);
});

it('does not resurrect a profile removed through another store instance', async () => {
  secure.directory = mkdtempSync(join(tmpdir(), 'go-session-'));
  const original = session('https://issuer.test');
  const stale = new ProtectedOperatorSessionStore('dev', 'https://issuer.test');
  await stale.save(original);
  const remover = new ProtectedOperatorSessionStore('dev', 'https://issuer.test');
  expect(await remover.load()).toEqual(original);
  await remover.clear();
  expect(await stale.load()).toBeUndefined();
  await expect(stale.save(original)).rejects.toThrow('operator_session_retired');
  expect(await new ProtectedOperatorSessionStore('dev', 'https://issuer.test').listProfiles()).toEqual([]);
});

it('does not let an old adapter overwrite or clear a re-enrolled subject', async () => {
  secure.directory = mkdtempSync(join(tmpdir(), 'go-session-'));
  const original = session('https://issuer.test');
  const stale = new ProtectedOperatorSessionStore('dev', 'https://issuer.test');
  await stale.save(original);
  const replacement = new ProtectedOperatorSessionStore('dev', 'https://issuer.test');
  await replacement.enroll({ ...original, refreshToken: 'new-family' });
  await expect(stale.save({ ...original, refreshToken: 'old-family' })).rejects.toThrow('operator_session_retired');
  await stale.clear();
  const active = new ProtectedOperatorSessionStore('dev', 'https://issuer.test');
  expect((await active.load())?.refreshToken).toBe('new-family');
});

it('clears the memory pointer when protected storage is removed', async () => {
  secure.directory = mkdtempSync(join(tmpdir(), 'go-session-'));
  secure.available = false;
  const store = new ProtectedOperatorSessionStore('dev', 'https://issuer.test');
  const first = session('https://issuer.test');
  await store.save(first);
  secure.available = true;
  expect(await store.load()).toEqual(first);
  await store.clear();
  secure.available = false;
  const next = store.fork();
  const other = { ...first, principal: { ...first.principal, subject: 'other' } };
  await next.save(other);
  expect(await next.load()).toEqual(other);
});

it('does not let an unbound old adapter clear a newly active profile', async () => {
  secure.directory = mkdtempSync(join(tmpdir(), 'go-session-'));
  const old = new ProtectedOperatorSessionStore('dev', 'https://issuer.test');
  const registry = new ProtectedOperatorSessionStore('dev', 'https://issuer.test');
  const first = session('https://issuer.test');
  const other = { ...first, principal: { ...first.principal, subject: 'other' } };
  await registry.save(first);
  await registry.enroll(other);
  await registry.activate('other');
  await old.clear();
  expect(old.isRetired).toBe(true);
  expect(await new ProtectedOperatorSessionStore('dev', 'https://issuer.test').load()).toEqual(other);
  expect(await registry.listProfiles()).toEqual(['member', 'other']);
});

it('does not let a stale adapter change a re-enrolled profile preference', async () => {
  secure.directory = mkdtempSync(join(tmpdir(), 'go-session-'));
  const first = session('https://issuer.test');
  const stale = new ProtectedOperatorSessionStore('dev', 'https://issuer.test');
  await stale.save(first);
  stale.saveSelectedOrganization('org-a');
  const replacement = new ProtectedOperatorSessionStore('dev', 'https://issuer.test');
  await replacement.enroll({ ...first, refreshToken: 'replacement' });
  stale.saveSelectedOrganization('org-stale');
  expect(stale.selectedOrganization()).toBeUndefined();
  expect(await replacement.load()).toMatchObject({ refreshToken: 'replacement' });
  expect(replacement.selectedOrganization()).toBe('org-a');
});

it('persists an in-memory refresh after protection returns without restoring the old token', async () => {
  secure.directory = mkdtempSync(join(tmpdir(), 'go-session-'));
  const store = new ProtectedOperatorSessionStore('dev', 'https://issuer.test');
  const original = session('https://issuer.test');
  await store.save(original);
  secure.available = false;
  await store.save({ ...original, refreshToken: 'rotated' });
  secure.available = true;
  expect((await store.load())?.refreshToken).toBe('rotated');
  expect((await new ProtectedOperatorSessionStore('dev', 'https://issuer.test').load())?.refreshToken).toBe('rotated');
});

it('does not promote a memory refresh over a replaced durable profile', async () => {
  secure.directory = mkdtempSync(join(tmpdir(), 'go-session-'));
  const store = new ProtectedOperatorSessionStore('dev', 'https://issuer.test');
  const original = session('https://issuer.test');
  await store.save(original);
  secure.available = false;
  await store.save({ ...original, refreshToken: 'memory-rotation' });
  secure.available = true;
  const replacement = new ProtectedOperatorSessionStore('dev', 'https://issuer.test');
  await replacement.enroll({ ...original, refreshToken: 'replacement' });
  expect(await store.load()).toBeUndefined();
  expect(store.isRetired).toBe(true);
  expect((await new ProtectedOperatorSessionStore('dev', 'https://issuer.test').load())?.refreshToken).toBe('replacement');
});

it('restores a memory-rotated profile after switching away and back through fresh adapters', async () => {
  secure.directory = mkdtempSync(join(tmpdir(), 'go-session-'));
  const registry = new ProtectedOperatorSessionStore('dev', 'https://issuer.test');
  const first = session('https://issuer.test');
  const other = { ...first, principal: { ...first.principal, subject: 'other' } };
  await registry.save(first);
  secure.available = false;
  await registry.save({ ...first, refreshToken: 'rotated-a' });
  secure.available = true;
  await registry.enroll(other);
  await registry.activate('other');
  expect(await registry.fork().load()).toEqual(other);
  await registry.activate('member');
  expect((await registry.fork().load())?.refreshToken).toBe('rotated-a');
  expect((await new ProtectedOperatorSessionStore('dev', 'https://issuer.test').load())?.refreshToken).toBe('rotated-a');
});
