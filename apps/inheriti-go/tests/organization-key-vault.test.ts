import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ items: new Map<string, unknown>(), available: true, failWrite: false }));
vi.mock('../src/modules/launcher/main/protected-checkpoint.js', () => ({ ProtectedCheckpoint: class {
  isAvailable() { return storage.available; }
  hasFile() { return storage.items.size > 0; }
  getItem(path: string) { return storage.items.get(path) ?? null; }
  setItem(path: string, value: unknown) { if (storage.failWrite) throw new Error('disk_error'); storage.items.set(path, value); }
  removeItem(path: string) { storage.items.delete(path); }
  clean(root: string) { for (const path of storage.items.keys()) if (path.includes(root)) storage.items.delete(path); }
} }));

import { OrganizationKeyVault } from '../src/modules/launcher/main/organization-key-vault.js';

const principal = (subject: string, issuer = 'test-issuer') => ({ issuer, subject });
const ref = (contextId: string) => ({ system: 'INHERITI_BUSINESS', contextId });
const key = (byte: number) => new Uint8Array(32).fill(byte);

beforeEach(() => { storage.items.clear(); storage.available = true; storage.failWrite = false; });

describe('OrganizationKeyVault', () => {
  it('retains separate organisation keys after switching, locking and restart', async () => {
    const access = async () => principal('account-a');
    const vault = new OrganizationKeyVault('dev', access);
    await vault.store(ref('org-a'), key(1));
    await vault.store(ref('org-b'), key(2));
    vault.clearMemory();
    expect(await vault.load(ref('org-a'))).toEqual(key(1));
    expect(await vault.load(ref('org-b'))).toEqual(key(2));
    const restarted = new OrganizationKeyVault('dev', access);
    expect(await restarted.load(ref('org-a'))).toEqual(key(1));
    expect(await restarted.load(ref('org-b'))).toEqual(key(2));
  });

  it('separates deployment, issuer and account and deletes all current-account organisations on signout', async () => {
    const a = new OrganizationKeyVault('dev', async () => principal('account-a'));
    await a.store(ref('org-a'), key(1));
    await a.store(ref('org-b'), key(2));
    expect(await new OrganizationKeyVault('stg', async () => principal('account-a')).load(ref('org-a'))).toBeUndefined();
    expect(await new OrganizationKeyVault('dev', async () => principal('account-a', 'other-issuer')).load(ref('org-a'))).toBeUndefined();
    expect(await new OrganizationKeyVault('dev', async () => principal('account-b')).load(ref('org-a'))).toBeUndefined();
    const signedOut = new OrganizationKeyVault('dev', async () => principal('account-a'));
    await signedOut.forgetAccount();
    expect(storage.items.size).toBe(0);
  });

  it('uses memory only when safe storage is unavailable and validates key length', async () => {
    storage.available = false;
    const vault = new OrganizationKeyVault('dev', async () => principal('account-a'));
    await expect(vault.store(ref('org-a'), key(1).subarray(1))).rejects.toThrow('invalid_organization_key');
    await vault.store(ref('org-a'), key(1));
    expect(await vault.load(ref('org-a'))).toEqual(key(1));
    expect(storage.items.size).toBe(0);
    vault.clearMemory();
    expect(await vault.load(ref('org-a'))).toBeUndefined();
  });

  it('does not cache a key when encrypted storage fails', async () => {
    const vault = new OrganizationKeyVault('dev', async () => principal('account-a'));
    storage.failWrite = true;
    await expect(vault.store(ref('org-a'), key(1))).rejects.toThrow('disk_error');
    expect(await vault.load(ref('org-a'))).toBeUndefined();
  });

  it('purges the remembered account when its principal is unavailable', async () => {
    let current: ReturnType<typeof principal> | undefined = principal('account-a');
    const vault = new OrganizationKeyVault('dev', async () => current);
    await vault.store(ref('org-a'), key(1));
    current = undefined;
    await vault.forgetAccount();
    expect(await new OrganizationKeyVault('dev', async () => principal('account-a')).load(ref('org-a'))).toBeUndefined();
  });

  it('rejects a pending relay after lock or account switch', async () => {
    let current = principal('account-a');
    const vault = new OrganizationKeyVault('dev', async () => current);
    let finish!: () => void;
    const waiting = vault.withScope(async () => {
      await new Promise<void>((resolve) => { finish = resolve; });
      await vault.store(ref('org-a'), key(1));
    });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    current = principal('account-b');
    await vault.load(ref('org-a'));
    finish();
    await expect(waiting).rejects.toThrow('organization_key_request_canceled');
    expect(await vault.load(ref('org-a'))).toBeUndefined();
    expect(await new OrganizationKeyVault('dev', async () => principal('account-a')).load(ref('org-a'))).toBeUndefined();
  });

  it('reports when a previously persisted account cannot be purged', async () => {
    const vault = new OrganizationKeyVault('dev', async () => principal('account-a'));
    await vault.store(ref('org-a'), key(1));
    storage.available = false;
    await expect(vault.forgetAccount()).rejects.toThrow('protected_storage_unavailable');
  });

  it('allows signout after memory-only use when protected storage was never available', async () => {
    storage.available = false;
    const vault = new OrganizationKeyVault('dev', async () => principal('account-a'));
    await vault.store(ref('org-a'), key(1));
    await expect(vault.forgetAccount()).resolves.toBeUndefined();
    expect(await vault.load(ref('org-a'))).toBeUndefined();
  });

  it('cancels a request blocked before the account scope is acquired', async () => {
    let release!: (value: ReturnType<typeof principal>) => void;
    const vault = new OrganizationKeyVault('dev', () => new Promise((resolve) => { release = resolve; }));
    const action = vi.fn(async () => vault.store(ref('org-a'), key(1)));
    const pending = vault.withScope(action);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    vault.clearMemory();
    release(principal('account-a'));
    await expect(pending).rejects.toThrow('organization_key_request_canceled');
    expect(action).not.toHaveBeenCalled();
    expect(storage.items.size).toBe(0);
  });

  it('allows concurrent initial requests for the same account', async () => {
    const vault = new OrganizationKeyVault('dev', async () => principal('account-a'));
    const [first, second] = await Promise.all([
      vault.withScope(async () => { await vault.store(ref('org-a'), key(1)); return vault.load(ref('org-a')); }),
      vault.withScope(async () => { await vault.store(ref('org-b'), key(2)); return vault.load(ref('org-b')); }),
    ]);
    expect(first).toEqual(key(1));
    expect(second).toEqual(key(2));
  });

  it('purges every account key for one deployment and issuer only', async () => {
    const active = new OrganizationKeyVault('dev', async () => principal('account-a'), 'test-issuer');
    const sibling = new OrganizationKeyVault('dev', async () => principal('account-b'), 'test-issuer');
    const otherIssuer = new OrganizationKeyVault('dev', async () => principal('account-a', 'other-issuer'), 'other-issuer');
    const otherDeployment = new OrganizationKeyVault('stg', async () => principal('account-a'), 'test-issuer');
    await active.store(ref('org-a'), key(1));
    await sibling.store(ref('org-b'), key(2));
    await otherIssuer.store(ref('org-c'), key(3));
    await otherDeployment.store(ref('org-d'), key(4));
    await active.forgetAll();
    expect(await new OrganizationKeyVault('dev', async () => principal('account-a')).load(ref('org-a'))).toBeUndefined();
    expect(await new OrganizationKeyVault('dev', async () => principal('account-b')).load(ref('org-b'))).toBeUndefined();
    expect(await otherIssuer.load(ref('org-c'))).toEqual(key(3));
    expect(await otherDeployment.load(ref('org-d'))).toEqual(key(4));
  });

  it('rejects a principal from another issuer when configured for all-account cleanup', async () => {
    const vault = new OrganizationKeyVault('dev', async () => principal('account-a', 'other-issuer'), 'test-issuer');
    await expect(vault.store(ref('org-a'), key(1))).rejects.toThrow('reauthentication_required');
  });

  it('preserves active keys if all-account cleanup cannot access protected storage', async () => {
    const vault = new OrganizationKeyVault('dev', async () => principal('account-a'), 'test-issuer');
    await vault.store(ref('org-a'), key(1));
    storage.available = false;
    await expect(vault.forgetAll()).rejects.toThrow('protected_storage_unavailable');
    expect(await vault.load(ref('org-a'))).toEqual(key(1));
  });
});
