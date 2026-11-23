import type { SourceCoverageField } from '@modules/mapping/application/source-coverage';
import type { FieldOperationGroup, FieldOperationPreview } from './field-operations';

type Entry = NonNullable<FieldOperationPreview['entries']>[number];
type Field = Pick<SourceCoverageField, 'id' | 'name' | 'nodeId' | 'sourceId'>;
type SkipReason =
  'invalid-template' | 'different-source' | 'edited' | 'missing-field' | 'ambiguous-field';

interface SelectedFieldLayoutInput {
  templateNodeId: string;
  operationId: string;
  entries: readonly Entry[];
  groups: FieldOperationGroup[];
  validGroupIds: Iterable<string>;
  fields: readonly Field[];
  targetNodeIds?: Iterable<string>;
  editedNodeIds?: Iterable<string>;
}

export function applySelectedFieldLayout({
  templateNodeId,
  operationId,
  entries,
  groups,
  validGroupIds,
  fields,
  targetNodeIds,
  editedNodeIds,
}: SelectedFieldLayoutInput) {
  const targetScope = targetNodeIds && new Set(targetNodeIds);
  const edited = new Set(editedNodeIds);
  const validGroups = new Set(validGroupIds);
  const template = entries.find(({ nodeId }) => nodeId === templateNodeId);
  const templateGroups = groups.filter(({ nodeId }) => nodeId === templateNodeId);
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const selectedFields = (entry: Entry) =>
    [...new Set(entry.fieldIds)].flatMap((id) => {
      const field = fieldsById.get(id);
      return field?.nodeId === entry.nodeId && field.sourceId === entry.sourceId ? [field] : [];
    });

  const assignedByGroup = templateGroups.map(({ fieldBindings }) =>
    Object.values(fieldBindings).flat(),
  );
  const assigned = assignedByGroup.flat();
  const templateFields = template ? selectedFields(template) : [];
  const assignedIds = new Set(assigned);
  const validTemplate =
    template &&
    templateGroups.length > 0 &&
    templateGroups.every(({ id }) => validGroups.has(id)) &&
    assignedByGroup.every((ids) => ids.length > 0) &&
    assigned.length === assignedIds.size &&
    assigned.length === template.fieldIds.length &&
    templateFields.length === assigned.length &&
    templateFields.every(({ id }) => assignedIds.has(id)) &&
    new Set(templateFields.map(({ name }) => name)).size === templateFields.length;

  const skipped: { nodeId: string; reason: SkipReason }[] = [];
  const matched = new Map<string, Map<string, string>>();
  for (const entry of entries) {
    const { nodeId } = entry;
    if (nodeId === templateNodeId || (targetScope && !targetScope.has(nodeId))) continue;

    let reason: SkipReason | undefined;
    const bindings = new Map<string, string>();
    if (!validTemplate) reason = 'invalid-template';
    else if (entry.sourceId !== template.sourceId) reason = 'different-source';
    else if (edited.has(nodeId)) reason = 'edited';
    else {
      const selected = selectedFields(entry);
      for (const { id, name } of templateFields) {
        const candidates = selected.filter((field) => field.name === name);
        if (candidates.length !== 1) {
          reason = candidates.length ? 'ambiguous-field' : 'missing-field';
          break;
        }
        bindings.set(id, candidates[0].id);
      }
    }

    if (reason) skipped.push({ nodeId, reason });
    else matched.set(nodeId, bindings);
  }

  const matchedNodeIds = [...matched.keys()];
  if (!matched.size) return { groups, matchedNodeIds, skipped };
  const nextGroups = groups.filter(({ nodeId }) => !matched.has(nodeId));
  const occupiedIds = new Set(nextGroups.map(({ id }) => id));
  for (const [nodeId, bindings] of matched) {
    let suffix = 0;
    for (const { type, fieldBindings } of templateGroups) {
      let id: string;
      do {
        id = `${nodeId}:ASSET-${operationId}-layout-${suffix++}`;
      } while (occupiedIds.has(id));
      occupiedIds.add(id);
      nextGroups.push({
        id,
        nodeId,
        type,
        name: '',
        automaticName: true,
        fieldBindings: Object.fromEntries(
          Object.entries(fieldBindings).map(([key, value]) => [
            key,
            Array.isArray(value)
              ? value.map((fieldId) => bindings.get(fieldId)!)
              : bindings.get(value)!,
          ]),
        ),
      });
    }
  }
  return { groups: nextGroups, matchedNodeIds, skipped };
}
