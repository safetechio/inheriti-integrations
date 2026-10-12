import { describe, expect, it } from 'vitest';
import InMemoryOrganizationKeyVault from '@modules/organization/infrastructure/in-memory-organization-key-vault';

const context = { sessionFamilyId: 'session-1', userId: 'user-1', organizationId: 'org-1' };

describe('InMemoryOrganizationKeyVault', () => {
  it('round-trips a key for its context', async () => {
    const vault = new InMemoryOrganizationKeyVault();
    await vault.set(context, 'master-key');
    await expect(vault.get(context)).resolves.toBe('master-key');
  });

  it('does not retain a key across a fresh instance (simulated reload)', async () => {
    const beforeReload = new InMemoryOrganizationKeyVault();
    await beforeReload.set(context, 'master-key');
    const afterReload = new InMemoryOrganizationKeyVault();
    await expect(afterReload.get(context)).resolves.toBeNull();
  });

  it('clearOrganization scopes to the exact context', async () => {
    const vault = new InMemoryOrganizationKeyVault();
    const other = { ...context, organizationId: 'org-2' };
    await vault.set(context, 'master-key');
    await vault.set(other, 'other-key');
    await vault.clearOrganization(context);
    await expect(vault.get(context)).resolves.toBeNull();
    await expect(vault.get(other)).resolves.toBe('other-key');
  });

  it('clearSession scopes to the session family', async () => {
    const vault = new InMemoryOrganizationKeyVault();
    const otherSession = { ...context, sessionFamilyId: 'session-2' };
    await vault.set(context, 'master-key');
    await vault.set(otherSession, 'other-key');
    await vault.clearSession(context.sessionFamilyId);
    await expect(vault.get(context)).resolves.toBeNull();
    await expect(vault.get(otherSession)).resolves.toBe('other-key');
  });

  it('clearAllSessions wipes every entry', async () => {
    const vault = new InMemoryOrganizationKeyVault();
    await vault.set(context, 'master-key');
    await vault.set({ ...context, organizationId: 'org-2' }, 'other-key');
    await vault.clearAllSessions();
    await expect(vault.get(context)).resolves.toBeNull();
  });
});
