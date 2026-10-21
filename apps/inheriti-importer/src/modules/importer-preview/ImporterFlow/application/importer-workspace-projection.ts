import type { ImportSession } from '@modules/import/domain/import-model';
import type { SuggestedAsset } from '@modules/mapping/domain/suggestion';
import type { WorkspaceState } from '@modules/plans/domain/workspace-model';
import { listPlanDrafts } from '@modules/plans/domain/workspace-selectors';
import { validatePlanForExecution } from '@modules/plans/domain/workspace-validation';
import type { AssetReviewStatus } from '../../AssetReviewQueue/types';
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
  automaticCompanion,
  assetMatchesSuggestion,
  plainTextValueWithoutNote,
} from './importer-workspace-suggestions';

// Apply review edits before building the visible asset rows.
export function projectSuggestions(
  session: ImportSession,
  found: SuggestedAsset[],
  mappingOverrides: MappingOverrides,
  plainTextOverrides: PlainTextOverrides,
  plainTextAssetIds: ReadonlySet<string>,
): SuggestedAsset[] {
  return found.map((suggestion) => {
    const structured =
      suggestion.variant === 'additional-fields'
        ? automaticCompanion(session, found, suggestion, mappingOverrides)
        : applyMappingOverrides(suggestion, mappingOverrides);
    const overridden = applyMappingOverrides(structured, mappingOverrides);
    const converted = plainTextAssetIds.has(statusKey(suggestion))
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
  });
}

/** Show accepted suggestions that have not been placed in a plan. */
function projectUnassigned(
  session: ImportSession,
  suggestions: SuggestedAsset[],
  workspace: WorkspaceState,
  decisions: Record<string, AssetReviewStatus>,
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
      valid: true,
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
          valid: !invalidAssetIds.has(asset.id),
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
): ImporterWorkspaceProjection {
  const found = sourceSuggestions(session);
  const suggestions = projectSuggestions(
    session,
    found,
    mappingOverrides,
    plainTextOverrides,
    plainTextAssetIds,
  );
  const assets = projectAssets(session, suggestions, workspace, decisions, plainTextAssetIds);
  const unassigned = projectUnassigned(session, suggestions, workspace, decisions);
  const plans = projectPlans(session, workspace, suggestions);
  return { suggestions, assets, unassigned, plans };
}
