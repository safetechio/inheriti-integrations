import { getCorePlanAssetTypes } from '@modules/plans/domain/asset-metadata';
import type { ImportSession, ImportedField } from '@modules/import/domain/import-model';
import {
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
  `${suggestion.fromNodeId}:${
    suggestion.variant === 'additional-fields' ? 'PLAIN-TEXT-ADDITIONAL' : suggestion.type
  }`;

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
  const fieldBindings = { ...suggestion.fieldBindings };
  Object.entries(changes).forEach(([target, sourceFieldId]) => {
    if (sourceFieldId) fieldBindings[target] = { kind: 'source', sourceFieldId };
    else delete fieldBindings[target];
  });
  return { ...suggestion, fieldBindings };
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
  const converted = allFieldsAsPlainText(
    session,
    session.nodesById[suggestion.fromNodeId]!,
    hasCompanion ? fields.filter((field) => mappedFieldIds(suggestion).has(field.id)) : fields,
    false,
  );
  const notes = suggestion.fieldBindings['meta.notes'];
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

/** Rebuild the companion from fields left after structured mapping. */
export function additionalFieldsSuggestion(
  session: ImportSession,
  structured: SuggestedAsset,
  companion: SuggestedAsset,
): SuggestedAsset {
  const covered = mappedFieldIds(structured);
  const unmatched = suggestionFields(session, structured).filter((field) => !covered.has(field.id));
  return {
    ...companion,
    fieldBindings: allFieldsAsPlainText(
      session,
      session.nodesById[structured.fromNodeId]!,
      unmatched,
      false,
    ).fieldBindings,
  };
}

/** Build candidate assets from the current import session. */
export function sourceSuggestions(session: ImportSession): SuggestedAsset[] {
  return suggestWithFallback([new FieldAliasSuggestionStrategy()], {
    session,
    nodeIds: session.rootNodeIds,
    knownAssetTypes: new Set(getCorePlanAssetTypes()),
  });
}

const companionNodes = new WeakMap<ImportSession, ReadonlySet<string>>();

/** Build companion identities once for this immutable import session. */
function nodesWithCompanions(session: ImportSession): ReadonlySet<string> {
  const cached = companionNodes.get(session);
  if (cached) return cached;
  const nodes = new Set(
    sourceSuggestions(session)
      .filter((suggestion) => suggestion.variant === 'additional-fields')
      .map((suggestion) => suggestion.fromNodeId),
  );
  companionNodes.set(session, nodes);
  return nodes;
}

/** Recalculate companion text after review mapping changes. */
export function automaticCompanion(
  session: ImportSession,
  suggestions: SuggestedAsset[],
  companion: SuggestedAsset,
  overrides: MappingOverrides,
): SuggestedAsset {
  const structured = suggestions.find(
    (candidate) =>
      candidate.fromNodeId === companion.fromNodeId && candidate.variant !== 'additional-fields',
  )!;
  return additionalFieldsSuggestion(
    session,
    applyMappingOverrides(structured, overrides),
    companion,
  );
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
  const sourceId = session.nodesById[suggestion.fromNodeId]?.sourceId;
  if (session.sources.some((source) => source.id === sourceId && source.kind === 'onepassword'))
    return true;
  return nodesWithCompanions(session).has(suggestion.fromNodeId);
}

/** Match staged assets by stable ID or their bound source fields. */
export function assetMatchesSuggestion(
  session: ImportSession,
  asset: AssetDraft,
  suggestion: SuggestedAsset,
): boolean {
  if (asset.id === statusKey(suggestion)) return true;
  if (requiresExactAssetMatch(session, suggestion)) return false;
  const sourceIds = mappedFieldIds(suggestion);
  if (Object.values(asset.fieldBindings).some((binding) => bindingUsesSource(binding, sourceIds)))
    return true;
  return false;
}
