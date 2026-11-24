import type { Folder, FolderWorkspaceProps, PlanDraft } from '@modules/importer-preview/PlanGroupingSurface/types';
import { canCreatePlanAtDestination, type FolderTeamsPolicy } from '@modules/organization/domain/plan-folder';

type Changes = { policy?: FolderTeamsPolicy | null; usePlanPermissions?: boolean; parentId?: string | null };

function descendants(folders: Folder[], id: string): string[] {
  const children = folders.filter((folder) => folder.parentId === id);
  return [id, ...children.flatMap((folder) => descendants(folders, folder.id))];
}

function resolvePolicies(folders: Folder[]): Folder[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const governingFolder = (folder: Folder, seen = new Set<string>()): Folder | undefined => {
    if (folder.scope === 'PERSONAL' || seen.has(folder.id)) return undefined;
    if (folder.policy || folder.usePlanPermissions) return folder;
    seen.add(folder.id);
    const parent = folder.parentId ? byId.get(folder.parentId) : undefined;
    return parent ? governingFolder(parent, seen) : undefined;
  };
  return folders.map((folder) => {
    const source = governingFolder(folder);
    return { ...folder, effectivePolicy: source?.policy ?? null, effectiveUsePlanPermissions: source?.usePlanPermissions === true };
  });
}

function change(folders: Folder[], folder: Folder, changes: Changes): Folder[] {
  const current = folders.find((item) => item.id === folder.id);
  if (!current || current.revision !== folder.revision) throw new Error('Folder changed. Reopen the editor.');
  if (changes.parentId !== undefined && changes.parentId !== null) {
    const parent = folders.find((item) => item.id === changes.parentId);
    if (!parent || parent.scope !== folder.scope || descendants(folders, folder.id).includes(parent.id))
      throw new Error('Choose a folder in the same scope outside this folder.');
  }
  return resolvePolicies(folders.map((item) => item.id === folder.id
    ? { ...item, ...changes, revision: item.revision + 1 }
    : item));
}

export function folderAdapter(
  folders: Folder[],
  setFolders: (folders: Folder[]) => void,
  plans: PlanDraft[],
): Pick<FolderWorkspaceProps, 'onCreateFolder' | 'onRenameFolder' | 'onPreviewFolderChange' | 'onChangeFolderPolicy' | 'onMoveFolder' | 'onDeleteFolder' | 'onDeleteFolders'> {
  const apply = (next: Folder[]) => { folders = next; setFolders(next); };
  const remove = (selected: Folder[]) => {
    const ids = new Set(selected.map((folder) => folder.id));
    if (selected.some((folder) => !folders.some((item) => item.id === folder.id && item.revision === folder.revision)))
      throw new Error('Folder changed. Reopen the editor.');
    if (folders.some((folder) => folder.parentId && ids.has(folder.parentId)))
      throw new Error('Move or delete the subfolders first.');
    if (plans.some((plan) => plan.folderId && ids.has(plan.folderId)))
      throw new Error('Move local drafts out before deleting folders.');
    apply(folders.filter((folder) => !ids.has(folder.id)));
  };
  return {
    onCreateFolder: async (input) => {
      const parent = input.parentId ? folders.find((folder) => folder.id === input.parentId) : undefined;
      if (input.parentId && (!parent || parent.scope !== input.scope)) throw new Error('Choose a parent in the same scope.');
      apply(resolvePolicies([...folders, {
        ...input,
        id: crypto.randomUUID(),
        revision: 1,
        policy: input.scope === 'SHARED' ? input.policy ?? null : null,
      }]));
    },
    onRenameFolder: async (folder, name) => {
      if (!folders.some((item) => item.id === folder.id && item.revision === folder.revision)) throw new Error('Folder changed. Reopen the editor.');
      apply(folders.map((item) => item.id === folder.id ? { ...item, name, revision: item.revision + 1 } : item));
    },
    onPreviewFolderChange: async (folder, changes) => {
      const affected = descendants(folders, folder.id);
      const affectedPlanIds = plans.filter((plan) => plan.folderId && affected.includes(plan.folderId)).map((plan) => plan.id);
      try {
        const next = change(folders, folder, changes);
        const blocked = plans.some((plan) => plan.folderId && affected.includes(plan.folderId) && folder.scope === 'SHARED' && !canCreatePlanAtDestination(plan.folderId, folder.scope, next));
        const governed = affected.filter((id) => !next.find((item) => item.id === id)?.effectiveUsePlanPermissions);
        const teams = (items: Folder[], kind: 'allow' | 'deny') => [...new Set(governed.flatMap((id) => items.find((item) => item.id === id)?.effectivePolicy?.teams[kind] ?? []))];
        const difference = (oldIds: string[], newIds: string[]) => newIds.filter((id) => !oldIds.includes(id));
        return {
          affectedPlanIds,
          addedTeamIds: difference(teams(folders, 'allow'), teams(next, 'allow')),
          removedTeamIds: difference(teams(next, 'allow'), teams(folders, 'allow')),
          addedDeniedTeamIds: difference(teams(folders, 'deny'), teams(next, 'deny')),
          removedDeniedTeamIds: difference(teams(next, 'deny'), teams(folders, 'deny')),
          blockers: blocked ? ['Local drafts need a folder with an effective policy.'] : [],
          scope: folder.scope,
        };
      } catch (error) {
        return { affectedPlanIds, addedTeamIds: [], removedTeamIds: [], addedDeniedTeamIds: [], removedDeniedTeamIds: [], blockers: [(error as Error).message], scope: folder.scope };
      }
    },
    onChangeFolderPolicy: async (folder, policy, usePlanPermissions) => {
      const preview = await folderAdapter(folders, setFolders, plans).onPreviewFolderChange!(folder, { policy, usePlanPermissions });
      if (preview.blockers.length) throw new Error(preview.blockers[0]);
      apply(change(folders, folder, { policy, usePlanPermissions }));
    },
    onMoveFolder: async (folder, parentId) => {
      const preview = await folderAdapter(folders, setFolders, plans).onPreviewFolderChange!(folder, { parentId });
      if (preview.blockers.length) throw new Error(preview.blockers[0]);
      apply(change(folders, folder, { parentId }));
    },
    onDeleteFolder: async (folder) => remove([folder]),
    onDeleteFolders: async (selected) => remove(selected),
  };
}
