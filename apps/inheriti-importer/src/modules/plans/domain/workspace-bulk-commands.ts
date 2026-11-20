import type { AssetDraft, WorkspaceState } from './workspace-model';
import { createPlan, removePlan } from './workspace-commands';

export interface BulkAssetSelection {
  id: string;
  accepted: boolean;
  draft: AssetDraft;
  matches: (asset: AssetDraft) => boolean;
}

/** Create a destination for each group of ten accepted assets. */
export function createPlansFromAssets(
  state: WorkspaceState,
  selections: BulkAssetSelection[],
  ids: string[],
  options: { name: string; folderId: string | null; scope: 'SHARED' | 'PERSONAL' },
): WorkspaceState {
  const matches = selections.map((item) =>
    Object.values(state.plansByClientId).flatMap((plan) => plan.assets.filter(item.matches)),
  );
  if (
    !options.name.trim() ||
    !selections.length ||
    selections.some((item) => !item.accepted) ||
    new Set(selections.map((item) => item.id)).size !== selections.length ||
    new Set(selections.map((item) => item.draft.id)).size !== selections.length ||
    ids.length !== Math.ceil(selections.length / 10) ||
    ids.some((id) => state.plansByClientId[id]) ||
    new Set(ids).size !== ids.length ||
    matches.some((items) => items.length > 1) ||
    new Set(matches.map((items, index) => (items[0] ?? selections[index].draft).id)).size !==
      selections.length
  )
    return state;
  let result = state;
  const initial = state.planOrder.length === 1 ? state.plansByClientId[state.planOrder[0]!] : undefined;
  if (initial?.placeholder && !initial.assets.length) result = removePlan(result, { clientId: initial.clientId });
  const previousOrder = result.planOrder;
  const name = options.name.trim();
  for (let index = 0; index < ids.length; index++) {
    const id = ids[index];
    result = createPlan(result, {
      clientId: id,
      name: ids.length === 1 ? name : `${name} ${index + 1}`,
      folderId: options.folderId,
      scope: options.scope,
    });
    result = assignAssetsToPlan(result, id, selections.slice(index * 10, (index + 1) * 10), 10);
  }
  return { ...result, planOrder: [...ids, ...previousOrder], revision: state.revision + 1 };
}

/** Apply the whole selection against one current workspace snapshot. */
export function assignAssetsToPlan(
  state: WorkspaceState,
  targetId: string,
  selections: BulkAssetSelection[],
  capacity: number,
): WorkspaceState {
  const target = state.plansByClientId[targetId];
  if (!target || !selections.length || selections.some((item) => !item.accepted)) return state;
  const unique = [...new Map(selections.map((item) => [item.id, item])).values()];
  const resolved = unique.map((item) => {
    const matches = Object.entries(state.plansByClientId).flatMap(([planId, plan]) =>
      plan.assets.filter(item.matches).map((asset) => ({ planId, asset })),
    );
    return { item, matches, asset: matches[0]?.asset ?? item.draft };
  });
  if (
    resolved.some(({ matches }) => matches.length > 1) ||
    new Set(resolved.map(({ asset }) => asset.id)).size !== resolved.length
  )
    return state;
  const moving = resolved.filter(({ matches }) => matches[0]?.planId !== targetId);
  if (!moving.length || target.assets.length + moving.length > capacity) return state;
  const movedIds = new Set(moving.flatMap(({ matches }) => matches.map(({ asset }) => asset.id)));
  const plansByClientId = { ...state.plansByClientId };
  for (const [planId, plan] of Object.entries(plansByClientId)) {
    if (planId !== targetId && plan.assets.some((asset) => movedIds.has(asset.id)))
      plansByClientId[planId] = {
        ...plan,
        assets: plan.assets.filter((asset) => !movedIds.has(asset.id)),
      };
  }
  plansByClientId[targetId] = {
    ...target,
    placeholder: undefined,
    assets: [...target.assets, ...moving.map(({ asset }) => asset)],
  };
  return { ...state, plansByClientId, revision: state.revision + 1 };
}

export function unassignAssetsFromPlans(
  state: WorkspaceState,
  selections: Pick<BulkAssetSelection, 'id' | 'matches'>[],
): WorkspaceState {
  if (!selections.length) return state;
  const unique = [...new Map(selections.map((item) => [item.id, item])).values()];
  const matches = unique.map((item) =>
    Object.values(state.plansByClientId).flatMap((plan) => plan.assets.filter(item.matches)),
  );
  if (matches.some((items) => items.length !== 1)) return state;
  const ids = new Set(matches.flat().map((asset) => asset.id));
  const plansByClientId = { ...state.plansByClientId };
  for (const [planId, plan] of Object.entries(plansByClientId)) {
    if (plan.assets.some((asset) => ids.has(asset.id)))
      plansByClientId[planId] = {
        ...plan,
        assets: plan.assets.filter((asset) => !ids.has(asset.id)),
      };
  }
  return { ...state, plansByClientId, revision: state.revision + 1 };
}
