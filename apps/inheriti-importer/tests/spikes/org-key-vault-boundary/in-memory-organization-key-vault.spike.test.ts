import { describe, expect, it, vi } from 'vitest';
import InMemoryOrganizationKeyVault from './in-memory-organization-key-vault';

const context = {
  sessionFamilyId: 'session-a',
  userId: 'user-1',
  organizationId: 'org-1',
};

describe('InMemoryOrganizationKeyVault (ADR 0001 spike)', () => {
  it('round-trips a released key within one session', async () => {
    const vault = new InMemoryOrganizationKeyVault();

    expect(await vault.get(context)).toBeNull();

    await vault.set(context, 'raw-master-key');

    expect(await vault.get(context)).toBe('raw-master-key');
  });

  it('does not retain a key across a simulated renderer reload', async () => {
    const beforeReload = new InMemoryOrganizationKeyVault();
    await beforeReload.set(context, 'raw-master-key');

    const afterReload = new InMemoryOrganizationKeyVault();

    expect(await afterReload.get(context)).toBeNull();
  });

  it('clearOrganization purges only that organization', async () => {
    const vault = new InMemoryOrganizationKeyVault();
    const otherOrg = { ...context, organizationId: 'org-2' };
    await vault.set(context, 'key-org-1');
    await vault.set(otherOrg, 'key-org-2');

    await vault.clearOrganization(context);

    expect(await vault.get(context)).toBeNull();
    expect(await vault.get(otherOrg)).toBe('key-org-2');
  });

  it('clearSession purges every organization released under that login session', async () => {
    const vault = new InMemoryOrganizationKeyVault();
    const otherOrgSameSession = { ...context, organizationId: 'org-2' };
    const otherSession = { ...context, sessionFamilyId: 'session-b' };
    await vault.set(context, 'key-a');
    await vault.set(otherOrgSameSession, 'key-b');
    await vault.set(otherSession, 'key-c');

    await vault.clearSession('session-a');

    expect(await vault.get(context)).toBeNull();
    expect(await vault.get(otherOrgSameSession)).toBeNull();
    expect(await vault.get(otherSession)).toBe('key-c');
  });

  it('clearAllSessions purges every released key', async () => {
    const vault = new InMemoryOrganizationKeyVault();
    await vault.set(context, 'key-a');
    await vault.set({ ...context, sessionFamilyId: 'session-b' }, 'key-b');

    await vault.clearAllSessions();

    expect(await vault.get(context)).toBeNull();
    expect(await vault.get({ ...context, sessionFamilyId: 'session-b' })).toBeNull();
  });

  it('never touches indexedDB or localStorage', async () => {
    const openSpy = typeof indexedDB !== 'undefined' ? vi.spyOn(indexedDB, 'open') : null;
    const setItemSpy =
      typeof localStorage !== 'undefined' ? vi.spyOn(Storage.prototype, 'setItem') : null;

    const vault = new InMemoryOrganizationKeyVault();
    await vault.set(context, 'raw-master-key');
    await vault.get(context);
    await vault.clearOrganization(context);
    await vault.clearSession(context.sessionFamilyId);
    await vault.clearAllSessions();

    expect(openSpy?.mock.calls.length ?? 0).toBe(0);
    expect(setItemSpy?.mock.calls.length ?? 0).toBe(0);
  });
});
