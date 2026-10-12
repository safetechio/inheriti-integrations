import { SensitiveValue, type ImportSession } from '@modules/import/domain/import-model';
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
    })),
    rootNodeIds: [],
    nodesById: {},
    fieldsById: {},
  };

  for (const stored of state.entries) {
    const entry = stored.current;
    const fields = [
      ['username', entry.username],
      ['password', entry.password],
      ['url', entry.url],
      ['notes', entry.notes],
      ...entry.extraFields.map((field) => [`extra:${field.key}`, field.value]),
    ];
    const fieldIds = fields
      .filter(([, value]) => value)
      .map(([name, value]) => addField(session, entry.id, entry.sourceId, name, value));
    session.nodesById[entry.id] = {
      id: entry.id,
      sourceId: entry.sourceId,
      parentNodeId: null,
      kind: 'entry',
      name: entry.title || 'Untitled entry',
      path: entry.group ? [entry.group] : [],
      childNodeIds: [],
      fieldIds,
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
): string {
  const id = `${entryId}:${fieldName}`;
  session.fieldsById[id] = {
    id,
    sourceId,
    parentNodeId: entryId,
    sourcePath: [entryId, fieldName],
    name: fieldName,
    value: new SensitiveValue(value),
    metadata: {},
  };
  return id;
}
