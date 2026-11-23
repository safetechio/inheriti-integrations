import type { ImportDiagnostic } from './import-diagnostic';

export type VaultSourceKind =
  'keepass' | 'passbolt' | 'kubernetes' | 'vault' | 'dotenv' | 'cloud' | 'onepassword';

export type ImportSourceHints = {
  sourceKind?: VaultSourceKind;
  category?: string;
  provider?: 'aws' | 'azure' | 'gcp';
};

export type SourceFieldMetadata = Partial<
  Record<
    | 'sourceKey'
    | 'sourceRole'
    | 'sourceSection'
    | 'sourceSectionIdentity'
    | 'sourceFieldType'
    | 'sourceDesignation'
    | 'sourcePath'
    | 'sourceRecordPath'
    | 'sourceStructuredFieldIndex'
    | 'sourceAutoMapping',
    string
  >
>;

export const canonicalFieldNames = ['username', 'password', 'url', 'notes'] as const;
type CanonicalFieldName = (typeof canonicalFieldNames)[number];

export type ExtraField = {
  key: string;
  value: string;
  metadata?: SourceFieldMetadata;
};

export type VaultEntry = {
  id: string;
  sourceId: string;
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  group: string;
  /** Exact source folder segments, when the parser provides them. */
  groupPath?: string[];
  tags: string[];
  extraFields: ExtraField[];
  sourceHints?: ImportSourceHints;
  fieldMetadata?: Partial<Record<CanonicalFieldName, SourceFieldMetadata>>;
  category: string;
  team: string;
};

export type ImportedVault = {
  id: string;
  name: string;
  kind: VaultSourceKind;
  fileName: string;
  importedAt: string;
  warnings?: string[];
  diagnostics?: ImportDiagnostic[];
};

export type ImportSourceStatus =
  'imported' | 'warning' | 'unlock-required' | 'unlocking' | 'retrying' | 'failed';

/** In-memory lifecycle record for one selected file. */
export type ImportSourceRecord = {
  id: string;
  file: OpenedVaultFile;
  status: ImportSourceStatus;
  warnings: string[];
  diagnostics?: ImportDiagnostic[];
  entries?: number;
  detail?: string;
  vaultId?: string;
};

export type ParseWarning = {
  message: string;
};

export type ParseResult = {
  kind: VaultSourceKind;
  name: string;
  entries: Omit<VaultEntry, 'sourceId'>[];
  warnings: string[];
  diagnostics?: ImportDiagnostic[];
};

export type OpenedVaultFile = {
  name: string;
  path?: string;
  data: ArrayBuffer;
};

export class VaultUnlockError extends Error {
  readonly needsPassword: boolean;
  readonly needsKeyFile: boolean;

  constructor(
    message = 'This database is protected. Enter the master password.',
    options: { needsPassword?: boolean; needsKeyFile?: boolean } = {},
  ) {
    super(message);
    this.name = 'VaultUnlockError';
    this.needsPassword = options.needsPassword ?? true;
    this.needsKeyFile = options.needsKeyFile ?? false;
  }
}

export class VaultFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultFormatError';
  }
}

export function createEmptyEntry(partial: Partial<VaultEntry> = {}): VaultEntry {
  return {
    id: partial.id ?? crypto.randomUUID(),
    sourceId: partial.sourceId ?? '',
    title: partial.title ?? '',
    username: partial.username ?? '',
    password: partial.password ?? '',
    url: partial.url ?? '',
    notes: partial.notes ?? '',
    group: partial.group ?? '',
    ...(partial.groupPath ? { groupPath: [...partial.groupPath] } : {}),
    tags: partial.tags ?? [],
    extraFields: partial.extraFields ?? [],
    ...(partial.sourceHints ? { sourceHints: partial.sourceHints } : {}),
    ...(partial.fieldMetadata ? { fieldMetadata: partial.fieldMetadata } : {}),
    category: partial.category ?? '',
    team: partial.team ?? '',
  };
}

export function cloneEntry(entry: VaultEntry): VaultEntry {
  return {
    ...entry,
    ...(entry.groupPath ? { groupPath: [...entry.groupPath] } : {}),
    tags: [...entry.tags],
    extraFields: entry.extraFields.map((field) => ({ ...field })),
  };
}

export function entriesEqual(a: VaultEntry, b: VaultEntry): boolean {
  return (
    a.title === b.title &&
    a.username === b.username &&
    a.password === b.password &&
    a.url === b.url &&
    a.notes === b.notes &&
    a.group === b.group &&
    JSON.stringify(a.groupPath) === JSON.stringify(b.groupPath) &&
    a.category === b.category &&
    a.team === b.team &&
    a.tags.join('\u0000') === b.tags.join('\u0000') &&
    JSON.stringify(a.extraFields) === JSON.stringify(b.extraFields)
  );
}

/** Escape separators without requiring well-formed Unicode in imported labels. */
export function escapeSourceIdPart(value: string): string {
  return value.replace(/%/g, '%25').replace(/:/g, '%3A');
}

export function sourceFieldId(entryId: string, field: string): string {
  return `${escapeSourceIdPart(entryId)}:${escapeSourceIdPart(field)}`;
}

export function extraFieldIds(entry: Pick<VaultEntry, 'id' | 'extraFields'>): string[] {
  const prefix = sourceFieldId(entry.id, 'extra');
  const occurrences = new Map<string, number>();
  return entry.extraFields.map(({ key, metadata }) => {
    if (metadata?.sourcePath && metadata.sourceStructuredFieldIndex !== undefined) {
      return `${prefix}:structured:${metadata.sourceStructuredFieldIndex}:${escapeSourceIdPart(metadata.sourcePath)}`;
    }
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    const id = `${prefix}:${escapeSourceIdPart(key)}`;
    return occurrence === 1 ? id : `${id}:${occurrence}`;
  });
}

export function entrySourceHints(
  entry: Pick<VaultEntry, 'sourceHints' | 'category'>,
  sourceKind?: VaultSourceKind,
): ImportSourceHints {
  return {
    ...(sourceKind === 'onepassword' && entry.category ? { category: entry.category } : {}),
    ...entry.sourceHints,
    ...(sourceKind ? { sourceKind } : {}),
  };
}

export function canonicalFieldMetadata(
  entry: Pick<VaultEntry, 'fieldMetadata'>,
  name: CanonicalFieldName,
): Record<string, string> {
  return {
    sourceKey: name,
    ...(name === 'notes' ? { role: 'notes' } : {}),
    ...entry.fieldMetadata?.[name],
  };
}
