import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
  await store.save(session('https://issuer.test'));
  expect(await store.load()).toEqual(session('https://issuer.test'));
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
