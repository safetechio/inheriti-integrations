import type { SensitiveValue } from '@modules/import/domain/import-model';

export type AssetReviewStatus = 'suggested' | 'needs-review' | 'accepted' | 'excluded' | 'fallback';

export type ReviewBatchAction = 'accept' | 'exclude';

export interface ReviewBatchResult {
  changedIds: string[];
  skippedIds: string[];
}

export type {
  SourceCoverage as ImportCoverage,
  SourceCoverageField,
} from '@modules/mapping/application/source-coverage';

export type NoteDestination = 'asset-notes' | 'protected';

export interface NoteSourceDecision {
  sourceId: string;
  sourceName: string;
  fieldCount: number;
  destination: NoteDestination | null;
}

export type NoteSource = NoteSourceDecision;

export interface ReviewAssetNote {
  sourceFieldId: string;
  destination: NoteDestination;
  explicit: boolean;
  inherited: boolean;
  publicAllowed: boolean;
  reason?: string;
}

export interface ReviewAsset {
  id: string;
  name: string;
  type: string;
  status: AssetReviewStatus;
  suggestionLabel?: string;
  confidence?: string;
  rationale: string;
  mapped: string[];
  unmapped: string[];
  unmappedSourceFieldIds?: string[];
  source: string;
  sourceId?: string;
  sourceNodeId?: string;
  sourceFileName?: string;
  folderPath?: string[];
  alternatives: string[];
  previewFields?: string[];
  schemaFields?: ReviewAssetField[];
  plainTextValue?: SensitiveValue;
  plainTextSources?: ReviewAssetSourceCandidate[];
  convertedFromType?: string;
  batchMappingSupported?: boolean;
  note?: ReviewAssetNote;
  preservedInCompanion?: string[];
}

export interface ReviewAssetSourceCandidate {
  id: string;
  name: string;
  length?: number;
}

export interface ReviewAssetField {
  key: string;
  label: string;
  required?: boolean;
  sourceFieldId?: string;
  sourceFieldName?: string;
  candidates?: ReviewAssetSourceCandidate[];
  validationError?: string;
  manuallyMapped?: boolean;
}

export interface AssetReviewQueueProps {
  assets: ReviewAsset[];
  sourceFiles?: { id?: string; name: string }[];
  description?: string;
  selectedId?: string;
  onSelect?: (asset: ReviewAsset) => void;
  onAction?: (action: string, asset: ReviewAsset) => void;
  onAcceptAllEligible?: () => number;
  onUndoAcceptAll?: () => void;
  onReviewAssets?: (action: ReviewBatchAction, assets: ReviewAsset[]) => ReviewBatchResult;
  onUndoReviewBatch?: () => ReviewBatchResult | void;
  canUndoReviewBatch?: boolean;
  onApplyMappings?: (template: ReviewAsset, assets: ReviewAsset[]) => ReviewBatchResult;
  showKeyboardHints?: boolean;
  autoAdvance?: boolean;
  resolveSourceValue?: (sourceFieldId: string) => SensitiveValue | undefined;
  onMapField?: (asset: ReviewAsset, targetField: string, sourceFieldId?: string) => void;
  onEditPlainText?: (asset: ReviewAsset, value: string) => void;
}

export function hasIncludedSchemaField(asset: ReviewAsset): boolean {
  if (asset.type === 'PLAIN-TEXT')
    return (
      Boolean(
        asset.plainTextValue?.reveal().trim().length ||
        asset.plainTextSources?.length ||
        asset.schemaFields?.find((field) => field.key === 'secret.text')?.sourceFieldId,
      ) && !asset.schemaFields?.some((field) => field.validationError)
    );
  if (!asset.schemaFields) return true;
  return (
    asset.schemaFields.some(
      (field) => field.key.startsWith('secret.') && Boolean(field.sourceFieldId),
    ) && asset.schemaFields.every((field) => !field.validationError)
  );
}
