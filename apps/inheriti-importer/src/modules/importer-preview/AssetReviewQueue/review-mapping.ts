import type { ReviewAsset, ReviewAssetField } from './types';

function candidatesByName(field: ReviewAssetField): Map<string, string> {
  return new Map(field.candidates?.map((candidate) => [candidate.name, candidate.id]));
}

/** Match schema fields and candidate labels, keeping each target's own source IDs. */
export function compatibleMappingUpdates(
  template: ReviewAsset,
  target: ReviewAsset,
): { targetField: string; sourceFieldId: string }[] {
  if (
    template.id === target.id ||
    template.status === 'excluded' ||
    target.status === 'excluded' ||
    !template.sourceId ||
    template.sourceId !== target.sourceId ||
    template.type !== target.type ||
    template.type === 'PLAIN-TEXT' ||
    template.batchMappingSupported === false ||
    target.batchMappingSupported === false ||
    template.plainTextValue ||
    target.plainTextValue ||
    template.plainTextSources ||
    target.plainTextSources ||
    !template.schemaFields?.length ||
    template.schemaFields.length !== target.schemaFields?.length
  )
    return [];

  const updates: { targetField: string; sourceFieldId: string }[] = [];
  const targetFields = new Map(target.schemaFields.map((field) => [field.key, field]));
  if (targetFields.size !== target.schemaFields.length) return [];
  for (const field of template.schemaFields) {
    const targetField = targetFields.get(field.key);
    if (!targetField || field.required !== targetField.required) return [];
    targetFields.delete(field.key);
    const sourceNames = candidatesByName(field);
    const targetNames = candidatesByName(targetField);
    if (
      sourceNames.size !== field.candidates?.length ||
      targetNames.size !== targetField.candidates?.length ||
      sourceNames.size !== targetNames.size ||
      [...sourceNames.keys()].some((name) => !targetNames.has(name))
    )
      return [];
    const name = field.candidates?.find((candidate) => candidate.id === field.sourceFieldId)?.name;
    const sourceFieldId = name === undefined ? undefined : targetNames.get(name);
    if (sourceFieldId && !targetField.manuallyMapped && sourceFieldId !== targetField.sourceFieldId)
      updates.push({ targetField: field.key, sourceFieldId });
  }
  return updates;
}
