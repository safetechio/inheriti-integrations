import type {
  OrganizationKeyVault,
  OrganizationKeyVaultContext,
} from '@shared/infrastructure/importer-api';

/**
 * Spike-only proof for ADR 0001 (`docs/adr/0001-organization-key-boundary.md`).
 * Not the production vault: it exists to prove that the Importer's
 * `OrganizationKeyVault` port can be satisfied without any persisted store,
 * so a fresh instance (simulating a renderer reload/crash) never retains a
 * previously released key. The real Electron-host implementation lives at
 * `src/modules/organization/infrastructure/in-memory-organization-key-vault.ts`,
 * not this file.
 */
export default class InMemoryOrganizationKeyVault implements OrganizationKeyVault {
  private readonly entries = new Map<string, string>();

  private static keyFor(context: OrganizationKeyVaultContext): string {
    return `${context.sessionFamilyId}:${context.userId}:${context.organizationId}`;
  }

  async get(context: OrganizationKeyVaultContext): Promise<string | null> {
    return this.entries.get(InMemoryOrganizationKeyVault.keyFor(context)) ?? null;
  }

  async set(context: OrganizationKeyVaultContext, masterKey: string): Promise<void> {
    this.entries.set(InMemoryOrganizationKeyVault.keyFor(context), masterKey);
  }

  async clearOrganization(context: OrganizationKeyVaultContext): Promise<void> {
    this.entries.delete(InMemoryOrganizationKeyVault.keyFor(context));
  }

  async clearSession(sessionFamilyId: string): Promise<void> {
    for (const key of this.entries.keys()) {
      if (key.startsWith(`${sessionFamilyId}:`)) {
        this.entries.delete(key);
      }
    }
  }

  async clearAllSessions(): Promise<void> {
    this.entries.clear();
  }
}
