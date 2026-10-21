import type { ReviewAsset } from '../../AssetReviewQueue/types';
import { listPlanDrafts } from '@modules/plans/domain/workspace-selectors';
import { createAsset, removeAsset } from '@modules/plans/domain/workspace-commands';
import { suggestedAssetToDraft } from '@modules/mapping/application/suggestion-engine';
import { hasIncludedSchemaField } from '../../AssetReviewQueue/types';
import type { ImporterWorkspaceAction } from './importer-workspace-types';
import type { ImporterWorkspaceContext } from './use-importer-workspace';
import {
  assetMatchesSuggestion,
  convertToPlainText,
  statusKey,
} from './importer-workspace-suggestions';

export function createReviewActions(context: ImporterWorkspaceContext) {
  const {
    session,
    projection,
    structuredSuggestions,
    setPlainTextAssetIds,
    setPlainTextOverrides,
    setStructuredSuggestions,
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

  function convertAsset(asset: ReviewAsset, suggestion: NonNullable<ReturnType<typeof byId>>) {
    const hasCompanion = projection.suggestions.some(
      (candidate) =>
        candidate.fromNodeId === suggestion.fromNodeId && candidate.variant === 'additional-fields',
    );
    const converted = convertToPlainText(session, suggestion, hasCompanion);
    const convertedId = statusKey(converted);
    setPlainTextAssetIds((current) => new Set(current).add(asset.id));
    setStructuredSuggestions((current) => ({ ...current, [asset.id]: suggestion }));
    setDecisions((current) => ({ ...current, [convertedId]: 'needs-review' }));
    updateWorkspace((current) => {
      for (const plan of listPlanDrafts(current)) {
        const draft = plan.assets.find((item) => assetMatchesSuggestion(session, item, suggestion));
        if (!draft) continue;
        const removed = removeAsset(current, { planClientId: plan.clientId, assetId: draft.id });
        return createAsset(removed, {
          planClientId: plan.clientId,
          asset: suggestedAssetToDraft(converted, convertedId),
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
    if (action === 'restore-suggestion' && asset.convertedFromType) {
      restoreSuggestion(asset, suggestion.fromNodeId);
      return;
    }
    if (action === 'alternate:PLAIN-TEXT' && suggestion.type !== 'PLAIN-TEXT') {
      convertAsset(asset, suggestion);
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
