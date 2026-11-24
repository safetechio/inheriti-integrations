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
  usePlanPermissions?: boolean;
  effectiveUsePlanPermissions?: boolean;
}

export interface FolderChangePreview {
  affectedPlanIds: string[];
  addedTeamIds: string[];
  removedTeamIds: string[];
  addedDeniedTeamIds: string[];
  removedDeniedTeamIds: string[];
  blockers: string[];
  scope?: PlanFolderScope;
  usePlanPermissions?: boolean;
  effectiveUsePlanPermissions?: boolean;
}

export function canCreatePlanAtDestination(
  folderId: string | null,
  scope: PlanFolderScope,
  folders: PlanFolder[],
): boolean {
  if (folderId === null) return true;
  const folder = folders.find((item) => item.id === folderId && item.scope === scope);
  return !!folder && (scope === 'PERSONAL' || folder.effectiveUsePlanPermissions === true || !!(folder.effectivePolicy ?? folder.policy));
}
