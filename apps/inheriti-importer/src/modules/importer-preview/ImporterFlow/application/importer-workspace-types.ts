import type { SensitiveValue } from '@modules/import/domain/import-model';
import type { SuggestedAsset } from '@modules/mapping/domain/suggestion';
import type {
  AssetReviewStatus,
  NoteSourceDecision,
  ReviewAsset,
  ReviewBatchAction,
} from '../../AssetReviewQueue/types';
import type { GroupingAsset, PlanDraft } from '../../PlanGroupingSurface';
import type { WorkspaceState } from '@modules/plans/domain/workspace-model';

import type { SourceCoverage } from '@modules/mapping/application/source-coverage';

export type {
  SourceCoverage,
  SourceCoverageField,
} from '@modules/mapping/application/source-coverage';
export type { NoteDestination, NoteSourceDecision } from '../../AssetReviewQueue/types';

export type ImporterWorkspaceAction =
  ReviewBatchAction | `alternate:${string}` | 'restore-suggestion';

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
  coverage: SourceCoverage;
  executionCoverage: SourceCoverage;
  noteSources: NoteSourceDecision[];
}

export type MappingOverrides = Record<string, Record<string, string | undefined>>;
export type PlainTextOverrides = Record<string, SensitiveValue>;
export type ReviewDecisions = Record<string, AssetReviewStatus>;
export type AssetTypeOverrides = Record<string, string>;

export interface FieldOrganization {
  assets: Record<string, SuggestedAsset>;
  owners: Record<string, string>;
  generatedAssetIds?: ReadonlySet<string>;
  /** Fields released by draft removal require an explicit destination. */
  releasedFieldIds?: ReadonlySet<string>;
  names?: Record<string, string>;
}
