export type VaultSourceKind = 'keepass' | 'passbolt' | 'kubernetes' | 'vault' | 'dotenv' | 'cloud';

export type ExtraField = {
  key: string;
  value: string;
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
  tags: string[];
  extraFields: ExtraField[];
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
};

export type ImportSourceStatus = 'imported' | 'warning' | 'unlock-required' | 'retrying' | 'failed';

/** In-memory lifecycle record for one selected file. */
export type ImportSourceRecord = {
  id: string;
  file: OpenedVaultFile;
  status: ImportSourceStatus;
  warnings: string[];
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
    tags: partial.tags ?? [],
    extraFields: partial.extraFields ?? [],
    category: partial.category ?? '',
    team: partial.team ?? '',
  };
}

export function cloneEntry(entry: VaultEntry): VaultEntry {
  return {
    ...entry,
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
    a.category === b.category &&
    a.team === b.team &&
    a.tags.join('\u0000') === b.tags.join('\u0000') &&
    JSON.stringify(a.extraFields) === JSON.stringify(b.extraFields)
  );
}
