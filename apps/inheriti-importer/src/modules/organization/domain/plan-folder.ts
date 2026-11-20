export type PlanFolderScope = 'SHARED' | 'PERSONAL';

export interface FolderTeamsPolicy {
  teams: { allow: string[]; deny: string[] };
}

export interface PlanFolder {
  id: string;
  name: string;
  parentId: string | null;
  scope: PlanFolderScope;
  revision: number;
  policy?: FolderTeamsPolicy | null;
  effectivePolicy?: FolderTeamsPolicy | null;
}

export interface FolderChangePreview {
  affectedPlanIds: string[];
  addedTeamIds: string[];
  removedTeamIds: string[];
  addedDeniedTeamIds: string[];
  removedDeniedTeamIds: string[];
  blockers: string[];
  scope?: PlanFolderScope;
}

export function canCreatePlanAtDestination(
  folderId: string | null,
  scope: PlanFolderScope,
  folders: PlanFolder[],
): boolean {
  if (folderId === null) return true;
  const folder = folders.find((item) => item.id === folderId && item.scope === scope);
  return !!folder && (scope === 'PERSONAL' || !!(folder.effectivePolicy ?? folder.policy));
}
