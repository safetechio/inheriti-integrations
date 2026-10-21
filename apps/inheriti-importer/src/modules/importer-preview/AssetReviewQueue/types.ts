import type { SensitiveValue } from '@modules/import/domain/import-model';

export type AssetReviewStatus = 'suggested' | 'needs-review' | 'accepted' | 'excluded' | 'fallback';

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
  source: string;
  alternatives: string[];
  previewFields?: string[];
  schemaFields?: ReviewAssetField[];
  plainTextValue?: SensitiveValue;
  plainTextSources?: ReviewAssetSourceCandidate[];
  convertedFromType?: string;
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
}

export interface AssetReviewQueueProps {
  assets: ReviewAsset[];
  description?: string;
  selectedId?: string;
  onSelect?: (asset: ReviewAsset) => void;
  onAction?: (action: string, asset: ReviewAsset) => void;
  showKeyboardHints?: boolean;
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
