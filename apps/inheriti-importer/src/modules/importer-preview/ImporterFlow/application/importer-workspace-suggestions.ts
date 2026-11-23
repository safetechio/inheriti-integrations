import { isAutomaticallyMappable } from '@modules/import/domain/structured-extra-fields';
import {
  getImportablePlanAssetTypes,
  getPlanAssetFormFields,
} from '@modules/plans/domain/asset-metadata';
import type { ImportSession, ImportedField } from '@modules/import/domain/import-model';
import {
  additionalFieldsAsset,
  fieldsOf,
  allFieldsAsPlainText,
  suggestWithFallback,
} from '@modules/mapping/application/suggestion-engine';
import { FieldAliasSuggestionStrategy } from '@modules/mapping/application/strategies/field-alias-strategy';
import type { SuggestedAsset, SuggestedFieldBinding } from '@modules/mapping/domain/suggestion';
import type { AssetDraft } from '@modules/plans/domain/workspace-model';
import type { MappingOverrides } from './importer-workspace-types';

/** Keep the additional text asset distinct from its structured sibling. */
export const statusKey = (suggestion: SuggestedAsset) =>
  suggestion.id ??
  `${suggestion.fromNodeId}:${
    suggestion.variant === 'rescued-fields'
      ? 'PLAIN-TEXT-RESCUED'
      : suggestion.variant === 'additional-fields'
        ? 'PLAIN-TEXT-ADDITIONAL'
        : suggestion.type
  }`;

/** Reclassify with only bindings valid in the destination schema; the source fields stay in the session. */
export function convertToCanonicalType(
  session: ImportSession,
  suggestion: SuggestedAsset,
  type: string,
  hasCompanion: boolean,
): SuggestedAsset {
  if (!getImportablePlanAssetTypes().some((candidate) => candidate === type))
    return suggestion;
  if (type === 'PLAIN-TEXT') return convertToPlainText(session, suggestion, hasCompanion);
  const allowed = new Set(getPlanAssetFormFields(type).map((field) => field.source));
  return {
    ...suggestion,
    type,
    confidence: 0,
    evidence: undefined,
    rationale: 'Asset type changed during review. Map and validate its fields before accepting.',
    fieldBindings: Object.fromEntries(
      Object.entries(suggestion.fieldBindings).filter(([field]) => allowed.has(field)),
    ),
  };
}

/** Read only fields belonging to this suggestion's source node. */
export function suggestionFields(
  session: ImportSession,
  suggestion: SuggestedAsset,
): ImportedField[] {
  const node = session.nodesById[suggestion.fromNodeId];
  return node ? fieldsOf(session, node) : [];
}

/** Apply review bindings without mutating the original suggestion. */
export function applyMappingOverrides(
  suggestion: SuggestedAsset,
  overrides: MappingOverrides,
): SuggestedAsset {
  const changes = overrides[statusKey(suggestion)];
  if (!changes) return suggestion;
  let fieldBindings: SuggestedAsset['fieldBindings'] | undefined;
  for (const [target, sourceFieldId] of Object.entries(changes)) {
    const existing = suggestion.fieldBindings[target];
    if (
      sourceFieldId
        ? existing?.kind === 'source' && existing.sourceFieldId === sourceFieldId
        : !existing
    )
      continue;
    fieldBindings ??= { ...suggestion.fieldBindings };
    if (sourceFieldId) fieldBindings[target] = { kind: 'source', sourceFieldId };
    else delete fieldBindings[target];
  }
  return fieldBindings ? { ...suggestion, fieldBindings, evidence: undefined } : suggestion;
}

/** Find fields already represented by a suggestion's bindings. */
export function mappedFieldIds(suggestion: SuggestedAsset): Set<string> {
  return new Set(
    Object.values(suggestion.fieldBindings).flatMap((binding) =>
      binding.kind === 'source'
        ? [binding.sourceFieldId]
        : binding.kind === 'sources'
          ? binding.sources.map((source) => source.sourceFieldId)
          : [],
    ),
  );
}

/** Keep source-based Plain Text separate from a note mapping. */
export function plainTextValueWithoutNote(
  session: ImportSession,
  suggestion: SuggestedAsset,
  noteSourceFieldId?: string,
  restoredSourceFieldId?: string,
): SuggestedAsset['fieldBindings'][string] | undefined {
  const binding = suggestion.fieldBindings['secret.text'];
  if (binding?.kind === 'literal') return binding;
  const ids =
    binding?.kind === 'sources'
      ? binding.sources.map((source) => source.sourceFieldId)
      : binding?.kind === 'source'
        ? [binding.sourceFieldId]
        : [];
  if (restoredSourceFieldId && !ids.includes(restoredSourceFieldId))
    ids.push(restoredSourceFieldId);
  const fields = suggestionFields(session, suggestion).filter(
    (field) => ids.includes(field.id) && field.id !== noteSourceFieldId,
  );
  return allFieldsAsPlainText(session, session.nodesById[suggestion.fromNodeId]!, fields, false)
    .fieldBindings['secret.text'];
}

/** Keep the companion's unmatched fields out of a converted asset. */
export function convertToPlainText(
  session: ImportSession,
  suggestion: SuggestedAsset,
  hasCompanion: boolean,
): SuggestedAsset {
  const fields = suggestionFields(session, suggestion);
  const mappedIds = mappedFieldIds(suggestion);
  const canIncludeNewFields = !hasCompanion && suggestion.type === 'PLAIN-TEXT';
  const converted = allFieldsAsPlainText(
    session,
    session.nodesById[suggestion.fromNodeId]!,
    fields.filter((field) => mappedIds.has(field.id) || (canIncludeNewFields && isAutomaticallyMappable(field))),
    false,
  );
  const notes = suggestion.fieldBindings['meta.notes'];
  converted.id = suggestion.id;
  converted.name = suggestion.name;
  if (suggestion.variant) converted.variant = suggestion.variant;
  if (!notes) return converted;
  const text = plainTextValueWithoutNote(
    session,
    converted,
    notes.kind === 'source' ? notes.sourceFieldId : undefined,
  );
  const fieldBindings: Record<string, SuggestedFieldBinding> = {
    ...converted.fieldBindings,
    'meta.notes': notes,
  };
  if (text) fieldBindings['secret.text'] = text;
  else delete fieldBindings['secret.text'];
  return { ...converted, fieldBindings };
}

/** Build candidate assets from the current import session. */
export function sourceSuggestions(session: ImportSession): SuggestedAsset[] {
  return suggestWithFallback([new FieldAliasSuggestionStrategy()], {
    session,
    nodeIds: session.rootNodeIds,
    knownAssetTypes: new Set(getImportablePlanAssetTypes()),
  });
}

export function originalSuggestionFor(
  session: ImportSession,
  originals: SuggestedAsset[],
  suggestion: SuggestedAsset,
): SuggestedAsset | undefined {
  if (suggestion.id) return originals.find((item) => item.id === suggestion.id);
  const original = originals.find(
    (item) =>
      !item.id && item.fromNodeId === suggestion.fromNodeId && item.variant === suggestion.variant,
  );
  if (original || suggestion.variant !== 'additional-fields') return original;
  const node = session.nodesById[suggestion.fromNodeId];
  return node ? additionalFieldsAsset(session, node, []) : undefined;
}

/** Match both single-source and composite field bindings. */
export function bindingUsesSource(
  binding: AssetDraft['fieldBindings'][string],
  sourceIds: Set<string>,
) {
  if (binding.kind === 'source') return sourceIds.has(binding.sourceFieldId);
  return (
    binding.kind === 'sources' &&
    binding.sources.some((source) => sourceIds.has(source.sourceFieldId))
  );
}

/** Multiple assets from one entry must be matched by their distinct IDs. */
export function requiresExactAssetMatch(
  session: ImportSession,
  suggestion: SuggestedAsset,
): boolean {
  if (suggestion.id || suggestion.variant) return true;
  const sourceId = session.nodesById[suggestion.fromNodeId]?.sourceId;
  if (session.sources.some((source) => source.id === sourceId && source.kind === 'onepassword'))
    return true;
  return false;
}

/** Match staged assets by stable ID or their bound source fields. */
export function assetMatchesSuggestion(
  session: ImportSession,
  asset: AssetDraft,
  suggestion: SuggestedAsset,
): boolean {
  if (asset.id === statusKey(suggestion)) return true;
  if (
    asset.id.startsWith(`${suggestion.fromNodeId}:`) ||
    requiresExactAssetMatch(session, suggestion)
  )
    return false;
  const sourceIds = mappedFieldIds(suggestion);
  if (Object.values(asset.fieldBindings).some((binding) => bindingUsesSource(binding, sourceIds)))
    return true;
  return false;
}
