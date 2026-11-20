import { makePlanDraft, type AssetDraft, type WorkspaceState } from './workspace-model';

export interface AutoGroupSelection {
  id: string;
  sourceId: string;
  sourceName: string;
  folderPath: string[];
  accepted: boolean;
  draft: AssetDraft;
  matches: (asset: AssetDraft) => boolean;
}

/** Group only still-unassigned accepted assets against the current workspace snapshot. */
export function autoGroupUnassigned(
  state: WorkspaceState,
  selections: AutoGroupSelection[],
  preserveStructure: boolean,
  newIds: string[],
  capacity: number,
): WorkspaceState {
  if (
    !Number.isInteger(capacity) ||
    capacity < 1 ||
    selections.some((item) => !item.accepted || !item.sourceId || !item.id)
  )
    return state;
  const unique = [...new Map(selections.map((item) => [item.id, item])).values()];
  if (unique.length !== selections.length) return state;
  const pending = unique.filter(
    (item) => !Object.values(state.plansByClientId).some((plan) => plan.assets.some(item.matches)),
  );
  if (!pending.length) return state;
  if (new Set(pending.map((item) => item.draft.id)).size !== pending.length) return state;

  const groups: Array<{
    sourceId: string;
    sourceName: string;
    path: string[];
    assets: AssetDraft[];
  }> = [];
  for (const item of pending) {
    const path = preserveStructure ? item.folderPath : [];
    let group = groups.find(
      (entry) =>
        entry.sourceId === item.sourceId &&
        entry.path.length === path.length &&
        entry.path.every((segment, index) => segment === path[index]),
    );
    if (!group) {
      group = { sourceId: item.sourceId, sourceName: item.sourceName, path, assets: [] };
      groups.push(group);
    }
    group.assets.push(item.draft);
  }
  const needed = groups.reduce(
    (total, group) => total + Math.ceil(group.assets.length / capacity),
    0,
  );
  if (
    newIds.length < needed ||
    new Set(newIds.slice(0, needed)).size !== needed ||
    newIds.slice(0, needed).some((id) => !id || state.plansByClientId[id])
  )
    return state;

  const plansByClientId = { ...state.plansByClientId };
  const planOrder = [...state.planOrder];
  if (planOrder.length === 1) {
    const placeholder = plansByClientId[planOrder[0]];
    if (placeholder?.placeholder === true && !placeholder.assets.length) {
      delete plansByClientId[planOrder.pop()!];
    }
  }
  let nextId = 0;
  for (const group of groups) {
    const count = Math.ceil(group.assets.length / capacity);
    const label = group.path.at(-1) ?? group.sourceName;
    for (let part = 0; part < count; part++) {
      const id = newIds[nextId++];
      plansByClientId[id] = {
        ...makePlanDraft(id, count > 1 ? `${label} ${part + 1}` : label),
        sourceGroup: { sourceId: group.sourceId, path: [...group.path] },
        assets: group.assets.slice(part * capacity, (part + 1) * capacity),
      };
      planOrder.push(id);
    }
  }
  return { ...state, plansByClientId, planOrder, revision: state.revision + 1 };
}
