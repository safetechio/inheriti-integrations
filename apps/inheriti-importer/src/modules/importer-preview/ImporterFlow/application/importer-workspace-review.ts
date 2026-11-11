import type { ReviewAsset } from '../../AssetReviewQueue/types';
import type { WorkspaceState } from '@modules/plans/domain/workspace-model';
import { getCorePlanAssetTypes } from '@modules/plans/domain/asset-metadata';
import { listPlanDrafts } from '@modules/plans/domain/workspace-selectors';
import {
  bindField,
  createAsset,
  removeAsset,
  unbindField,
} from '@modules/plans/domain/workspace-commands';
import { suggestedAssetToDraft } from '@modules/mapping/application/suggestion-engine';
import { hasIncludedSchemaField } from '../../AssetReviewQueue/types';
import type { ImporterWorkspaceAction } from './importer-workspace-types';
import type { ImporterWorkspaceContext } from './use-importer-workspace';
import {
  assetMatchesSuggestion,
  convertToCanonicalType,
  applyMappingOverrides,
  sourceSuggestions,
  statusKey,
} from './importer-workspace-suggestions';
import { projectSuggestions } from './importer-workspace-projection';

export function createReviewActions(context: ImporterWorkspaceContext) {
  const {
    session,
    projection,
    mappingOverrides,
    plainTextOverrides,
    plainTextAssetIds,
    typeOverrides,
    setMappingOverrides,
    structuredSuggestions,
    setPlainTextAssetIds,
    setPlainTextOverrides,
    setTypeOverrides,
    setDecisions,
    updateWorkspace,
    byId,
  } = context;

  function restoreSuggestion(asset: ReviewAsset, sourceNodeId: string) {
    const originalId = `${sourceNodeId}:${asset.convertedFromType}`;
    const original = structuredSuggestions[originalId];
    if (!original) return;
    setPlainTextAssetIds((current) => {
      const next = new Set(current);
      next.delete(originalId);
      return next;
    });
    setPlainTextOverrides((current) => {
      current[asset.id]?.clear();
      return Object.fromEntries(Object.entries(current).filter(([key]) => key !== asset.id));
    });
    setDecisions((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => key !== asset.id)),
    );
    updateWorkspace((current) => {
      for (const plan of listPlanDrafts(current)) {
        const draft = plan.assets.find((item) => item.id === asset.id);
        if (!draft) continue;
        const removed = removeAsset(current, { planClientId: plan.clientId, assetId: draft.id });
        return createAsset(removed, {
          planClientId: plan.clientId,
          asset: suggestedAssetToDraft(original, originalId),
        });
      }
      return current;
    });
  }

  function excludeAsset(suggestion: NonNullable<ReturnType<typeof byId>>) {
    updateWorkspace((current) => {
      let next = current;
      for (const plan of listPlanDrafts(current)) {
        for (const item of plan.assets) {
          if (assetMatchesSuggestion(session, item, suggestion)) {
            next = removeAsset(next, { planClientId: plan.clientId, assetId: item.id });
          }
        }
      }
      return next;
    });
  }

  function reviewAsset(action: ImporterWorkspaceAction, asset: ReviewAsset) {
    const suggestion = byId(asset.id);
    if (!suggestion) return;
    const original = sourceSuggestions(session).find(
      (item) => item.fromNodeId === suggestion.fromNodeId && item.variant === suggestion.variant,
    );
    const originalId = original ? statusKey(original) : undefined;
    if (action.startsWith('alternate:')) {
      const type = action.slice('alternate:'.length);
      if (
        !original ||
        !originalId ||
        !getCorePlanAssetTypes().includes(
          type as ReturnType<typeof getCorePlanAssetTypes>[number],
        ) ||
        type === suggestion.type
      )
        return;
      const hasCompanion = projection.suggestions.some(
        (candidate) =>
          candidate.fromNodeId === suggestion.fromNodeId &&
          candidate.variant === 'additional-fields',
      );
      const base =
        type === original.type || (type === 'PLAIN-TEXT' && hasCompanion)
          ? applyMappingOverrides(original, mappingOverrides)
          : suggestion;
      const converted =
        type === original.type ? base : convertToCanonicalType(session, base, type, hasCompanion);
      const convertedId = statusKey(converted);
      const carriedBindings =
        suggestion.variant === 'additional-fields' && type === original.type
          ? {}
          : Object.fromEntries(
              Object.entries(converted.fieldBindings).flatMap(([key, binding]) =>
                binding.kind === 'source' ? [[key, binding.sourceFieldId]] : [],
              ),
            );
      const nextMappings = Object.keys(carriedBindings).length
        ? {
            ...mappingOverrides,
            [convertedId]: { ...carriedBindings, ...mappingOverrides[convertedId] },
          }
        : mappingOverrides;
      const nextTypeOverrides =
        type === original.type
          ? Object.fromEntries(Object.entries(typeOverrides).filter(([key]) => key !== originalId))
          : { ...typeOverrides, [originalId]: type };
      const nextPlainTextAssetIds = new Set(plainTextAssetIds);
      nextPlainTextAssetIds.delete(originalId);
      const nextPlainTextOverrides =
        suggestion.type === 'PLAIN-TEXT' && type !== 'PLAIN-TEXT'
          ? Object.fromEntries(
              Object.entries(plainTextOverrides).filter(([key]) => key !== asset.id),
            )
          : plainTextOverrides;
      const effective = projectSuggestions(
        session,
        sourceSuggestions(session),
        nextMappings,
        nextPlainTextOverrides,
        nextPlainTextAssetIds,
        nextTypeOverrides,
      );
      const finalSuggestion = effective.find(
        (candidate) =>
          candidate.fromNodeId === suggestion.fromNodeId &&
          candidate.variant === suggestion.variant,
      );
      if (!finalSuggestion) return;
      const companion = effective.find(
        (candidate) =>
          candidate.fromNodeId === suggestion.fromNodeId &&
          candidate.variant === 'additional-fields',
      );
      const companionId = companion ? statusKey(companion) : undefined;
      const companionBinding = companion?.fieldBindings['secret.text'];
      const syncCompanion = (current: WorkspaceState) => {
        if (
          !companionId ||
          suggestion.variant === 'additional-fields' ||
          plainTextOverrides[companionId] ||
          Object.hasOwn(nextMappings[companionId] ?? {}, 'secret.text')
        )
          return current;
        let next = current;
        for (const plan of listPlanDrafts(current)) {
          if (!plan.assets.some((item) => item.id === companionId)) continue;
          next = companionBinding
            ? bindField(next, {
                planClientId: plan.clientId,
                assetId: companionId,
                assetFieldSource: 'secret.text',
                binding: companionBinding,
              })
            : unbindField(next, {
                planClientId: plan.clientId,
                assetId: companionId,
                assetFieldSource: 'secret.text',
              });
        }
        return next;
      };
      if (nextMappings !== mappingOverrides) setMappingOverrides(nextMappings);
      if (suggestion.type === 'PLAIN-TEXT' && type !== 'PLAIN-TEXT') {
        asset.plainTextValue?.clear();
        setPlainTextOverrides((current) => {
          current[asset.id]?.clear();
          return Object.fromEntries(Object.entries(current).filter(([key]) => key !== asset.id));
        });
      }
      setTypeOverrides(nextTypeOverrides);
      setPlainTextAssetIds(nextPlainTextAssetIds);
      setDecisions((current) => ({
        ...current,
        [asset.id]: 'needs-review',
        [convertedId]: 'needs-review',
      }));
      updateWorkspace((current) => {
        for (const plan of listPlanDrafts(current)) {
          const draft = plan.assets.find((item) =>
            assetMatchesSuggestion(session, item, suggestion),
          );
          if (!draft) continue;
          const removed = removeAsset(current, { planClientId: plan.clientId, assetId: draft.id });
          return syncCompanion(
            createAsset(removed, {
              planClientId: plan.clientId,
              asset: suggestedAssetToDraft(finalSuggestion, convertedId),
            }),
          );
        }
        return syncCompanion(current);
      });
      return;
    }
    if (action === 'restore-suggestion' && asset.convertedFromType) {
      if (originalId && original && suggestion.type !== original.type) {
        reviewAsset(`alternate:${original.type}`, asset);
        return;
      }
      restoreSuggestion(asset, suggestion.fromNodeId);
      return;
    }
    if (action === 'accept' && !hasIncludedSchemaField(asset)) return;
    if (action === 'exclude') excludeAsset(suggestion);
    setDecisions((current) => ({
      ...current,
      [asset.id]: action === 'exclude' ? 'excluded' : 'accepted',
    }));
  }

  return { reviewAsset };
}
