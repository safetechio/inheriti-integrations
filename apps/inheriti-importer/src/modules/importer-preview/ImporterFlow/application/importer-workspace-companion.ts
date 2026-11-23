import { suggestedAssetToDraft } from '@modules/mapping/application/suggestion-engine';
import { bindField, unbindField } from '@modules/plans/domain/workspace-commands';
import { listPlanDrafts } from '@modules/plans/domain/workspace-selectors';
import type { WorkspaceState } from '@modules/plans/domain/workspace-model';
import type { ImporterWorkspaceContext } from './use-importer-workspace';
import type { MappingOverrides, PlainTextOverrides } from './importer-workspace-types';
import {
  assetMatchesSuggestion,
  sourceSuggestions,
  statusKey,
} from './importer-workspace-suggestions';
import { projectSuggestions } from './importer-workspace-projection';

export function reconcileEditedBindings(
  context: ImporterWorkspaceContext,
  workspace: WorkspaceState,
  nodeId: string,
  targetAssetId: string,
  targetField: string,
  mappingOverrides: MappingOverrides,
  plainTextOverrides: PlainTextOverrides,
): WorkspaceState {
  const { session, projection, typeOverrides, plainTextAssetIds, preservation } = context;
  const previous = projection.suggestions.filter((asset) => asset.fromNodeId === nodeId);
  const projected = projectSuggestions(
    session,
    (context.sourceOriginals ?? sourceSuggestions(session)).filter(
      (asset) => asset.fromNodeId === nodeId,
    ),
    mappingOverrides,
    plainTextOverrides,
    plainTextAssetIds,
    typeOverrides,
    preservation,
    {
      ...context.organization,
      assets: Object.fromEntries(
        Object.entries(context.organization.assets).filter(
          ([, asset]) => asset.fromNodeId === nodeId,
        ),
      ),
    },
    workspace,
  );
  const nextById = new Map(projected.map((asset) => [statusKey(asset), asset]));
  let next = workspace;
  for (const plan of listPlanDrafts(workspace)) {
    for (const draft of plan.assets) {
      const original = previous.find((asset) => assetMatchesSuggestion(session, draft, asset));
      if (!original) continue;
      const reviewId = statusKey(original);
      const revised = nextById.get(reviewId);
      const bindings = revised?.fieldBindings ?? {};
      const keys = new Set([...Object.keys(original.fieldBindings), ...Object.keys(bindings)]);
      const changed = [...keys].filter(
        (key) =>
          (reviewId === targetAssetId && key === targetField) ||
          JSON.stringify(
            original.fieldBindings[key]?.kind === 'literal'
              ? { kind: 'literal' }
              : original.fieldBindings[key],
          ) !==
            JSON.stringify(bindings[key]?.kind === 'literal' ? { kind: 'literal' } : bindings[key]),
      );
      if (!changed.length) continue;
      const copied = revised ? suggestedAssetToDraft(revised, draft.id).fieldBindings : {};
      for (const assetFieldSource of changed) {
        const location = { planClientId: plan.clientId, assetId: draft.id, assetFieldSource };
        const binding = copied[assetFieldSource];
        const oldBinding = draft.fieldBindings[assetFieldSource];
        if (oldBinding?.kind === 'literal') oldBinding.value.clear();
        if (binding) next = bindField(next, { ...location, binding });
        else next = unbindField(next, location);
      }
      for (const [key, binding] of Object.entries(copied)) {
        if (!changed.includes(key) && binding.kind === 'literal') binding.value.clear();
      }
    }
  }
  return next;
}
