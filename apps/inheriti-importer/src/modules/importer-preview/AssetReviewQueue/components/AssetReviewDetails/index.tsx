import { useImperativeHandle, useState, type Ref } from 'react';
import {
  Badge,
  BaseModal,
  Box,
  ChoiceGroup,
  Icon,
  ScrollableTabs,
  Text,
  Tooltip,
} from '@main-components';
import type { SourceCoverage } from '@modules/mapping/application/source-coverage';
import type { ReviewAsset } from '../../types';
import {
  assetSourceFieldRows,
  selectableSourceFields,
  sourceFieldDisplayName,
} from '../../source-field-coverage';
import { assetStatusForIssues, getAssetReviewIssues } from '../../asset-review-issues';
import { SourceFieldResolver } from '../SourceFieldResolver';
import { SourceFieldPicker } from '../SourceFieldPicker';
import { noteOptions } from '../NotesDestination';
import type { FieldOperationControls, FieldOperationResult } from '../../field-operations';
import type { ImportReviewControls } from '../../import-review-controls';
import { ImportDiagnosticCard } from '../../../components/ImportDiagnosticCard';
import { statusBadge, statusLabel } from '../status';

export function AssetReviewDetails({
  asset,
  openIssuesRef,
  coverage,
  sourceFields,
  siblings,
  operations,
  onFieldResult,
  onExcludeFields,
  onMapField,
  onSetNoteDestination,
}: {
  asset: ReviewAsset;
  openIssuesRef?: Ref<() => void>;
  coverage?: SourceCoverage;
  sourceFields: SourceCoverage['fields'];
  siblings: ReviewAsset[];
  operations?: FieldOperationControls;
  onFieldResult?: (result: FieldOperationResult) => void;
  onExcludeFields?: ImportReviewControls['onExcludeFields'];
  onMapField?: (asset: ReviewAsset, targetField: string, sourceFieldId?: string) => void;
  onSetNoteDestination?: ImportReviewControls['onSetAssetNoteDestination'];
}) {
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState<'fields' | 'warnings'>('fields');
  const dismiss = () => {
    setOpen(false);
    setPane('fields');
  };
  const { schema, bindingIssues, note, notesPending, unresolved, diagnostics, issueCount } =
    getAssetReviewIssues(asset, sourceFields, siblings, coverage?.diagnostics);
  const warningOnly = issueCount === 0 && diagnostics.length > 0;
  const openDetails = () => {
    setPane(warningOnly ? 'warnings' : 'fields');
    setOpen(true);
  };
  useImperativeHandle(openIssuesRef, () => openDetails, [warningOnly]);
  const resolvedStatus = assetStatusForIssues(asset, issueCount);
  const warningBadge = warningOnly && !['accepted', 'excluded'].includes(resolvedStatus);
  const badgeCount = resolvedStatus === 'needs-review' ? issueCount : 0;
  const hasFieldActions = Boolean(
    warningOnly &&
    operations &&
    onFieldResult &&
    asset.status !== 'excluded' &&
    ((asset.type === 'PLAIN-TEXT' && asset.plainTextValue) ||
      selectableSourceFields(asset, assetSourceFieldRows(asset, sourceFields, siblings), siblings)
        .length),
  );
  const fieldsAvailable = issueCount > 0 || hasFieldActions;
  const showWarnings = (!fieldsAvailable || pane === 'warnings') && diagnostics.length > 0;
  const title = `${asset.name} — ${warningOnly ? (showWarnings ? 'Warnings' : 'Included fields') : 'Issues'}`;
  const bodyHeader =
    diagnostics.length > 0 && fieldsAvailable ? (
      <Box paddingHorizontal="m" borderBottomWidth={1} borderColor="gray10">
        <ScrollableTabs
          label="Asset issue sections"
          tabs={[
            { value: 'fields', label: issueCount ? 'Fields to resolve' : 'Included fields' },
            { value: 'warnings', label: 'Warnings', count: diagnostics.length },
          ]}
          value={pane}
          onChange={setPane}
        />
      </Box>
    ) : undefined;
  const warnings = diagnostics.map(([key, diagnostic]) => (
    <ImportDiagnosticCard key={JSON.stringify([asset.id, key])} {...diagnostic} />
  ));
  const renderIssues = (selectableIds: ReadonlySet<string>, hasFieldActions = false) => {
    const remaining = unresolved.filter(({ id }) => !selectableIds.has(id));
    if (!bindingIssues.size && !notesPending && !remaining.length && hasFieldActions)
      return (
        <Text variant="bodySmall" color="gray">
          These fields are already included in this asset. Select them only to split or reorganize
          them.
        </Text>
      );
    return (
      <Box gap="m" className="asset-review-details-content">
        {bindingIssues.size ? (
          <Box gap="xs">
            <Text variant="bodySmall" semibold accessibilityRole="heading">
              Fix field mappings
            </Text>
            {[...bindingIssues].map(([key, { message, sourceId }]) => {
              const source = sourceFields.find(({ id }) => id === sourceId);
              const field = schema.find(({ key: target }) => target === key);

              return (
                <Box
                  key={key}
                  padding="s"
                  gap="xxs"
                  borderWidth={1}
                  borderColor="gray10"
                  borderRadius="s"
                >
                  {source ? (
                    <Text variant="bodySmall" semibold>
                      {sourceFieldDisplayName(source.name)}
                    </Text>
                  ) : null}
                  <Text variant="bodySmall" color="danger120">
                    {message}
                  </Text>
                  {field && onMapField && field.candidates?.length ? (
                    <SourceFieldPicker
                      field={field}
                      compactWhenUnmapped
                      onChange={(sourceId) => onMapField(asset, key, sourceId)}
                    />
                  ) : null}
                </Box>
              );
            })}
          </Box>
        ) : null}
        {notesPending && note ? (
          <Box gap="xs">
            <Text variant="bodySmall" semibold accessibilityRole="heading">
              Imported notes
            </Text>
            <Text variant="bodySmall">
              Choose a destination for the imported notes. They remain protected while you decide.
            </Text>
            {onSetNoteDestination ? (
              <ChoiceGroup
                label="Notes destination for this asset"
                value={null}
                options={noteOptions.filter(
                  ({ value }) => note.publicAllowed || value === 'protected',
                )}
                onChange={(value) => onSetNoteDestination(asset, value)}
              />
            ) : null}
            {note.reason ? (
              <Text variant="bodySmall" color="gray">
                {note.reason}
              </Text>
            ) : null}
          </Box>
        ) : null}
        {remaining.length > 0 ? (
          <Box gap="s">
            <Text variant="bodySmall" semibold accessibilityRole="heading">
              Fields to review
            </Text>
            {remaining.map(({ id, name, reason }) => (
              <Box
                key={id}
                padding="s"
                gap="xxs"
                borderWidth={1}
                borderColor="gray10"
                borderRadius="s"
              >
                <Text variant="bodySmall" semibold>
                  {name}
                </Text>
                <Text variant="bodySmall" color="gray">
                  {reason}
                </Text>
              </Box>
            ))}
          </Box>
        ) : null}
        {!bindingIssues.size && !notesPending && !remaining.length && !hasFieldActions ? (
          <Text variant="bodySmall" color="gray">
            {asset.status === 'excluded'
              ? 'This asset is excluded from the import.'
              : asset.status === 'needs-review'
                ? 'No issues found. Ready for review.'
                : 'No field issues found for this asset.'}
          </Text>
        ) : null}
      </Box>
    );
  };
  return (
    <>
      <Tooltip
        content={
          badgeCount > 0
            ? `${badgeCount} ${badgeCount === 1 ? 'issue' : 'issues'} to resolve`
            : warningOnly
              ? `${diagnostics.length} import ${diagnostics.length === 1 ? 'warning' : 'warnings'}`
              : 'Review asset details'
        }
      >
        <button
          type="button"
          className="asset-review-issues-trigger"
          aria-label="View asset issues"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={openDetails}
        >
          <Badge
            tone={warningBadge ? 'info' : statusBadge[resolvedStatus].tone}
            icon={warningBadge ? 'circle-info' : statusBadge[resolvedStatus].icon}
          >
            {warningBadge ? `Warnings (${diagnostics.length})` : statusLabel[resolvedStatus]}
            {badgeCount > 0 ? ` (${badgeCount})` : null}
          </Badge>
        </button>
      </Tooltip>
      {open ? (
        operations && onFieldResult ? (
          <SourceFieldResolver
            asset={asset}
            fields={sourceFields}
            siblings={siblings}
            operations={operations}
            title={title}
            onDismiss={dismiss}
            onExcludeFields={onExcludeFields}
            renderIssues={renderIssues}
            bodyHeader={bodyHeader}
            warnings={showWarnings ? warnings : undefined}
            onResult={(result) => {
              dismiss();
              onFieldResult(result);
            }}
          />
        ) : (
          <BaseModal
            visible
            title={title}
            titleIcon={<Icon name="circle-exclamation" size={20} label="" />}
            onDismiss={dismiss}
            bodyHeader={bodyHeader}
            bodyPaneKey={showWarnings ? 'warnings' : 'fields'}
          >
            {showWarnings ? warnings : renderIssues(new Set())}
          </BaseModal>
        )
      ) : null}
    </>
  );
}
