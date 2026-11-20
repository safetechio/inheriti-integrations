import type { ImportSession } from '@modules/import/domain/import-model';
import { additionalFieldsAsset } from '@modules/mapping/application/suggestion-engine';
import { sourceCoverage } from '@modules/mapping/application/source-coverage';
import {
  applyNativeNote,
  nativeNotes,
  projectNoteSources,
  removeSourceBindings,
  type PreservationChoices,
} from './importer-workspace-notes';
import type { SuggestedAsset } from '@modules/mapping/domain/suggestion';
import type { WorkspaceState } from '@modules/plans/domain/workspace-model';
import { listPlanDrafts } from '@modules/plans/domain/workspace-selectors';
import { validatePlanForExecution } from '@modules/plans/domain/workspace-validation';
import { getPlanAssetIconName } from '@modules/plans/domain/asset-metadata';
import {
  hasIncludedSchemaField,
  type AssetReviewStatus,
  type ReviewAsset,
} from '../../AssetReviewQueue/types';
import type { GroupingAsset, PlanDraft as PreviewPlanDraft } from '../../PlanGroupingSurface';
import { projectAssets, reviewStatus } from './importer-workspace-review-projection';
import type {
  ImporterWorkspaceProjection,
  MappingOverrides,
  PlainTextOverrides,
} from './importer-workspace-types';
import {
  statusKey,
  applyMappingOverrides,
  convertToPlainText,
  sourceSuggestions,
  additionalFieldsSuggestion,
  suggestionFields,
  mappedFieldIds,
  assetMatchesSuggestion,
  plainTextValueWithoutNote,
  convertToCanonicalType,
} from './importer-workspace-suggestions';
import type { AssetTypeOverrides } from './importer-workspace-types';

function sourceLocation(session: ImportSession, fromNodeId: string) {
  const node = session.nodesById[fromNodeId];
  return {
    sourceId: node?.sourceId,
    folderPath: node?.path ?? [],
  };
}

// Apply review edits before building the visible asset rows.
export function projectSuggestions(
  session: ImportSession,
  found: SuggestedAsset[],
  mappingOverrides: MappingOverrides,
  plainTextOverrides: PlainTextOverrides,
  plainTextAssetIds: ReadonlySet<string>,
  typeOverrides: AssetTypeOverrides = {},
  choices: PreservationChoices = {},
): SuggestedAsset[] {
  const projectOne = (suggestion: SuggestedAsset): SuggestedAsset => {
    const overridden = applyMappingOverrides(suggestion, mappingOverrides);
    const converted = typeOverrides[statusKey(suggestion)]
      ? convertToCanonicalType(
          session,
          overridden,
          typeOverrides[statusKey(suggestion)],
          found.some(
            (candidate) =>
              candidate.fromNodeId === suggestion.fromNodeId &&
              candidate.variant === 'additional-fields',
          ),
        )
      : plainTextAssetIds.has(statusKey(suggestion))
        ? convertToPlainText(
            session,
            overridden,
            found.some(
              (candidate) =>
                candidate.fromNodeId === suggestion.fromNodeId &&
                candidate.variant === 'additional-fields',
            ),
          )
        : overridden;
    let mapped =
      converted === overridden ? overridden : applyMappingOverrides(converted, mappingOverrides);
    const noteOverride = mappingOverrides[statusKey(converted)];
    if (mapped.type === 'PLAIN-TEXT' && noteOverride && Object.hasOwn(noteOverride, 'meta.notes')) {
      const originalNote = (converted !== overridden ? converted : suggestion).fieldBindings[
        'meta.notes'
      ];
      const valueBinding = plainTextValueWithoutNote(
        session,
        mapped,
        noteOverride['meta.notes'],
        originalNote?.kind === 'source' && originalNote.sourceFieldId !== noteOverride['meta.notes']
          ? originalNote.sourceFieldId
          : undefined,
      );
      const fieldBindings = { ...mapped.fieldBindings };
      if (valueBinding) fieldBindings['secret.text'] = valueBinding;
      else delete fieldBindings['secret.text'];
      mapped = { ...mapped, fieldBindings };
    }
    const value = plainTextOverrides[statusKey(converted)];
    if (converted.type !== 'PLAIN-TEXT' || !value) return mapped;
    return {
      ...mapped,
      fieldBindings: {
        ...mapped.fieldBindings,
        'secret.text': { kind: 'literal' as const, value },
      },
    };
  };
  const ignored = choices.ignored ?? new Set<string>();
  const companions = new Map(
    found.filter((asset) => asset.variant).map((asset) => [asset.fromNodeId, asset]),
  );
  return found
    .filter((asset) => !asset.variant)
    .flatMap((asset) => {
      const rescuedIds = new Set(choices.rescued);
      const primary = removeSourceBindings(
        applyNativeNote(session, removeSourceBindings(projectOne(asset), ignored), choices),
        rescuedIds,
      );
      const node = session.nodesById[asset.fromNodeId];
      const fields = suggestionFields(session, primary);
      const primaryIds = mappedFieldIds(primary);
      const rescueFields = fields.filter(
        (field) =>
          !ignored.has(field.id) && !primaryIds.has(field.id) && choices.rescued?.has(field.id),
      );
      const rescue = rescueFields.length
        ? {
            ...additionalFieldsAsset(session, node, rescueFields),
            variant: 'rescued-fields' as const,
            name: `${node.name} — preserved fields`,
          }
        : undefined;
      const fallback = companions.get(node.id) ?? additionalFieldsAsset(session, node, []);
      const companion = removeSourceBindings(
        projectOne(additionalFieldsSuggestion(session, primary, fallback)),
        new Set([...ignored, ...rescueFields.map((field) => field.id), ...primaryIds]),
      );
      const reservedNote = nativeNotes(session, node.id);
      const metadata = companion.fieldBindings['meta.notes'];
      if (reservedNote && metadata?.kind === 'source' && metadata.sourceFieldId === reservedNote.id)
        delete companion.fieldBindings['meta.notes'];
      const companionId = statusKey(companion);
      const keepCompanion =
        Object.keys(companion.fieldBindings).length ||
        typeOverrides[companionId] ||
        Object.keys(mappingOverrides[companionId] ?? {}).length;
      return [primary, ...(keepCompanion ? [companion] : []), ...(rescue ? [rescue] : [])];
    });
}

/** Show accepted suggestions that have not been placed in a plan. */
function projectUnassigned(
  session: ImportSession,
  suggestions: SuggestedAsset[],
  workspace: WorkspaceState,
  decisions: Record<string, AssetReviewStatus>,
  reviews: ReviewAsset[],
): GroupingAsset[] {
  return suggestions
    .filter(
      (suggestion) =>
        reviewStatus(session, suggestion, workspace, decisions) === 'accepted' &&
        !listPlanDrafts(workspace).some((plan) =>
          plan.assets.some((asset) => assetMatchesSuggestion(session, asset, suggestion)),
        ),
    )
    .map((suggestion): GroupingAsset => ({
      id: statusKey(suggestion),
      name: suggestion.name,
      type: suggestion.type,
      iconName: getPlanAssetIconName(suggestion.type),
      source: session.sources.find(
        (item) => item.id === session.nodesById[suggestion.fromNodeId]?.sourceId,
      )?.fileName,
      ...sourceLocation(session, suggestion.fromNodeId),
      valid: reviews.some(
        (asset) =>
          asset.id === statusKey(suggestion) &&
          asset.status === 'accepted' &&
          hasIncludedSchemaField(asset),
      ),
    }));
}

/** Project plan validity and assigned asset labels for the preview. */
function projectPlans(
  session: ImportSession,
  workspace: WorkspaceState,
  suggestions: SuggestedAsset[],
): PreviewPlanDraft[] {
  return listPlanDrafts(workspace).map((plan): PreviewPlanDraft => {
    const validation = validatePlanForExecution(plan, session);
    const invalidAssetIds = new Set(validation.materialisationErrors.map((error) => error.assetId));
    return {
      id: plan.clientId,
      name: plan.name,
      description: plan.description,
      folderId: plan.folderId,
      sharingModel: plan.governance.sharingModel,
      sourceGroup: plan.sourceGroup,
      sourceName: session.sources.find((source) => source.id === plan.sourceGroup?.sourceId)
        ?.fileName,
      assets: plan.assets.length,
      capacity: `${plan.assets.length} / 10 Assets`,
      valid: validation.valid,
      assignedAssets: plan.assets.map((asset) => {
        const suggestion = suggestions.find((candidate) =>
          assetMatchesSuggestion(session, asset, candidate),
        );
        return {
          id: suggestion ? statusKey(suggestion) : asset.id,
          name: asset.name,
          type: asset.type,
          iconName: getPlanAssetIconName(asset.type),
          source: suggestion
            ? session.sources.find(
                (item) => item.id === session.nodesById[suggestion.fromNodeId]?.sourceId,
              )?.fileName
            : undefined,
          valid: !invalidAssetIds.has(asset.id),
          ...(suggestion ? sourceLocation(session, suggestion.fromNodeId) : {}),
        };
      }),
      governanceHint: validation.issues[0]?.message,
    };
  });
}

/** Build the review and plan preview from the same suggestions. */
export function projectImporterWorkspace(
  session: ImportSession,
  workspace: WorkspaceState,
  decisions: Record<string, AssetReviewStatus> = {},
  mappingOverrides: MappingOverrides = {},
  plainTextOverrides: PlainTextOverrides = {},
  plainTextAssetIds: ReadonlySet<string> = new Set(),
  typeOverrides: AssetTypeOverrides = {},
  choices: PreservationChoices = {},
): ImporterWorkspaceProjection {
  const found = sourceSuggestions(session);
  const ignored = new Set(workspace.ignoredSourceFieldIds);
  choices = { ...choices, ignored };
  const suggestions = projectSuggestions(
    session,
    found,
    mappingOverrides,
    plainTextOverrides,
    plainTextAssetIds,
    typeOverrides,
    choices,
  );
  const assets = projectAssets(
    session,
    suggestions,
    workspace,
    decisions,
    plainTextAssetIds,
    typeOverrides,
    mappingOverrides,
    choices,
  );
  const unassigned = projectUnassigned(session, suggestions, workspace, decisions, assets);
  const plans = projectPlans(session, workspace, suggestions);
  const drafts = listPlanDrafts(workspace).flatMap((plan) => plan.assets);
  const draftIds = new Set(drafts.map((asset) => asset.id));
  const candidateIds = new Set(suggestions.map(statusKey));
  const legacyDrafts = drafts.filter((asset) => !candidateIds.has(asset.id));
  const accepted = new Set(
    assets.filter((asset) => asset.status === 'accepted').map((asset) => asset.id),
  );
  const excluded = new Set(
    assets.filter((asset) => asset.status === 'excluded').map((asset) => asset.id),
  );
  const excludedFields = new Set(ignored);
  for (const suggestion of suggestions) {
    if (!excluded.has(statusKey(suggestion))) continue;
    for (const id of mappedFieldIds(suggestion)) excludedFields.add(id);
  }
  const acceptedDrafts = suggestions
    .filter(
      (asset) =>
        accepted.has(statusKey(asset)) &&
        !draftIds.has(statusKey(asset)) &&
        !legacyDrafts.some((draft) => assetMatchesSuggestion(session, draft, asset)),
    )
    .map((asset) => ({
      id: statusKey(asset),
      type: asset.type,
      name: asset.name,
      fieldBindings: asset.fieldBindings,
    }));
  const executionCoverage = sourceCoverage(session, drafts, excludedFields);
  const coverage = sourceCoverage(session, [...drafts, ...acceptedDrafts], excludedFields);
  const noteSources = projectNoteSources(session, choices);
  const explicitlyExcluded = new Set(
    coverage.fields.filter((field) => field.status === 'excluded').map((field) => field.id),
  );
  const pendingNote = assets.some(
    (asset) =>
      asset.note && !asset.note.explicit && !explicitlyExcluded.has(asset.note.sourceFieldId),
  );
  const actualByField = new Map(executionCoverage.fields.map((field) => [field.id, field]));
  const reviewByField = new Map(coverage.fields.map((field) => [field.id, field]));
  const invalidate = (id: string) => {
    const actual = actualByField.get(id);
    const review = reviewByField.get(id);
    if (actual) actual.status = 'invalid';
    if (review) review.status = 'invalid';
    coverage.ready = false;
    executionCoverage.ready = false;
  };
  for (const asset of assets) {
    const note = asset.note;
    if (!note) continue;
    const field = actualByField.get(note.sourceFieldId);
    if (!field?.destinations.length) continue;
    const expected = note.destination === 'asset-notes' ? 'meta.notes' : 'secret.text';
    if (field.destinations.length !== 1 || field.destinations[0].fieldId !== expected)
      invalidate(field.id);
  }
  for (const id of ignored) {
    if (actualByField.get(id)?.destinations.length) invalidate(id);
  }
  const companionIds = new Set(suggestions.filter((asset) => asset.variant).map(statusKey));
  for (const asset of assets) {
    const omitted = (asset.unmappedSourceFieldIds ?? []).flatMap((id) => {
      const field = reviewByField.get(id);
      return field ? [field] : [];
    });
    const preserved = omitted.filter(
      (field) =>
        (field.status === 'protected' || field.status === 'mapped') &&
        field.destinations.some((destination) => companionIds.has(destination.assetId)),
    );
    if (!preserved.length) continue;
    const preservedIds = new Set(preserved.map((field) => field.id));
    const unresolved = omitted.filter((field) => !preservedIds.has(field.id));
    asset.preservedInCompanion = preserved.map((field) => field.name);
    asset.unmapped = unresolved.map((field) => field.name);
    asset.unmappedSourceFieldIds = unresolved.map((field) => field.id);
  }
  coverage.ready &&= !pendingNote;
  executionCoverage.ready &&= !pendingNote;
  return { suggestions, assets, unassigned, plans, coverage, executionCoverage, noteSources };
}
