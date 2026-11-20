import type { NoteDestination, NoteSourceDecision, ReviewAsset, ReviewBatchResult } from './types';
import type { SourceCoverage } from '@modules/mapping/application/source-coverage';

export type ImportReviewControls = {
  coverage: SourceCoverage;
  noteSources: NoteSourceDecision[];
  onSetSourceNoteDestination?: (
    sourceId: string | null,
    destination: NoteDestination,
  ) => ReviewBatchResult;
  onSetAssetNoteDestination?: (
    asset: ReviewAsset,
    destination: NoteDestination,
  ) => ReviewBatchResult;
  onPreserveFields?: (ids: string[]) => ReviewBatchResult;
  onExcludeFields?: (ids: string[]) => ReviewBatchResult;
};
