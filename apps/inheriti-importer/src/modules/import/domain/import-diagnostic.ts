/** A value-free report about source material affected during import. */
export interface ImportDiagnostic {
  code: string;
  kind: 'unsupported' | 'skipped' | 'transformed';
  message: string;
  count: number;
  entryId?: string;
  sourcePath?: string[];
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
