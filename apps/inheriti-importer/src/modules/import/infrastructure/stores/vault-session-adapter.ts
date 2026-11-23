import { expandStructuredExtraFields } from '@modules/import/domain/structured-extra-fields';
import {
  canonicalFieldMetadata,
  canonicalFieldNames,
  entrySourceHints,
  extraFieldIds,
  sourceFieldId,
} from '@modules/import/domain/vault';
import {
  SensitiveValue,
  type ImportedField,
  type ImportSession,
} from '@modules/import/domain/import-model';
import type { VaultState } from './vault-store';

/**
 * Bridges the current importer store to the normalized session consumed by
 * plan materialization. Field ids intentionally match MappingWorkspace's
 * stable `entryId:field` ids, so a binding is resolvable at execution time.
 */
export function importSessionFromVaultState(state: VaultState): ImportSession {
  const session: ImportSession = {
    id: 'import-session',
    sources: state.vaults.map((vault) => ({
      id: vault.id,
      kind: vault.kind,
      name: vault.name,
      fileName: vault.fileName,
      importedAt: vault.importedAt,
      warnings: vault.warnings ? [...vault.warnings] : [],
      diagnostics: vault.diagnostics,
    })),
    rootNodeIds: [],
    nodesById: {},
    fieldsById: {},
  };

  for (const stored of state.entries) {
    const entry = stored.current;
    const sourceKind = state.vaults.find((vault) => vault.id === entry.sourceId)?.kind;
    // shortcut: old KeePass entries lack exact segments, remove this split after legacy state is retired.
    const path = entry.groupPath
      ? [...entry.groupPath]
      : entry.group
        ? sourceKind === 'keepass'
          ? entry.group.split(' / ')
          : [entry.group]
        : [];
    const fieldIds = canonicalFieldNames
      .filter((name) => entry[name])
      .map((name) =>
        addField(
          session,
          entry.id,
          entry.sourceId,
          name,
          entry[name],
          canonicalFieldMetadata(entry, name),
        ),
      );
    const extraFields = expandStructuredExtraFields(entry.extraFields);
    const extraIds = extraFieldIds({ id: entry.id, extraFields });
    extraFields.forEach(({ key, value, metadata }, index) => {
      if (value)
        fieldIds.push(
          addField(
            session,
            entry.id,
            entry.sourceId,
            `extra:${key}`,
            value,
            { sourceKey: key, ...metadata },
            extraIds[index],
          ),
        );
    });
    session.nodesById[entry.id] = {
      id: entry.id,
      sourceId: entry.sourceId,
      parentNodeId: null,
      kind: 'entry',
      name: entry.title || 'Untitled entry',
      path,
      childNodeIds: [],
      fieldIds,
      sourceHints: entrySourceHints(entry, sourceKind),
    };
    session.rootNodeIds.push(entry.id);
  }

  return session;
}

function addField(
  session: ImportSession,
  entryId: string,
  sourceId: string,
  fieldName: string,
  value: string,
  metadata: ImportedField['metadata'],
  id = sourceFieldId(entryId, fieldName),
): string {
  session.fieldsById[id] = {
    id,
    sourceId,
    parentNodeId: entryId,
    sourcePath: [entryId, fieldName],
    name: fieldName,
    value: new SensitiveValue(value),
    metadata,
  };
  return id;
}
