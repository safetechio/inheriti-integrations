import type {
  OrganizationKeyVault,
  OrganizationKeyVaultContext,
} from '@shared/infrastructure/importer-api';

/**
 * Importer-owned `OrganizationKeyVault`: keeps the decrypted Organization Key
 * in a plain in-process `Map`, never IndexedDB/localStorage, so it cannot
 * survive a renderer reload, app restart, or crash. See
 * docs/adr/0001-organization-key-boundary.md.
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
