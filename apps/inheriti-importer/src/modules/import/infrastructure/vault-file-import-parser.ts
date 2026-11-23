import { expandStructuredExtraFields } from '@modules/import/domain/structured-extra-fields';
import { resolveEntryDiagnostics } from '@modules/import/domain/import-diagnostic';
import { parseVaultFile } from '@modules/import/infrastructure/parsers';
import { detectVaultKind } from '@modules/import/infrastructure/parsers/utils/detect';
import {
  canonicalFieldMetadata,
  canonicalFieldNames,
  entrySourceHints,
  type ParseResult,
  type VaultEntry,
} from '@modules/import/domain/vault';
import {
  SensitiveValue,
  type ImportedField,
  type ImportedNode,
  type ImportedSource,
} from '@modules/import/domain/import-model';
import type {
  ImportParseInput,
  ImportParser,
  ParsedImportSource,
} from '@modules/import/domain/import-parser';

/** Maps parsed vault entries into the normalized import tree. */
export class VaultFileImportParser implements ImportParser {
  canParse(fileName: string, data: ArrayBuffer): boolean {
    try {
      detectVaultKind(fileName, data);
      return true;
    } catch {
      return false;
    }
  }

  async parse(input: ImportParseInput): Promise<ParsedImportSource> {
    const result: ParseResult = await parseVaultFile(
      input.data,
      input.fileName,
      input.secrets ?? {},
    );

    const sourceId = crypto.randomUUID();
    const source: ImportedSource = {
      id: sourceId,
      kind: result.kind,
      name: result.name,
      fileName: input.fileName,
      importedAt: new Date().toISOString(),
      warnings: [...result.warnings],
    };

    const nodes: ImportedNode[] = [];
    const fields: ImportedField[] = [];
    const groupNodeByPath = new Map<string, ImportedNode>();

    const rootGroup: ImportedNode = {
      id: crypto.randomUUID(),
      sourceId,
      parentNodeId: null,
      kind: 'group',
      name: result.name,
      path: [],
      childNodeIds: [],
      fieldIds: [],
    };
    nodes.push(rootGroup);
    groupNodeByPath.set('', rootGroup);

    const ensureGroup = (groupPath: string[]): ImportedNode => {
      const key = groupPath.join('\u0000');
      const existing = groupNodeByPath.get(key);
      if (existing) return existing;

      const parent = ensureGroup(groupPath.slice(0, -1));
      const node: ImportedNode = {
        id: crypto.randomUUID(),
        sourceId,
        parentNodeId: parent.id,
        kind: 'group',
        name: groupPath[groupPath.length - 1] ?? '',
        path: groupPath,
        childNodeIds: [],
        fieldIds: [],
      };
      parent.childNodeIds.push(node.id);
      nodes.push(node);
      groupNodeByPath.set(key, node);
      return node;
    };

    const entryNodeIds: string[] = [];
    for (const entry of result.entries) {
      const groupPath = entry.groupPath ?? (entry.group ? [entry.group] : []);
      const group = groupPath.length ? ensureGroup(groupPath) : rootGroup;

      const entryNode: ImportedNode = {
        id: crypto.randomUUID(),
        sourceId,
        parentNodeId: group.id,
        kind: 'entry',
        name: entry.title || entry.username || '(untitled)',
        path: [...group.path, entry.title || entry.username || '(untitled)'],
        childNodeIds: [],
        fieldIds: [],
        sourceHints: entrySourceHints(entry, result.kind),
      };
      group.childNodeIds.push(entryNode.id);
      nodes.push(entryNode);
      entryNodeIds.push(entryNode.id);

      for (const field of buildEntryFields(entry, sourceId, entryNode)) {
        entryNode.fieldIds.push(field.id);
        fields.push(field);
      }
    }

    source.diagnostics = resolveEntryDiagnostics(result.diagnostics, result.entries, entryNodeIds);
    return { source, nodes, fields };
  }
}

function buildEntryFields(
  entry: Omit<VaultEntry, 'sourceId'>,
  sourceId: string,
  entryNode: ImportedNode,
): ImportedField[] {
  const out: ImportedField[] = [];

  const push = (
    name: string,
    rawValue: string,
    metadata: ImportedField['metadata'],
    detectedType?: string,
  ) => {
    if (!rawValue) return;
    out.push({
      id: crypto.randomUUID(),
      sourceId,
      parentNodeId: entryNode.id,
      sourcePath: [...entryNode.path, name],
      name,
      value: new SensitiveValue(rawValue),
      detectedType,
      metadata,
    });
  };

  for (const name of canonicalFieldNames) {
    push(
      name,
      entry[name],
      canonicalFieldMetadata(entry, name),
      name === 'notes' ? 'PLAIN-TEXT' : 'USER-PSWD',
    );
  }

  for (const extra of expandStructuredExtraFields(entry.extraFields)) {
    push(`extra:${extra.key}`, extra.value, { sourceKey: extra.key, ...extra.metadata });
  }

  return out;
}
