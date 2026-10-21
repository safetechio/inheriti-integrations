import { describe, expect, it } from 'vitest';
import { projectImportSources } from '@modules/importer-preview/ImporterFlow/application/import-source-projection';
import { initialVaultState } from '@modules/import/infrastructure/stores/vault-store';

describe('projectImportSources', () => {
  it('labels 1Password exports before and after parsing', () => {
    const source = {
      id: 'source-1',
      file: { name: 'vault.1pux', data: new ArrayBuffer(0) },
      status: 'pending' as const,
      warnings: [],
      entries: 0,
    };
    const pending = projectImportSources({ ...initialVaultState, sources: [source] });
    expect(pending[0].format).toBe('1Password');

    const loaded = projectImportSources({
      ...initialVaultState,
      sources: [{ ...source, status: 'ready', vaultId: 'source-1' }],
      vaults: [
        {
          id: 'source-1',
          name: 'Vault',
          kind: 'onepassword',
          fileName: 'vault.1pux',
          importedAt: '2026-09-08T00:00:00.000Z',
          warnings: [],
        },
      ],
    });
    expect(loaded[0].format).toBe('1Password');
  });

  it('projects stable source identity, parser warnings, and actual entry counts', () => {
    const files = projectImportSources({
      ...initialVaultState,
      vaults: [
        {
          id: 'source-1',
          name: 'Production',
          kind: 'keepass',
          fileName: 'production.kdbx',
          importedAt: '2026-09-08T00:00:00.000Z',
          warnings: ['Entry 4 has no title.'],
        },
      ],
      sources: [
        {
          id: 'source-1',
          file: { name: 'production.kdbx', data: new ArrayBuffer(0) },
          status: 'warning',
          warnings: ['Entry 4 has no title.'],
          entries: 12,
          vaultId: 'source-1',
        },
      ],
    });

    expect(files).toEqual([
      {
        id: 'source-1',
        name: 'production.kdbx',
        format: 'KeePass',
        entries: 12,
        warnings: 1,
        status: 'warning',
        detail: undefined,
        warningMessages: ['Entry 4 has no title.'],
      },
    ]);
  });
});
