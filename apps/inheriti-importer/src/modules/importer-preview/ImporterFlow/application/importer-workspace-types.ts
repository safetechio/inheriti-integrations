import type { SensitiveValue } from '@modules/import/domain/import-model';
import type { SuggestedAsset } from '@modules/mapping/domain/suggestion';
import type { AssetReviewStatus, ReviewAsset } from '../../AssetReviewQueue/types';
import type { GroupingAsset, PlanDraft } from '../../PlanGroupingSurface';
import type { WorkspaceState } from '@modules/plans/domain/workspace-model';

export type ImporterWorkspaceAction =
  'accept' | 'exclude' | 'alternate:PLAIN-TEXT' | 'restore-suggestion';

export type WorkspaceSetter = (
  next: WorkspaceState | ((current: WorkspaceState) => WorkspaceState),
) => void;

export type WorkspaceReplacer = (
  next: (current: WorkspaceState) => WorkspaceState,
  discard: (workspace: WorkspaceState) => void,
) => void;

export interface ImporterWorkspaceProjection {
  suggestions: SuggestedAsset[];
  assets: ReviewAsset[];
  unassigned: GroupingAsset[];
  plans: PlanDraft[];
}

export type MappingOverrides = Record<string, Record<string, string | undefined>>;
export type PlainTextOverrides = Record<string, SensitiveValue>;
export type ReviewDecisions = Record<string, AssetReviewStatus>;
