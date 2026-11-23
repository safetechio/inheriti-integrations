import type { NoteDestination, NoteSourceDecision, ReviewAsset, ReviewBatchResult } from './types';
import type { SourceCoverage } from '@modules/mapping/application/source-coverage';

import type { FieldOperationControls } from './field-operations';

export type ImportReviewControls = {
  fieldOperations?: FieldOperationControls;
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
  onRenameAsset?: (asset: ReviewAsset, name: string) => boolean;
};
