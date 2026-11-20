import type { Folder, FolderWorkspaceProps, PlanDraft } from '@modules/importer-preview/PlanGroupingSurface/types';
import type { FolderTeamsPolicy } from '@modules/organization/domain/plan-folder';

type Changes = { policy?: FolderTeamsPolicy | null; parentId?: string | null };

function descendants(folders: Folder[], id: string): string[] {
  const children = folders.filter((folder) => folder.parentId === id);
  return [id, ...children.flatMap((folder) => descendants(folders, folder.id))];
}

function resolvePolicies(folders: Folder[]): Folder[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const effective = (folder: Folder, seen = new Set<string>()): FolderTeamsPolicy | null => {
    if (folder.scope === 'PERSONAL' || seen.has(folder.id)) return null;
    if (folder.policy) return folder.policy;
    seen.add(folder.id);
    const parent = folder.parentId ? byId.get(folder.parentId) : undefined;
    return parent ? effective(parent, seen) : null;
  };
  return folders.map((folder) => ({ ...folder, effectivePolicy: effective(folder) }));
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
    if (folders.some((folder) => folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)))
      throw new Error('Select child folders too before deleting.');
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
        const blocked = plans.some((plan) => plan.folderId && affected.includes(plan.folderId) && folder.scope === 'SHARED' && !next.find((item) => item.id === plan.folderId)?.effectivePolicy);
        const teams = (items: Folder[], kind: 'allow' | 'deny') => [...new Set(affected.flatMap((id) => items.find((item) => item.id === id)?.effectivePolicy?.teams[kind] ?? []))];
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
    onChangeFolderPolicy: async (folder, policy) => {
      const preview = await folderAdapter(folders, setFolders, plans).onPreviewFolderChange!(folder, { policy });
      if (preview.blockers.length) throw new Error(preview.blockers[0]);
      apply(change(folders, folder, { policy }));
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
