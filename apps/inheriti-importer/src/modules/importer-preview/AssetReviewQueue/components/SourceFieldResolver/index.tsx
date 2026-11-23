import { useState, type ReactNode } from 'react';
import { Badge, BaseModal, Box, Button, Checkbox, Icon, Text, Tooltip } from '@main-components';
import { useMarqueeSelection } from '@modules/_shared/ui/hooks/use-marquee-selection';
import type { SourceCoverageField } from '@modules/mapping/application/source-coverage';
import type { ReviewAsset } from '../../types';
import type { ImportReviewControls } from '../../import-review-controls';
import type {
  FieldOperationControls,
  FieldOperationPreview,
  FieldOperationRequest,
  FieldOperationResult,
} from '../../field-operations';
import {
  assetSourceFieldRows,
  selectableSourceFields,
  sourceFieldDisplayName,
  unassignedFieldsExplanation,
} from '../../source-field-coverage';
import { useModalSelectionShortcuts } from '../../hooks/use-modal-selection-shortcuts';
import { useReviewSelection } from '../../hooks/use-review-selection';
import { FieldOperationModal, fieldOperationTargets } from '../FieldOperationModal';
import { FieldSelectionActions } from '../FieldSelectionActions';

export function SourceFieldResolver({
  asset,
  fields,
  siblings,
  operations,
  title,
  onDismiss,
  onExcludeFields,
  renderIssues,
  bodyHeader,
  warnings,
  onResult,
}: {
  asset: ReviewAsset;
  fields: SourceCoverageField[];
  siblings: ReviewAsset[];
  operations: FieldOperationControls;
  title: string;
  onDismiss: () => void;
  onExcludeFields?: ImportReviewControls['onExcludeFields'];
  renderIssues: (selectableIds: ReadonlySet<string>, hasFieldActions: boolean) => ReactNode;
  bodyHeader?: ReactNode;
  warnings?: ReactNode;
  onResult: (result: FieldOperationResult) => void;
}) {
  const [preview, setPreview] = useState<FieldOperationPreview>();
  const [exclude, setExclude] = useState<string[]>([]);
  const [exclusionResult, setExclusionResult] = useState<{ changed: number; skipped: number }>();
  const rows = assetSourceFieldRows(asset, fields, siblings).sort(
    (a, b) => Number(b.pending) - Number(a.pending),
  );
  const literal = asset.type === 'PLAIN-TEXT' && Boolean(asset.plainTextValue);
  const selectable = selectableSourceFields(asset, rows, siblings);
  const selection = useReviewSelection(selectable, selectable);
  const excludableIds = new Set(
    selectable.filter(({ status }) => status === 'pending').map(({ id }) => id),
  );
  const selectedForExclusion = selection.selectedIds.filter((id) => excludableIds.has(id));
  const marquee = useMarqueeSelection({
    selectedIds: selection.selectedIds,
    onSelect: selection.replace,
    resetKey: `${asset.id}:${warnings ? 'warnings' : 'fields'}`,
    rowSelector: '[data-source-field-id]',
    startSelector: '.asset-source-fields-list',
    getRowIds: (row) => (row.dataset.sourceFieldId ? [row.dataset.sourceFieldId] : []),
  });
  const confirmExclusion = () => {
    if (!onExcludeFields) return;
    const eligible = exclude.filter((id) => excludableIds.has(id));
    const result = eligible.length ? onExcludeFields(eligible) : { changedIds: [], skippedIds: [] };
    const changed = result.changedIds.length;
    const skipped = result.skippedIds.length + exclude.length - eligible.length;
    setExclude([]);
    if (changed) {
      marquee.cancel();
      selection.replace([]);
      onResult({
        success: true,
        message: `${changed} excluded · ${skipped} skipped`,
        createdAssetIds: [],
        changedAssetIds: [],
      });
    } else {
      setExclusionResult({ changed, skipped });
    }
  };
  useModalSelectionShortcuts({
    enabled: !preview && !warnings && !exclude.length,
    title,
    canSelectAll: selectable.length > 0,
    canClear: selection.selectedIds.length > 0 || marquee.rectangle !== null,
    onSelectAll: () => selection.replace(selectable.map(({ id }) => id)),
    onClear: () => {
      marquee.cancel();
      selection.replace([]);
    },
  });
  const selectableIds = new Set(selectable.map(({ id }) => id));
  const selectAllLabel =
    selectable.length === 1 ? 'Select field' : `Select all ${selectable.length} fields`;
  const allSelected = selectable.length > 0 && selection.selectedIds.length === selectable.length;
  const targets = fieldOperationTargets([...siblings, asset], asset);
  const visibleRows = rows.filter(({ field }) => selectableIds.has(field.id));

  const start = (action: FieldOperationRequest['action']) => {
    setPreview(
      operations.preview({
        sourceAssetId: asset.id,
        fieldIds: action === 'duplicate-text' ? [] : selection.selectedIds,
        action,
        targetAssetId: action === 'move' ? targets[0]?.id : undefined,
      }),
    );
  };

  if (preview)
    return (
      <FieldOperationModal
        initialPreview={preview}
        fields={fields.filter(({ id }) => preview.request.fieldIds.includes(id))}
        targets={targets}
        operations={operations}
        onDismiss={onDismiss}
        onResult={onResult}
      />
    );
  const canOrganize = asset.status !== 'excluded' && (literal || selectable.length > 0);
  return (
    <BaseModal
      visible
      title={
        exclude.length
          ? `Exclude ${exclude.length} unresolved ${exclude.length === 1 ? 'field' : 'fields'}?`
          : title
      }
      titleIcon={<Icon name={exclude.length ? 'ban' : 'circle-exclamation'} size={20} label="" />}
      onDismiss={onDismiss}
      bodyHeader={exclude.length ? undefined : bodyHeader}
      bodyPaneKey={exclude.length ? 'exclude' : warnings ? 'warnings' : 'fields'}
      bodyScrollRef={warnings || exclude.length ? undefined : marquee.setContainerRef}
      footer={
        exclude.length ? (
          <Box flexDirection="row" gap="s">
            <Button title="Cancel" variant="plain" onPress={() => setExclude([])} />
            <Button title="Confirm exclusion" color="danger" onPress={confirmExclusion} />
          </Box>
        ) : canOrganize && !warnings ? (
          <Box flex={1} gap="xs">
            {literal ? (
              <Button
                title="Create a Plain Text copy"
                size="sm"
                variant="outlined"
                onPress={() => start('duplicate-text')}
              />
            ) : (
              <FieldSelectionActions
                count={selection.selectedIds.length}
                canMove={targets.length > 0}
                canExclude={selectedForExclusion.length > 0}
                onClear={() => selection.replace([])}
                onStart={start}
                onExclude={onExcludeFields ? () => setExclude(selectedForExclusion) : undefined}
              />
            )}
          </Box>
        ) : undefined
      }
    >
      {exclude.length ? (
        <Text variant="bodyRegular" color="gray">
          These fields will be left out of the staged plans.
        </Text>
      ) : (
        (warnings ?? renderIssues(selectableIds, canOrganize))
      )}
      {exclusionResult && !exclude.length && !warnings ? (
        <Text variant="bodySmall" role="status">
          {exclusionResult.changed} excluded · {exclusionResult.skipped} skipped
        </Text>
      ) : null}
      {canOrganize && !warnings && !exclude.length ? (
        <Box gap="s">
          <Box flexDirection="row" alignItems="center" justifyContent="space-between">
            <Text variant="bodySmall" semibold accessibilityRole="heading">
              {literal || !visibleRows.some(({ pending }) => pending)
                ? 'Fields in this asset'
                : bodyHeader
                  ? 'Unassigned fields'
                  : 'Fields to resolve'}
            </Text>
            {selectable.length ? (
              <Tooltip content="Drag from the list margin to select fields. Ctrl/Cmd+drag adds fields and Ctrl/Cmd+click toggles them. Shift+click extends the selection. Ctrl/Cmd+A selects all; Escape clears.">
                <button
                  type="button"
                  className="selection-help-trigger"
                  aria-label="Field selection help"
                >
                  <Icon
                    name="circle-question"
                    type="font-awesome-6"
                    size={15}
                    color="gray"
                    label=""
                  />
                </button>
              </Tooltip>
            ) : null}
          </Box>
          {!literal && visibleRows.some(({ pending }) => pending) ? (
            <Text variant="bodySmall" color="gray">
              {unassignedFieldsExplanation}
            </Text>
          ) : null}
          <Box className="asset-source-fields-list" gap="s">
            {literal ? (
              <Text variant="bodySmall" color="gray">
                Edited Plain Text no longer has individual field links. You can copy the entire
                protected value.
              </Text>
            ) : null}
            {selectable.length ? (
              <Box flexDirection="row" alignItems="center" gap="s" paddingHorizontal="s">
                <Checkbox
                  aria-label={selectAllLabel}
                  checked={allSelected}
                  mixed={!allSelected && selection.selectedIds.length > 0}
                  readOnly
                  onClick={() =>
                    selection.replace(allSelected ? [] : selectable.map(({ id }) => id))
                  }
                />
                <Text variant="bodySmall">{selectAllLabel}</Text>
              </Box>
            ) : null}
            {visibleRows.map((row) => (
              <Box
                key={row.field.id}
                backgroundColor={selection.selectedIdsSet.has(row.field.id) ? 'gray5' : undefined}
                dataSet={{ sourceFieldId: row.field.id }}
                flexDirection="row"
                alignItems="center"
                gap="s"
                padding="s"
                borderWidth={1}
                borderColor="gray10"
                borderRadius="s"
                onClick={(event: React.MouseEvent) => {
                  if (event.shiftKey || event.ctrlKey || event.metaKey)
                    selection.toggle(row.field.id, event.shiftKey);
                }}
              >
                <Box style={{ width: 18, flexShrink: 0 }}>
                  <Checkbox
                    aria-label={`Select ${sourceFieldDisplayName(row.field.name)}`}
                    checked={selection.selectedIdsSet.has(row.field.id)}
                    readOnly
                    onClick={(event) => selection.toggle(row.field.id, event.shiftKey)}
                  />
                </Box>
                <Box flex={1} minWidth={0}>
                  <Text variant="bodySmall" semibold className="asset-source-field-label">
                    {sourceFieldDisplayName(row.field.name)}
                  </Text>
                </Box>
                {row.pending ? (
                  <Badge tone="warning" size="sm" style={{ flexShrink: 0 }}>
                    Unassigned
                  </Badge>
                ) : null}
              </Box>
            ))}
          </Box>
        </Box>
      ) : null}
    </BaseModal>
  );
}
