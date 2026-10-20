import { suggestedAssetToDraft } from '@modules/mapping/application/suggestion-engine';
import type { SuggestedAsset } from '@modules/mapping/domain/suggestion';
import { bindField, unbindField } from '@modules/plans/domain/workspace-commands';
import { listPlanDrafts } from '@modules/plans/domain/workspace-selectors';
import type { WorkspaceState } from '@modules/plans/domain/workspace-model';
import type { ImporterWorkspaceContext } from './use-importer-workspace';
import { additionalFieldsSuggestion, statusKey } from './importer-workspace-suggestions';

export function reconcileCompanion(
  context: ImporterWorkspaceContext,
  current: WorkspaceState,
  suggestion: SuggestedAsset,
  targetField: string,
  sourceFieldId?: string,
): WorkspaceState | undefined {
  const { session, projection, mappingOverrides, plainTextOverrides } = context;
  // Keep the companion's text limited to fields left out of the structured asset.
  const companion = projection.suggestions.find(
    (candidate) =>
      candidate.fromNodeId === suggestion.fromNodeId && candidate.variant === 'additional-fields',
  );
  if (!companion || suggestion.type === 'PLAIN-TEXT') return undefined;
  const updated = { ...suggestion, fieldBindings: { ...suggestion.fieldBindings } };
  if (sourceFieldId) updated.fieldBindings[targetField] = { kind: 'source', sourceFieldId };
  else delete updated.fieldBindings[targetField];
  const nextCompanion = additionalFieldsSuggestion(session, updated, companion);
  const companionBinding = suggestedAssetToDraft(nextCompanion, statusKey(companion)).fieldBindings[
    'secret.text'
  ];
  let next = current;
  for (const plan of listPlanDrafts(current)) {
    if (plan.assets.some((item) => item.id === statusKey(suggestion))) {
      next = sourceFieldId
        ? bindField(next, {
            planClientId: plan.clientId,
            assetId: statusKey(suggestion),
            assetFieldSource: targetField,
            binding: { kind: 'source', sourceFieldId },
          })
        : unbindField(next, {
            planClientId: plan.clientId,
            assetId: statusKey(suggestion),
            assetFieldSource: targetField,
          });
    }
    if (!plan.assets.some((item) => item.id === statusKey(companion))) continue;
    if (
      plainTextOverrides[statusKey(companion)] ||
      Object.hasOwn(mappingOverrides[statusKey(companion)] ?? {}, 'secret.text')
    )
      continue;
    next = companionBinding
      ? bindField(next, {
          planClientId: plan.clientId,
          assetId: statusKey(companion),
          assetFieldSource: 'secret.text',
          binding: companionBinding,
        })
      : unbindField(next, {
          planClientId: plan.clientId,
          assetId: statusKey(companion),
          assetFieldSource: 'secret.text',
        });
  }
  return next;
}
