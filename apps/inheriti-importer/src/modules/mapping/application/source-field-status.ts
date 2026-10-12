import type { WorkspaceState } from '@modules/plans/domain/workspace-model';
import type {
  SourceFieldBindingRef,
  SourceFieldStatus,
} from '@modules/mapping/domain/source-field-status';

export function findSourceFieldBindings(
  state: WorkspaceState,
  sourceFieldId: string,
): SourceFieldBindingRef[] {
  const refs: SourceFieldBindingRef[] = [];
  state.planOrder.forEach((clientId) => {
    const plan = state.plansByClientId[clientId];
    if (!plan) return;
    plan.assets.forEach((asset) =>
      Object.entries(asset.fieldBindings).forEach(([assetFieldSource, binding]) => {
        if (binding.kind === 'source' && binding.sourceFieldId === sourceFieldId)
          refs.push({ planClientId: clientId, assetId: asset.id, assetFieldSource });
        if (
          binding.kind === 'sources' &&
          binding.sources.some((source) => source.sourceFieldId === sourceFieldId)
        )
          refs.push({ planClientId: clientId, assetId: asset.id, assetFieldSource });
      }),
    );
  });
  return refs;
}

export function resolveSourceFieldStatus(
  state: WorkspaceState,
  sourceFieldId: string,
  opts: {
    invalidBindingKeys?: ReadonlySet<string>;
    isAssetComplete: (planClientId: string, assetId: string) => boolean;
  },
): SourceFieldStatus {
  if (state.ignoredSourceFieldIds.includes(sourceFieldId)) return 'IGNORED';
  const bindings = findSourceFieldBindings(state, sourceFieldId);
  if (bindings.length === 0) return 'UNMAPPED';
  if (
    opts.invalidBindingKeys &&
    bindings.some((binding) =>
      opts.invalidBindingKeys?.has(
        `${binding.planClientId}:${binding.assetId}:${binding.assetFieldSource}`,
      ),
    )
  )
    return 'INVALID';
  return bindings.every((binding) => opts.isAssetComplete(binding.planClientId, binding.assetId))
    ? 'MAPPED'
    : 'PARTIALLY_MAPPED';
}
