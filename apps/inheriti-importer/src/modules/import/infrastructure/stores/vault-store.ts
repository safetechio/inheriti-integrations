import {
  cloneEntry,
  createEmptyEntry,
  entriesEqual,
  type ImportedVault,
  type ImportSourceRecord,
  type ParseResult,
  type VaultEntry,
} from '@modules/import/domain/vault';

export type StoredEntry = {
  current: VaultEntry;
  original: VaultEntry;
};

export type VaultState = {
  vaults: ImportedVault[];
  entries: StoredEntry[];
  selectedVaultId: string | 'all';
  selectedEntryId: string | null;
  query: string;
  warnings: string[];
  /** Per-file lifecycle records. File bytes remain memory-only for retry/unlock. */
  sources: ImportSourceRecord[];
};

export type VaultAction =
  | { type: 'import'; vault: ImportedVault; entries: VaultEntry[]; warnings: string[] }
  | { type: 'source-start'; source: ImportSourceRecord }
  | {
      type: 'source-status';
      sourceId: string;
      status: ImportSourceRecord['status'];
      detail?: string;
      entries?: number;
      warnings?: string[];
      vaultId?: string;
    }
  | { type: 'remove-vault'; vaultId: string }
  | { type: 'remove-source'; sourceId: string }
  | { type: 'select-vault'; vaultId: string | 'all' }
  | { type: 'select-entry'; entryId: string | null }
  | { type: 'update-entry'; entryId: string; patch: Partial<VaultEntry> }
  | { type: 'revert-entry'; entryId: string }
  | { type: 'set-query'; query: string }
  | { type: 'clear-warnings' }
  | { type: 'purge' };

export const initialVaultState: VaultState = {
  vaults: [],
  entries: [],
  selectedVaultId: 'all',
  selectedEntryId: null,
  query: '',
  warnings: [],
  sources: [],
};

export function vaultReducer(state: VaultState, action: VaultAction): VaultState {
  switch (action.type) {
    case 'import': {
      return {
        ...state,
        vaults: [...state.vaults.filter((vault) => vault.id !== action.vault.id), action.vault],
        entries: [
          ...state.entries.filter((entry) => entry.current.sourceId !== action.vault.id),
          ...action.entries.map((entry) => ({
            current: entry,
            original: cloneEntry(entry),
          })),
        ],
        selectedVaultId: action.vault.id,
        selectedEntryId: action.entries[0]?.id ?? state.selectedEntryId,
        warnings: action.warnings,
        sources: state.sources.map((source) =>
          source.id === action.vault.id
            ? {
                ...source,
                status: action.warnings.length ? 'warning' : 'imported',
                warnings: [...action.warnings],
                entries: action.entries.length,
                detail: undefined,
                vaultId: action.vault.id,
              }
            : source,
        ),
      };
    }
    case 'source-start':
      return {
        ...state,
        sources: [
          ...state.sources.filter((source) => source.id !== action.source.id),
          action.source,
        ],
      };
    case 'source-status':
      return {
        ...state,
        sources: state.sources.map((source) =>
          source.id === action.sourceId
            ? {
                ...source,
                status: action.status,
                detail: action.detail ?? source.detail,
                entries: action.entries ?? source.entries,
                warnings: action.warnings ?? source.warnings,
                vaultId: action.vaultId ?? source.vaultId,
              }
            : source,
        ),
      };
    case 'remove-vault': {
      const entries = state.entries.filter((entry) => entry.current.sourceId !== action.vaultId);
      const vaults = state.vaults.filter((vault) => vault.id !== action.vaultId);
      const selectedStillVisible = entries.some(
        (entry) => entry.current.id === state.selectedEntryId,
      );
      return {
        ...state,
        vaults,
        entries,
        selectedVaultId: state.selectedVaultId === action.vaultId ? 'all' : state.selectedVaultId,
        selectedEntryId: selectedStillVisible
          ? state.selectedEntryId
          : (entries[0]?.current.id ?? null),
        sources: state.sources.filter((source) => source.vaultId !== action.vaultId),
      };
    }
    case 'remove-source': {
      const source = state.sources.find((item) => item.id === action.sourceId);
      const vaultId = source?.vaultId ?? action.sourceId;
      const entries = state.entries.filter((entry) => entry.current.sourceId !== action.sourceId);
      const selectedStillVisible = entries.some(
        (entry) => entry.current.id === state.selectedEntryId,
      );
      return {
        ...state,
        vaults: state.vaults.filter((vault) => vault.id !== vaultId),
        entries,
        selectedVaultId: state.selectedVaultId === vaultId ? 'all' : state.selectedVaultId,
        selectedEntryId: selectedStillVisible
          ? state.selectedEntryId
          : (entries[0]?.current.id ?? null),
        warnings: state.sources
          .filter((item) => item.id !== action.sourceId)
          .flatMap((item) => item.warnings),
        sources: state.sources.filter((item) => item.id !== action.sourceId),
      };
    }
    case 'select-vault':
      return { ...state, selectedVaultId: action.vaultId };
    case 'select-entry':
      return { ...state, selectedEntryId: action.entryId };
    case 'update-entry':
      return {
        ...state,
        entries: state.entries.map((entry) =>
          entry.current.id === action.entryId
            ? { ...entry, current: { ...entry.current, ...action.patch } }
            : entry,
        ),
      };
    case 'revert-entry':
      return {
        ...state,
        entries: state.entries.map((entry) =>
          entry.current.id === action.entryId
            ? { ...entry, current: cloneEntry(entry.original) }
            : entry,
        ),
      };
    case 'set-query':
      return { ...state, query: action.query };
    case 'clear-warnings':
      return { ...state, warnings: [] };
    case 'purge':
      return { ...initialVaultState };
    default:
      return state;
  }
}

export function entriesFromParse(result: ParseResult, sourceId: string): VaultEntry[] {
  return result.entries.map((entry) =>
    createEmptyEntry({
      ...entry,
      id: result.kind === 'onepassword' ? `${sourceId}:${entry.id}` : entry.id,
      sourceId,
    }),
  );
}

export function isDirty(entry: StoredEntry): boolean {
  return !entriesEqual(entry.current, entry.original);
}

export function visibleEntries(state: VaultState): StoredEntry[] {
  const scoped =
    state.selectedVaultId === 'all'
      ? state.entries
      : state.entries.filter((entry) => entry.current.sourceId === state.selectedVaultId);

  const query = state.query.trim().toLowerCase();
  if (!query) return scoped;

  return scoped.filter((entry) => {
    const haystack = [
      entry.current.title,
      entry.current.username,
      entry.current.url,
      entry.current.group,
      entry.current.notes,
      entry.current.category,
      entry.current.team,
      ...entry.current.tags,
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  });
}
