import { useMemo } from 'react';
import { canCreatePlanAtDestination } from '@modules/organization/domain/plan-folder';
import type { Folder, PlanDraft } from '../../../types';

function addToGroup<Key, Item>(groups: Map<Key, Item[]>, key: Key, item: Item) {
  const group = groups.get(key);
  if (group) group.push(item);
  else groups.set(key, [item]);
}

export function useFolderTreeIndex(
  folders: Folder[],
  plans: PlanDraft[],
  scope: Folder['scope'],
  query: string,
  withPlans: boolean,
) {
  const structure = useMemo(() => {
    const firstFolderById = new Map<string, Folder>();
    const folderById = new Map<string, Folder>();
    const childrenById = new Map<string, Folder[]>();
    const pathById = new Map<string, Folder[]>();
    const folderNames = new Map<string, string>();
    const readyDestinations = new Set<string | null>([null]);
    const visibleFolders = folders.filter((folder) => folder.scope === scope);
    for (const folder of folders) {
      if (!firstFolderById.has(folder.id)) firstFolderById.set(folder.id, folder);
    }
    for (const folder of visibleFolders) {
      if (!folderById.has(folder.id)) {
        folderById.set(folder.id, folder);
        folderNames.set(folder.id, folder.name.toLowerCase());
        if (canCreatePlanAtDestination(folder.id, scope, [folder])) readyDestinations.add(folder.id);
      }
      if (folder.parentId) addToGroup(childrenById, folder.parentId, folder);
    }
    for (const folder of visibleFolders) {
      const path: Folder[] = [];
      const visited = new Set<string>();
      let id: string | null = folder.id;
      while (id && !visited.has(id)) {
        const ancestor = folderById.get(id);
        if (!ancestor) break;
        visited.add(id);
        path.push(ancestor);
        id = ancestor.parentId;
      }
      pathById.set(folder.id, path.reverse());
    }
    return {
      firstFolderById, folderById, visibleFolders, childrenById, pathById, folderNames, readyDestinations,
      roots: visibleFolders.filter((folder) => !folder.parentId || !folderById.has(folder.parentId)),
    };
  }, [folders, scope]);

  const indexedPlans = useMemo(() => {
    const visiblePlans = plans.filter((plan) => (plan.sharingModel === 'PRIVATE' ? 'PERSONAL' : 'SHARED') === scope);
    const plansByFolderId = new Map<string | null, PlanDraft[]>();
    const draftIndexesByFolderId = new Map<string, number[]>();
    for (const plan of visiblePlans) {
      const id = plan.folderId;
      addToGroup(plansByFolderId, id && structure.folderById.has(id) ? id : null, plan);
    }
    // Deletion warnings count all local drafts, even those outside the visible scope.
    plans.forEach((plan, index) => {
      const visited = new Set<string>();
      let id = plan.folderId;
      while (id && !visited.has(id)) {
        visited.add(id);
        addToGroup(draftIndexesByFolderId, id, index);
        id = structure.firstFolderById.get(id)?.parentId;
      }
    });
    return {
      visiblePlans, plansByFolderId, draftIndexesByFolderId,
      searchablePlans: visiblePlans.map((plan) => ({ plan, name: plan.name.toLowerCase() })),
    };
  }, [plans, scope, structure]);

  const search = useMemo(() => {
    const term = query.toLowerCase();
    const searchFolderIds = new Set<string>();
    const matchingFolderIds = new Set<string>();
    const matchesPlanSearch = (plan: PlanDraft, value: string) => {
      const text = value.toLowerCase();
      return !text || plan.name.toLowerCase().includes(text) ||
        (structure.pathById.get(plan.folderId ?? '') ?? []).some((folder) => structure.folderNames.get(folder.id)?.includes(text));
    };
    if (!term) {
      if (withPlans) {
        for (const id of indexedPlans.plansByFolderId.keys()) {
          for (const ancestor of structure.pathById.get(id ?? '') ?? [])
            searchFolderIds.add(ancestor.id);
        }
      }
      return {
        searchFolderIds, matchesPlanSearch, searchPlans: indexedPlans.visiblePlans,
        searchPlansByFolderId: indexedPlans.plansByFolderId,
      };
    }

    const nameMatches = new Set<string>();
    for (const [id, name] of structure.folderNames) {
      if (name.includes(term)) nameMatches.add(id);
    }
    for (const [id, path] of structure.pathById) {
      if (!path.some((ancestor) => nameMatches.has(ancestor.id))) continue;
      matchingFolderIds.add(id);
      if (!withPlans) for (const ancestor of path) searchFolderIds.add(ancestor.id);
    }
    const searchPlans: PlanDraft[] = [];
    const searchPlansByFolderId = new Map<string | null, PlanDraft[]>();
    for (const { plan, name } of indexedPlans.searchablePlans) {
      const id = plan.folderId;
      if (!name.includes(term) && !matchingFolderIds.has(id ?? '')) continue;
      searchPlans.push(plan);
      addToGroup(searchPlansByFolderId, id && structure.folderById.has(id) ? id : null, plan);
      for (const ancestor of structure.pathById.get(id ?? '') ?? []) searchFolderIds.add(ancestor.id);
    }
    return { searchFolderIds, matchesPlanSearch, searchPlans, searchPlansByFolderId };
  }, [query, withPlans, structure, indexedPlans]);

  return { ...structure, ...indexedPlans, ...search };
}
