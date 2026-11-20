export interface GroupingAsset {
  iconName?: string;
  id: string;
  name: string;
  type: string;
  source?: string;
  sourceId?: string;
  folderPath?: string[];
  valid?: boolean;
}
export interface PlanDraft {
  id: string;
  name: string;
  description?: string;
  assets: number;
  capacity: string;
  valid: boolean;
  capacityWarning?: boolean;
  governanceHint?: string;
  assignedAssets?: GroupingAsset[];
  sourceGroup?: { sourceId: string; path: string[] };
  sourceName?: string;
  folderId?: string | null;
  sharingModel?: 'SHARED' | 'PRIVATE';
}
export interface PlanMetadataValues {
  name: string;
  description: string;
  folderId?: string | null;
  scope?: 'SHARED' | 'PERSONAL';
}
import type { FolderTeamsPolicy, PlanFolder } from '@modules/organization/domain/plan-folder';
import type { FolderChangePreview } from '@modules/organization/domain/plan-folder';
export type Folder = PlanFolder;
export interface FolderWorkspaceProps {
  folders: Folder[];
  teams?: Array<{ id: string; name: string }>;
  teamsLoading?: boolean;
  teamsError?: string;
  onRetryTeams?: () => void;
  loading?: boolean;
  hasLoaded?: boolean;
  refreshing?: boolean;
  error?: string;
  scope: 'SHARED' | 'PERSONAL';
  onRetry?: () => void;
  onCreateFolder?: (input: {
    name: string;
    parentId: string | null;
    scope: 'SHARED' | 'PERSONAL';
    policy?: FolderTeamsPolicy | null;
  }) => Promise<void>;
  onRenameFolder?: (folder: Folder, name: string) => Promise<void>;
  onPreviewFolderChange?: (folder: Folder, changes: { policy?: FolderTeamsPolicy | null; parentId?: string | null }) => Promise<FolderChangePreview>;
  onChangeFolderPolicy?: (folder: Folder, policy: FolderTeamsPolicy | null) => Promise<void>;
  onMoveFolder?: (folder: Folder, parentId: string | null) => Promise<void>;
  onDeleteFolder?: (folder: Folder) => Promise<void>;
  onDeleteFolders?: (folders: Folder[]) => Promise<void>;
}
export interface PlanGroupingSurfaceProps {
  unassigned: GroupingAsset[];
  plans: PlanDraft[];
  description?: string;
  selectedPlanId?: string;
  onAssign?: (asset: GroupingAsset, plan: PlanDraft) => void;
  onAssignMany?: (assets: GroupingAsset[], plan: PlanDraft) => void;
  onUnassignMany?: (assets: GroupingAsset[]) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onSelectPlan?: (plan: PlanDraft) => void;
  folders?: FolderWorkspaceProps;
  onCreatePlan?: (options?: {
    name?: string;
    folderId?: string | null;
    scope?: 'SHARED' | 'PERSONAL';
  }) => string | void;
  onCreatePlansFromAssets?: (
    assets: GroupingAsset[],
    options: { name: string; folderId: string | null; scope: 'SHARED' | 'PERSONAL' },
  ) => string[] | void;
  onDeletePlan?: (plan: PlanDraft) => void;
  onDeletePlans?: (plans: PlanDraft[]) => void;
  onUpdatePlan?: (plan: PlanDraft, values: PlanMetadataValues) => void;
  onMovePlans?: (plans: PlanDraft[], folderId: string | null, scope: 'SHARED' | 'PERSONAL') => void;
  onUnassign?: (asset: GroupingAsset, plan: PlanDraft) => void;
  onAutoGroup?: (preserveStructure: boolean) => string | void;
}
export type PlanRevealRequest = { id: string; rename: boolean; sequence: number };
export type DropState = 'idle' | 'over-valid' | 'over-invalid';
