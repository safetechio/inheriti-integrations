/** A value-free report about source material affected during import. */
export interface ImportDiagnostic {
  code: string;
  kind: 'unsupported' | 'skipped' | 'transformed';
  message: string;
  count: number;
  entryId?: string;
  entryName?: string;
  sourcePath?: string[];
}

const sourceMetadataCodes = new Set([
  'onepassword-container-metadata',
  'onepassword-item-metadata',
  'onepassword-login-settings',
  'onepassword-url-metadata',
  'onepassword-field-settings',
  'passbolt-resource-metadata',
]);

/** Keep source configuration omissions distinct from unsupported credential content. */
export function importDiagnosticCategory(diagnostic: Pick<ImportDiagnostic, 'code' | 'kind'>) {
  return diagnostic.kind === 'skipped' && sourceMetadataCodes.has(diagnostic.code)
    ? 'metadata'
    : diagnostic.kind;
}

export type ImportDiagnosticGroup = Pick<
  ImportDiagnostic,
  'code' | 'kind' | 'message' | 'count'
> & {
  occurrences: ImportDiagnostic[];
};

export function groupImportDiagnostics(diagnostics: readonly ImportDiagnostic[] = []) {
  const groups = new Map<string, ImportDiagnosticGroup>();
  for (const diagnostic of diagnostics) {
    const { code, kind, message, count } = diagnostic;
    const key = JSON.stringify([code, kind, message]);
    const previous = groups.get(key);
    if (previous) {
      previous.count += count;
      previous.occurrences.push(diagnostic);
    } else {
      groups.set(key, { code, kind, message, count, occurrences: [diagnostic] });
    }
  }
  return [...groups.entries()];
}

export function resolveEntryDiagnostics(
  diagnostics: ImportDiagnostic[] | undefined,
  entries: readonly { id: string }[],
  normalizedEntryIds: readonly string[],
): ImportDiagnostic[] | undefined {
  const ids = new Map<string, string | undefined>();
  let duplicates = 0;
  entries.forEach(({ id }, index) => {
    if (ids.has(id)) {
      ids.set(id, undefined);
      duplicates++;
    } else {
      ids.set(id, normalizedEntryIds[index]);
    }
  });

  if (!diagnostics?.length && !duplicates) return diagnostics;
  const resolved = (diagnostics ?? []).map(({ entryId, ...diagnostic }) => {
    const normalizedId = entryId === undefined ? undefined : ids.get(entryId);
    return normalizedId ? { ...diagnostic, entryId: normalizedId } : diagnostic;
  });
  if (duplicates) {
    resolved.push({
      code: 'duplicate-source-entry-id',
      kind: 'transformed',
      message: 'Entries with repeated source identifiers were kept as separate entries.',
      count: duplicates,
    });
  }
  return resolved;
}
