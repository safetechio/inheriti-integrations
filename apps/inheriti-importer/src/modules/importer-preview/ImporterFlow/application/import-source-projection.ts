import type { ImportSourceRecord, VaultSourceKind } from '@modules/import/domain/vault';
import type { VaultState } from '@modules/import/infrastructure/stores/vault-store';
import type { ImportFile } from '../../SourceImportStatus';

const formatLabels: Record<VaultSourceKind, string> = {
  keepass: 'KeePass',
  onepassword: '1Password',
  passbolt: 'Passbolt',
  kubernetes: 'Kubernetes',
  vault: 'Vault',
  dotenv: 'dotenv',
  cloud: 'Cloud',
};

function pendingFormat(source: ImportSourceRecord): string {
  const extension = source.file.name.split('.').pop()?.toLowerCase();
  if (extension === 'kdbx') return 'KeePass';
  if (extension === '1pux') return '1Password';
  if (extension === 'yaml' || extension === 'yml') return 'YAML';
  if (extension === 'env') return 'dotenv';
  if (extension === 'csv') return 'CSV';
  if (extension === 'json') return 'JSON';
  return 'File';
}

export function projectImportSources(state: VaultState): ImportFile[] {
  return state.sources.map((source) => {
    const vault = state.vaults.find((item) => item.id === source.vaultId || item.id === source.id);
    return {
      id: source.id,
      name: source.file.name,
      format: vault ? formatLabels[vault.kind] : pendingFormat(source),
      entries: source.entries,
      warnings: source.warnings.length,
      status: source.status,
      detail: source.detail,
      warningMessages: source.warnings.slice(),
    };
  });
}
