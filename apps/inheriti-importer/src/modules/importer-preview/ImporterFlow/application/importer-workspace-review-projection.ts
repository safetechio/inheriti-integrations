import {
  getPlanAssetFormFields,
  getImportablePlanAssetTypes,
  validateAssetEditorValues,
} from '@modules/plans/domain/asset-metadata';
import type { ImportSession } from '@modules/import/domain/import-model';
import {
  bindingSourceIds,
  suggestedAssetToDraft,
} from '@modules/mapping/application/suggestion-engine';
import type { SuggestedAsset } from '@modules/mapping/domain/suggestion';
import type { WorkspaceState } from '@modules/plans/domain/workspace-model';
import { listPlanDrafts } from '@modules/plans/domain/workspace-selectors';
import { getAssetTypeDisplayName } from '@modules/_shared/domain/asset-type-display-name';
import { getAssetFieldDisplayName } from '@modules/_shared/domain/asset-field-display-name';
import { materialiseAsset } from '@modules/plans/domain/asset-materializer';
import type { AssetReviewStatus, ReviewAsset } from '../../AssetReviewQueue/types';
import {
  statusKey,
  suggestionFields,
  mappedFieldIds,
  assetMatchesSuggestion,
  sourceSuggestions,
  originalSuggestionFor,
} from './importer-workspace-suggestions';
import { nativeNotes, noteForAsset, type PreservationChoices } from './importer-workspace-notes';
import type {
  AssetTypeOverrides,
  MappingOverrides,
  FieldOrganization,
} from './importer-workspace-types';

/** Include schema and materialisation errors in the review row. */
export function suggestionValidationErrors(
  session: ImportSession,
  suggestion: SuggestedAsset,
): Record<string, string> {
  const draft = suggestedAssetToDraft(suggestion, statusKey(suggestion));
  const materialised = materialiseAsset(draft, session);
  const errors = validateAssetEditorValues(suggestion.type, {
    meta: materialised.asset.meta,
    secret: materialised.asset.secret,
  });
  for (const error of materialised.errors) errors[error.assetFieldSource] = error.message;
  for (const binding of Object.values(draft.fieldBindings)) {
    if (binding.kind === 'literal') binding.value.clear();
  }
  return errors;
}

/** Preserve explicit decisions before inferring status from assignment. */
export function reviewStatus(
  session: ImportSession,
  suggestion: SuggestedAsset,
  workspace: WorkspaceState,
  decisions: Record<string, AssetReviewStatus>,
): AssetReviewStatus {
  const key = statusKey(suggestion);
  if (decisions[key]) return decisions[key];
  const assigned = listPlanDrafts(workspace).some((plan) =>
    plan.assets.some((asset) => assetMatchesSuggestion(session, asset, suggestion)),
  );
  if (assigned) return 'accepted';
  if (suggestion.type === 'PLAIN-TEXT' || suggestion.confidence === 0) return 'fallback';
  return suggestion.confidence >= 0.75 ? 'suggested' : 'needs-review';
}

// Keep review labels and validation aligned with the staged suggestions.
export function projectAssets(
  session: ImportSession,
  suggestions: SuggestedAsset[],
  workspace: WorkspaceState,
  decisions: Record<string, AssetReviewStatus>,
  plainTextAssetIds: ReadonlySet<string>,
  typeOverrides: AssetTypeOverrides = {},
  mappingOverrides: MappingOverrides = {},
  choices: PreservationChoices = {},
  organization?: FieldOrganization,
  originals = sourceSuggestions(session),
): ReviewAsset[] {
  const drafts = listPlanDrafts(workspace).flatMap((plan) => plan.assets);
  const draftsById = new Map(drafts.map((asset) => [asset.id, asset]));
  const suggestionIds = new Set(suggestions.map(statusKey));
  const legacyDrafts = drafts.filter((asset) => !suggestionIds.has(asset.id));
  const companionNodes = new Set(
    suggestions
      .filter(
        (suggestion) =>
          suggestion.variant === 'additional-fields' && draftsById.has(statusKey(suggestion)),
      )
      .map((suggestion) => suggestion.fromNodeId),
  );
  const originalsByNode = new Map<string, SuggestedAsset[]>();
  for (const item of originals) {
    const group = originalsByNode.get(item.fromNodeId) ?? [];
    group.push(item);
    originalsByNode.set(item.fromNodeId, group);
  }
  const mappedById = new Map(suggestions.map((item) => [statusKey(item), mappedFieldIds(item)]));
  const reservedOwners = new Map<string, string>();
  const typedOwners = new Map<string, Set<string>>();
  for (const suggestion of suggestions) {
    const id = statusKey(suggestion);
    for (const fieldId of mappedById.get(id) ?? []) {
      if (suggestion.variant === 'rescued-fields' || organization?.owners[fieldId] === id)
        reservedOwners.set(fieldId, id);
      if (suggestion.type !== 'PLAIN-TEXT') {
        const owners = typedOwners.get(fieldId) ?? new Set<string>();
        owners.add(id);
        typedOwners.set(fieldId, owners);
      }
    }
  }
  const primaryByNode = new Map<string, SuggestedAsset>();
  const derivedIds = new Set<string>();
  for (const item of suggestions) {
    const id = statusKey(item);
    const derived =
      item.variant ||
      (organization?.assets[id] &&
        id !== `${item.fromNodeId}:${item.type}` &&
        !originalSuggestionFor(session, originalsByNode.get(item.fromNodeId) ?? [], item));
    if (derived) derivedIds.add(id);
    if (!derived && !primaryByNode.has(item.fromNodeId)) primaryByNode.set(item.fromNodeId, item);
  }
  const patternKeysByNode = new Map<string, string>();
  return suggestions.map((suggestion): ReviewAsset => {
    const original =
      organization?.assets[statusKey(suggestion)] ??
      originalSuggestionFor(session, originalsByNode.get(suggestion.fromNodeId) ?? [], suggestion);
    const originalId = original ? statusKey(original) : undefined;
    const id = statusKey(suggestion);
    const legacyMatches = legacyDrafts
      .filter((asset) => assetMatchesSuggestion(session, asset, suggestion))
      .map((asset) => asset.id);
    const node = session.nodesById[suggestion.fromNodeId];
    const sourceFileName =
      session.sources.find((source) => source.id === node?.sourceId)?.fileName ?? 'Imported source';
    const folderPath = node?.path ?? [];
    const fields = suggestionFields(session, suggestion);
    let sourcePatternKey = patternKeysByNode.get(suggestion.fromNodeId);
    if (sourcePatternKey === undefined) {
      const hints = node?.sourceHints;
      const fieldSignatures = fields
        .map(({ name, metadata }) =>
          JSON.stringify([
            name,
            metadata.sourceKey ?? '',
            metadata.sourceRole ?? '',
            metadata.sourceSection ?? '',
            metadata.sourceSectionIdentity ?? '',
            metadata.sourceFieldType ?? '',
          ]),
        )
        .sort();
      sourcePatternKey = JSON.stringify([
        hints?.sourceKind,
        hints?.category,
        hints?.provider,
        fieldSignatures,
      ]);
      patternKeysByNode.set(suggestion.fromNodeId, sourcePatternKey);
    }
    const reservedNote = nativeNotes(session, suggestion.fromNodeId);
    const mappedIds = mappedById.get(id) ?? new Set<string>();
    const mapped = fields.filter((field) => mappedIds.has(field.id)).map((field) => field.name);
    const omitted = fields.filter(
      (field) =>
        !field.value.isEmpty && !mappedIds.has(field.id) && !choices.ignored?.has(field.id),
    );
    const unmappedFields = derivedIds.has(id) ? [] : omitted;
    const validationErrors = suggestionValidationErrors(session, suggestion);
    const projectedStatus = reviewStatus(session, suggestion, workspace, decisions);
    const status =
      Object.keys(validationErrors).length > 0 &&
      !['accepted', 'excluded'].includes(projectedStatus)
        ? 'needs-review'
        : projectedStatus;
    const schemaFields = getPlanAssetFormFields(suggestion.type)
      .filter((field) => field.source.startsWith('secret.') || field.source === 'meta.notes')
      .map((field) => {
        const binding = suggestion.fieldBindings[field.source];
        const candidates = fields
          .filter((candidate) => {
            if (choices.ignored?.has(candidate.id)) return false;
            if (candidate.id === reservedNote?.id)
              return (
                field.source !== 'meta.notes' &&
                binding?.kind === 'source' &&
                binding.sourceFieldId === candidate.id
              );
            const owner = reservedOwners.get(candidate.id);
            if (owner && owner !== id) return false;
            const typed = typedOwners.get(candidate.id);
            return !organization?.assets[id] || !typed || (typed.size === 1 && typed.has(id));
          })
          .map((candidate) => ({
            id: candidate.id,
            name: candidate.name,
            length: candidate.value.length,
          }));
        return {
          key: field.source,
          label: getAssetFieldDisplayName(field.source),
          sourceFieldId: binding?.kind === 'source' ? binding.sourceFieldId : undefined,
          sourceFieldName:
            binding?.kind === 'source'
              ? fields.find((item) => item.id === binding.sourceFieldId)?.name
              : undefined,
          candidates,
          validationError: validationErrors[field.source],
          manuallyMapped: Object.hasOwn(mappingOverrides[id] ?? {}, field.source),
        };
      });
    const legacyNoteBinding = draftsById.get(`${suggestion.fromNodeId}:PLAIN-TEXT-ADDITIONAL`)
      ?.fieldBindings['secret.text'];
    const note =
      suggestion !== primaryByNode.get(suggestion.fromNodeId) ||
      mappedById
        .get(organization?.owners[reservedNote?.id ?? ''] ?? '')
        ?.has(reservedNote?.id ?? '')
        ? undefined
        : noteForAsset(
            session,
            suggestion,
            choices,
            Boolean(
              reservedNote &&
              legacyNoteBinding &&
              bindingSourceIds(legacyNoteBinding).includes(reservedNote.id),
            ),
          );
    return {
      id,
      canRemoveDraft:
        organization?.generatedAssetIds?.has(id) && Object.hasOwn(organization.assets, id)
          ? true
          : undefined,
      destinationAssetIds: legacyMatches.length ? [id, ...legacyMatches] : undefined,
      name: suggestion.name,
      type: suggestion.type,
      status,
      suggestionLabel: organization?.assets[id]
        ? getAssetTypeDisplayName(suggestion.type)
        : suggestion.type === 'PLAIN-TEXT'
          ? 'Plain Text fallback'
          : `Suggested ${getAssetTypeDisplayName(suggestion.type)}`,
      rationale: suggestion.rationale,
      mapped,
      unmapped: unmappedFields.map((field) => field.name),
      unmappedSourceFieldIds: unmappedFields.map((field) => field.id),
      note:
        note && status === 'excluded'
          ? {
              ...note,
              publicAllowed: false,
              reason: 'This asset is excluded. Keep its included notes as secret.',
            }
          : note,
      source: sourceFileName,
      sourceId: node?.sourceId,
      sourceNodeId: suggestion.fromNodeId,
      sourcePatternKey,
      suggestionEvidence: suggestion.evidence,
      ownsSourceDiagnostics:
        !derivedIds.has(id) && suggestion === primaryByNode.get(suggestion.fromNodeId),
      sourceFileName,
      folderPath,
      alternatives:
        suggestion.variant === 'rescued-fields'
          ? []
          : getImportablePlanAssetTypes().filter((type) => type !== suggestion.type),
      previewFields: mapped,
      schemaFields,
      batchMappingSupported:
        suggestion.type !== 'PLAIN-TEXT' &&
        !reservedNote &&
        !companionNodes.has(suggestion.fromNodeId) &&
        Object.values(suggestion.fieldBindings).every((binding) => binding.kind === 'source'),
      plainTextEditable: suggestion.variant === 'rescued-fields' ? false : undefined,
      plainTextValue:
        suggestion.fieldBindings['secret.text']?.kind === 'literal'
          ? suggestion.fieldBindings['secret.text'].value
          : undefined,
      plainTextSources:
        suggestion.fieldBindings['secret.text']?.kind === 'sources'
          ? suggestion.fieldBindings['secret.text'].sources.map((source) => ({
              id: source.sourceFieldId,
              name: source.name,
              length: session.fieldsById[source.sourceFieldId]?.value.length,
            }))
          : undefined,
      convertedFromType:
        originalId && typeOverrides[originalId]
          ? original?.type
          : (suggestion.id || suggestion.variant === 'additional-fields'
              ? []
              : [...plainTextAssetIds]
            )
              .find((id) => id.slice(0, id.lastIndexOf(':')) === suggestion.fromNodeId)
              ?.slice(suggestion.fromNodeId.length + 1),
    };
  });
}
