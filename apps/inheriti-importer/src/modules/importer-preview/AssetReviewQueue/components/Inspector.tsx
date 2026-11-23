import { memo, useRef, type Ref } from 'react';
import { Box, Card, Notice, Stack, Text } from '@main-components';
import { getAssetTypeDisplayName } from '@modules/_shared/domain/asset-type-display-name';
import { InspectorActions } from './InspectorActions';
import { InspectorFields } from './InspectorFields';
import type { FieldOperationResult } from '../field-operations';
import { AssetSourceFields } from './AssetSourceFields';
import { AssetReviewDetails } from './AssetReviewDetails';
import { SuggestionEvidence } from './SuggestionEvidence';
import { AssetNameEditor } from './AssetNameEditor';
import { ReviewActionsMenu } from './ReviewActionsMenu';
import type { ReviewAsset } from '../types';
import type { SourceCoverage } from '@modules/mapping/application/source-coverage';
import { getAssetIssueContext } from '../asset-review-issues';
import type { ImportReviewControls } from '../import-review-controls';

type InspectorProps = {
  openIssuesRef?: Ref<() => void>;
  coverage?: SourceCoverage;
  assets?: ReviewAsset[];
  onInspect?: (asset: ReviewAsset) => void;
  fieldOperations?: ImportReviewControls['fieldOperations'];
  onFieldResult?: (result: FieldOperationResult) => void;
  onPreserveFields?: ImportReviewControls['onPreserveFields'];
  onExcludeFields?: ImportReviewControls['onExcludeFields'];
  onSetNoteDestination?: ImportReviewControls['onSetAssetNoteDestination'];
  onRenameAsset?: ImportReviewControls['onRenameAsset'];
  asset?: ReviewAsset;
  onAction?: (action: string, asset: ReviewAsset) => void;
  resolveSourceValue?: (
    sourceFieldId: string,
  ) => import('@modules/import/domain/import-model').SensitiveValue | undefined;
  onMapField?: (asset: ReviewAsset, targetField: string, sourceFieldId?: string) => void;
  onEditPlainText?: (asset: ReviewAsset, value: string) => void;
};
export const Inspector = memo(function Inspector({
  asset,
  openIssuesRef,
  assets = [],
  onInspect,
  fieldOperations,
  onFieldResult,
  onAction,
  resolveSourceValue,
  onMapField,
  onEditPlainText,
  coverage,
  onPreserveFields,
  onExcludeFields,
  onSetNoteDestination,
  onRenameAsset,
}: InspectorProps) {
  const inspector = useRef<HTMLElement>(null);
  if (!asset)
    return (
      <Card>
        <Text variant="bodySmall" color="gray">
          Select an Asset to inspect its suggestion and source binding.
        </Text>
      </Card>
    );
  const goToField = (fieldKey: string) => {
    const field = inspector.current?.querySelector<HTMLElement>(
      `[data-review-field="${CSS.escape(fieldKey)}"]`,
    );
    if (!field) return;
    const control =
      field.querySelector<HTMLElement>('[data-review-source-toggle] [role="button"]') ??
      field.querySelector<HTMLElement>(
        'textarea:not([readonly]), input[type="radio"]:not([disabled])',
      );
    field.scrollIntoView?.({ block: 'nearest' });
    (control ?? field).focus({ preventScroll: true });
  };
  const { sourceFields, siblings } = getAssetIssueContext(asset, coverage?.fields, assets);
  return (
    <Card tone="default" className="asset-inspector-card">
      <Stack ref={inspector} gap="m">
        <Box flexDirection="row" justifyContent="space-between" alignItems="flex-start">
          <Box gap="xxs" className="asset-inspector-heading">
            <AssetNameEditor
              key={asset.id}
              name={asset.name}
              onRename={onRenameAsset ? (name) => onRenameAsset(asset, name) : undefined}
              status={
                <AssetReviewDetails
                  key={asset.id}
                  asset={asset}
                  openIssuesRef={openIssuesRef}
                  coverage={coverage}
                  sourceFields={sourceFields}
                  siblings={siblings}
                  operations={fieldOperations}
                  onFieldResult={onFieldResult}
                  onExcludeFields={onExcludeFields}
                  onMapField={onMapField}
                  onSetNoteDestination={onSetNoteDestination}
                />
              }
              actions={
                <ReviewActionsMenu
                  key={`actions:${asset.id}`}
                  label={`Actions for ${asset.name}`}
                  items={[
                    {
                      label: asset.status === 'excluded' ? 'Restore to review' : 'Exclude from import',
                      icon: asset.status === 'excluded' ? 'arrow-left' : 'ban',
                      description:
                        asset.status === 'excluded'
                          ? 'Return this asset to To review with its field choices.'
                          : 'This asset will not be imported. You can recover it from Excluded.',
                      disabled: !onAction,
                      onSelect: () => onAction?.(asset.status === 'excluded' ? 'restore' : 'exclude', asset),
                    },
                    ...(asset.canRemoveDraft && fieldOperations?.remove && onFieldResult
                      ? [
                          {
                            label: 'Remove draft asset',
                            icon: 'trash-can',
                            description:
                              'Remove this draft. Fields without another destination return to Unassigned. You can undo this.',
                            onSelect: () => onFieldResult(fieldOperations.remove!([asset.id])),
                          },
                        ]
                      : []),
                  ]}
                />
              }
            />
            <Text
              variant="importerSourceMeta"
              color="gray"
              className="asset-inspector-heading-text asset-inspector-source-text"
            >
              {asset.source}
            </Text>
          </Box>
        </Box>
        {!coverage && asset.type !== 'PLAIN-TEXT' && asset.unmapped.length > 0 ? (
          <Notice
            compact
            tone="info"
            icon="circle-info"
            title={`${asset.unmapped.length} ${asset.unmapped.length === 1 ? 'field needs' : 'fields need'} a destination`}
            description="Review the source mappings or choose Plain Text to keep the remaining fields."
          />
        ) : null}
        <Box gap="xs">
          <Text variant="importerFieldLabel">Asset type</Text>
          <select
            className="asset-type-select"
            aria-label="Asset type"
            value={asset.type}
            disabled={!onAction || asset.status === 'excluded' || asset.alternatives.length === 0}
            onChange={(event) => onAction?.(`alternate:${event.target.value}`, asset)}
          >
            <option value={asset.type}>{getAssetTypeDisplayName(asset.type)}</option>
            {asset.alternatives.map((type) => (
              <option key={type} value={type}>
                {getAssetTypeDisplayName(type)}
              </option>
            ))}
          </select>
        </Box>
        <SuggestionEvidence key={`evidence:${asset.id}`} asset={asset} />
        {!fieldOperations && coverage && sourceFields.length > 0 ? (
          <AssetSourceFields
            key={asset.id}
            asset={asset}
            fields={sourceFields}
            onPreserveFields={onPreserveFields}
          />
        ) : null}
        <InspectorFields
          asset={asset}
          assets={assets}
          onInspect={onInspect}
          resolveSourceValue={resolveSourceValue}
          onMapField={onMapField}
          onEditPlainText={onEditPlainText}
          onSetNoteDestination={onSetNoteDestination}
        />
        <InspectorActions asset={asset} onAction={onAction} onGoToField={goToField} />
      </Stack>
    </Card>
  );
});
