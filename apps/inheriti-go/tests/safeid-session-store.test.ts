import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { OperatorSession } from '@safetech/inheriti-elements-core/node';

const secure = vi.hoisted(() => ({ directory: '' }));
vi.mock('@safetech/inheriti-elements-core/node', async (importOriginal) => ({
  ...await importOriginal<typeof import('@safetech/inheriti-elements-core/node')>(),
  INTEGRATION_AUTHORITY: 'safeid-oidc',
}));
vi.mock('electron', () => ({
  app: { getPath: () => secure.directory },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => value.toString().slice('encrypted:'.length),
  },
}));

import { ProtectedOperatorSessionStore } from '../src/modules/launcher/main/operator-session-store.js';

const scope = { apiUrl: 'https://api.test/', audience: 'inheriti-integrations-api', clientId: 'go', environment: 'TEST' };
const session = (subject: string, refreshExpiresAt?: number): OperatorSession => ({
  kind: 'safeid-oidc-business', accessToken: `access-${subject}`, refreshToken: `refresh-${subject}`,
  tokenType: 'Bearer', expiresAt: Date.now() - 1000, ...(refreshExpiresAt === undefined ? {} : { refreshExpiresAt }),
  businessApiUrl: scope.apiUrl, audience: scope.audience, clientId: scope.clientId,
  issuer: 'https://issuer.test', environment: 'TEST',
  principal: { issuer: 'https://issuer.test', audience: scope.audience, authorizedParty: scope.clientId,
    environment: 'TEST', subject, sessionId: 'session', tokenId: 'token', scopes: [] },
});

afterEach(() => rmSync(secure.directory, { recursive: true, force: true }));

it('keeps expired-access accounts selectable while their refresh credentials are valid', async () => {
  secure.directory = mkdtempSync(join(tmpdir(), 'go-safeid-session-'));
  const store = new ProtectedOperatorSessionStore('dev', 'https://issuer.test', scope);
  const first = session('first', Date.now() + 60_000);
  await store.save(first);
  await store.enroll(session('second'));
  expect((await store.accountSummaries()).accounts).toEqual([
    { subject: 'first', name: 'Saved account', status: 'ready' },
    { subject: 'second', name: 'Saved account', status: 'ready' },
  ]);
  await store.activate('second');
  expect(await store.fork().load()).toMatchObject({ kind: 'safeid-oidc-business', principal: { subject: 'second' } });
});

it('requires sign-in again when the refresh credential has expired', async () => {
  secure.directory = mkdtempSync(join(tmpdir(), 'go-safeid-session-'));
  const store = new ProtectedOperatorSessionStore('dev', 'https://issuer.test', scope);
  await store.save(session('first', Date.now() - 1000));
  expect((await store.accountSummaries()).accounts[0]?.status).toBe('sign-in-again');
});
