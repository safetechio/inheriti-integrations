import { beforeEach, expect, it, vi } from 'vitest';
import type { OperatorSession } from '../../../../packages/core/src/node-base.js';
import { WorkspaceOperatorSessionStore } from '../../src-tauri/sidecar/session-store.js';

const backend = vi.hoisted(() => ({ values: new Map<string, string>(), unavailable: false, deletionFails: false }));
vi.mock('@napi-rs/keyring', () => ({
  AsyncEntry: class {
    private readonly id: string;
    constructor(service: string, account: string) {
      if (backend.unavailable) throw new Error('unavailable');
      this.id = `${service}\0${account}`;
    }
    async getPassword() { return backend.values.get(this.id); }
    async setPassword(value: string) { backend.values.set(this.id, value); }
    async deletePassword() {
      if (backend.deletionFails) throw new Error('delete failed');
      backend.values.delete(this.id);
    }
  },
}));

const session = (issuer = 'https://issuer.test'): OperatorSession => ({
  accessToken: 'private-access-token', refreshToken: 'private-refresh-token', tokenType: 'Bearer', expiresAt: 2_000_000_000_000,
  principal: { issuer, audience: 'test', authorizedParty: 'viewer', environment: 'TEST', subject: 'member', sessionId: 'session', tokenId: 'token', scopes: [] },
});

beforeEach(() => { backend.values.clear(); backend.unavailable = false; backend.deletionFails = false; });

it('restores a matching session and isolates deployment and issuer', async () => {
  const first = new WorkspaceOperatorSessionStore('dev', 'https://issuer.test');
  await first.save(session());
  expect(await new WorkspaceOperatorSessionStore('dev', 'https://issuer.test').load()).toEqual(session());
  expect(await new WorkspaceOperatorSessionStore('stg', 'https://issuer.test').load()).toBeUndefined();
  expect(await new WorkspaceOperatorSessionStore('dev', 'https://other.test').load()).toBeUndefined();
  await first.clear();
  expect(await new WorkspaceOperatorSessionStore('dev', 'https://issuer.test').load()).toBeUndefined();
});

it('uses memory only when the OS keychain is unavailable', async () => {
  backend.unavailable = true;
  const held = new WorkspaceOperatorSessionStore('dev', 'https://issuer.test');
  await held.save(session());
  expect(await held.load()).toEqual(session());
  expect(await new WorkspaceOperatorSessionStore('dev', 'https://issuer.test').load()).toBeUndefined();
  await expect(held.clear()).rejects.toThrow('operator_session_clear_failed');
  expect(await held.load()).toBeUndefined();
});

it('rejects wrong-issuer and corrupt sessions and reports failed deletion', async () => {
  const held = new WorkspaceOperatorSessionStore('dev', 'https://issuer.test');
  await expect(held.save(session('https://other.test'))).rejects.toThrow('invalid_operator_session');
  await held.save(session());
  const [key] = backend.values.keys();
  backend.values.set(key!, '{broken');
  expect(await new WorkspaceOperatorSessionStore('dev', 'https://issuer.test').load()).toBeUndefined();
  await held.save(session());
  backend.deletionFails = true;
  await expect(held.clear()).rejects.toThrow('operator_session_clear_failed');
  expect(backend.values.size).toBe(1);
});

it('keeps an explicit sign-out marker across restarts until explicit sign-in clears it', async () => {
  const first = new WorkspaceOperatorSessionStore('dev', 'https://issuer.test');
  await first.markSignedOut();
  expect(await new WorkspaceOperatorSessionStore('dev', 'https://issuer.test').wasSignedOut()).toBe(true);
  expect(await new WorkspaceOperatorSessionStore('stg', 'https://issuer.test').wasSignedOut()).toBe(false);
  await first.clearSignedOut();
  expect(await new WorkspaceOperatorSessionStore('dev', 'https://issuer.test').wasSignedOut()).toBe(false);
  backend.unavailable = true;
  expect(await new WorkspaceOperatorSessionStore('dev', 'https://issuer.test').wasSignedOut()).toBe(true);
  await expect(first.markSignedOut()).rejects.toThrow('operator_sign_out_marker_failed');
});
