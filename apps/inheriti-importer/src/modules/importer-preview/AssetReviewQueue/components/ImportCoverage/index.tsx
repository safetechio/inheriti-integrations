import { importDiagnosticCategory } from '@modules/import/domain/import-diagnostic';
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import {
  Badge,
  BaseModal,
  Box,
  Button,
  Card,
  Checkbox,
  ScrollableTabs,
  Icon,
  Text,
  Tooltip,
} from '@main-components';
import { getAssetFieldDisplayName } from '@modules/_shared/domain/asset-field-display-name';
import type { ReviewAsset, ReviewBatchResult } from '../../types';
import type {
  FieldOperationControls,
  FieldOperationPreview,
  FieldOperationRequest,
} from '../../field-operations';
import { FieldOperationModal, fieldOperationTargets } from '../FieldOperationModal';
import { FieldSelectionActions } from '../FieldSelectionActions';
import { SourceFilter } from './components/SourceFilter';
import type { SourceCoverage as Coverage } from '@modules/mapping/application/source-coverage';
import { useMarqueeSelection } from '@modules/_shared/ui/hooks/use-marquee-selection';
import { useModalSelectionShortcuts } from '../../hooks/use-modal-selection-shortcuts';
import { useReviewSelection } from '../../hooks/use-review-selection';
import {
  assetSourceFieldRows,
  selectableSourceFields,
  sourceFieldDisplayName,
  unassignedFieldsExplanation,
} from '../../source-field-coverage';
import { isNoteDestinationPending } from '../../review-blockers';
import './styles.css';

const fieldStatuses = {
  pending: 'Pending',
  invalid: 'Invalid',
  excluded: 'Excluded',
  mapped: 'Mapped',
};
const diagnosticStatuses = {
  unsupported: 'Unsupported',
  skipped: 'Skipped by parser',
  transformed: 'Transformed',
  metadata: 'Source metadata',
};
const fieldTones = {
  mapped: 'success',
  excluded: 'neutral',
  pending: 'warning',
  invalid: 'danger',
} as const;
const diagnosticTones = {
  unsupported: 'warning',
  skipped: 'warning',
  transformed: 'info',
  metadata: 'neutral',
} as const;
const pageSize = 20;

function displayStatus(status: Coverage['fields'][number]['status']): keyof typeof fieldStatuses {
  return status === 'protected' ? 'mapped' : status;
}

const originFor = (assets: ReviewAsset[]) => {
  const available = (asset: ReviewAsset) => asset.status !== 'excluded' && !asset.plainTextValue;
  return (
    assets.find((asset) => asset.ownsSourceDiagnostics && available(asset)) ??
    assets.find((asset) => asset.type !== 'PLAIN-TEXT' && available(asset)) ??
    assets.find(available)
  );
};

const entryKey = (sourceId?: string, nodeId?: string) => JSON.stringify([sourceId, nodeId]);

function countFields(fields: Coverage['fields']) {
  const counts = { pending: 0, invalid: 0, excluded: 0, mapped: 0 };
  for (const field of fields) counts[displayStatus(field.status)]++;
  return counts;
}

export function ImportCoverage({
  coverage,
  sourceNames,
  assetNames,
  reviewAssets,
  fieldOperations,
  onExcludeFields,
  onReviewMapping,
  recoveryRef,
}: {
  coverage: Coverage;
  recoveryRef?: Ref<(status: 'pending' | 'invalid') => void>;
  sourceNames: ReadonlyMap<string, string>;
  assetNames: ReadonlyMap<string, string>;
  reviewAssets?: ReviewAsset[];
  onReviewMapping?: (asset: ReviewAsset) => void;
  fieldOperations?: FieldOperationControls;
  onExcludeFields?: (ids: string[]) => ReviewBatchResult;
}) {
  const [expanded, setExpanded] = useState(false);
  const [source, setSource] = useState('');
  const [savedFilter, setFilter] = useState<
    keyof typeof fieldStatuses | 'protected' | 'unassigned' | 'proposed' | ''
  >('');
  // An open dialog can retain the old filter during Fast Refresh.
  const hasAssetContext = reviewAssets !== undefined;
  const filter =
    savedFilter === 'protected'
      ? 'mapped'
      : savedFilter === 'pending' && hasAssetContext
        ? 'unassigned'
        : savedFilter;
  const [page, setPage] = useState(0);
  const [exclude, setExclude] = useState<string[]>([]);
  const [preview, setPreview] = useState<FieldOperationPreview>();
  const [operationError, setOperationError] = useState<string>();
  useImperativeHandle(
    recoveryRef,
    () => (status) => {
      setSource('');
      setFilter(status);
      setPage(0);
      setExpanded(true);
    },
    [],
  );
  // Fast Refresh can retain a result recorded before the badge layout was introduced.
  const [result, setResult] = useState<
    string | { changed: number; skipped: number; action: string }
  >();
  const sources = useMemo(() => {
    const names = new Map(sourceNames);
    for (const { sourceId } of coverage.fields) {
      if (sourceId && !names.has(sourceId)) names.set(sourceId, 'Source');
    }
    for (const { sourceId } of coverage.diagnostics) {
      if (sourceId && !names.has(sourceId)) names.set(sourceId, 'Source');
    }
    const occurrences = new Map<string, number>();
    return new Map(
      [...names].map(([id, name]) => {
        const occurrence = (occurrences.get(name) ?? 0) + 1;
        occurrences.set(name, occurrence);
        return [id, occurrence === 1 ? name : `${name} (${occurrence})`];
      }),
    );
  }, [coverage.fields, coverage.diagnostics, sourceNames]);
  const sourceFields = useMemo(
    () => (source ? coverage.fields.filter((field) => field.sourceId === source) : coverage.fields),
    [coverage.fields, source],
  );
  const sourceDiagnostics = useMemo(
    () =>
      source
        ? coverage.diagnostics.filter(({ sourceId }) => sourceId === source || !sourceId)
        : coverage.diagnostics,
    [coverage.diagnostics, source],
  );
  const counts = useMemo(() => countFields(coverage.fields), [coverage.fields]);
  const sourceCounts = useMemo(() => countFields(sourceFields), [sourceFields]);
  const reviewing = Boolean(fieldOperations || onExcludeFields);
  const eligible = useMemo(
    () => sourceFields.filter((field) => field.status === 'pending' || field.status === 'invalid'),
    [sourceFields],
  );
  const { entryAssets, proposed } = useMemo(() => {
    const entryAssets = new Map<string, ReviewAsset[]>();
    const proposed = new Map<string, Set<string>>();
    const excludedFieldIds = new Set(
      coverage.fields.filter(({ status }) => status === 'excluded').map(({ id }) => id),
    );
    const addProposal = (id: string, label: string) => {
      const labels = proposed.get(id) ?? new Set<string>();
      labels.add(label);
      proposed.set(id, labels);
    };
    for (const asset of reviewAssets ?? []) {
      const key = entryKey(asset.sourceId, asset.sourceNodeId);
      const assets = entryAssets.get(key) ?? [];
      assets.push(asset);
      entryAssets.set(key, assets);
      if (asset.status === 'excluded') continue;
      if (
        asset.note?.destination === 'asset-notes' &&
        !isNoteDestinationPending(asset, excludedFieldIds)
      ) {
        addProposal(
          asset.note.sourceFieldId,
          `${asset.name} · ${getAssetFieldDisplayName('meta.notes')}`,
        );
      }
      for (const { key, sourceFieldId } of asset.schemaFields ?? []) {
        if (sourceFieldId)
          addProposal(sourceFieldId, `${asset.name} · ${getAssetFieldDisplayName(key)}`);
      }
      for (const { id } of asset.plainTextSources ?? []) {
        addProposal(id, `${asset.name} · ${getAssetFieldDisplayName('secret.text')}`);
      }
    }
    return { entryAssets, proposed };
  }, [coverage.fields, reviewAssets]);

  const unassigned = useMemo(
    () => sourceFields.filter(({ status, id }) => status === 'pending' && !proposed.has(id)),
    [sourceFields, proposed],
  );
  const proposedFields = useMemo(
    () => sourceFields.filter(({ status, id }) => status === 'pending' && proposed.has(id)),
    [sourceFields, proposed],
  );
  const filteredEligible = useMemo(() => {
    if (!filter) return eligible;
    if (filter === 'unassigned') return unassigned;
    if (filter === 'proposed') return proposedFields;
    if (filter !== 'pending' && filter !== 'invalid') return [];
    return eligible.filter((field) => field.status === filter);
  }, [eligible, filter, unassigned, proposedFields]);
  const selection = useReviewSelection(eligible, filteredEligible);
  const { replace: replaceSelection } = selection;
  useEffect(() => {
    if (!source || sources.has(source)) return;
    setSource('');
    setPage(0);
    setResult(undefined);
    setOperationError(undefined);
    replaceSelection([]);
  }, [source, sources, replaceSelection]);
  const eligibility = useRef(eligible);
  useEffect(() => {
    if (eligibility.current === eligible) return;
    const stillEligible = new Set(eligible.map(({ id }) => id));
    if (eligibility.current.some(({ id }) => !stillEligible.has(id))) {
      selection.replace(selection.selectedIds);
    }
    eligibility.current = eligible;
  });
  const filteredIds = filteredEligible.map(({ id }) => id);
  const selectedInFilter = filteredIds.filter((id) => selection.selectedIdsSet.has(id)).length;
  const selectAllLabel =
    filteredIds.length === 1 ? 'Select field' : `Select all ${filteredIds.length} fields`;
  const allSelected = filteredIds.length > 0 && selectedInFilter === filteredIds.length;
  const marquee = useMarqueeSelection({
    selectedIds: selection.selectedIds,
    onSelect: selection.replace,
    resetKey: JSON.stringify([source, filter, page]),
    rowSelector: '[data-coverage-field-id]',
    getRowIds: (row) => (row.dataset.coverageFieldId ? [row.dataset.coverageFieldId] : []),
  });
  useModalSelectionShortcuts({
    enabled: expanded && reviewing && !exclude.length && !preview,
    title: 'Source field details',
    canSelectAll: filteredIds.length > 0,
    canClear: selection.selectedIds.length > 0 || marquee.rectangle !== null,
    onSelectAll: () => selection.replace([...new Set([...selection.selectedIds, ...filteredIds])]),
    onClear: () => {
      marquee.cancel();
      selection.replace([]);
    },
  });
  const details = useMemo(() => {
    if (!expanded) return [];
    const matching =
      filter === 'unassigned'
        ? unassigned
        : filter === 'proposed'
          ? proposedFields
          : sourceFields.filter((field) => !filter || displayStatus(field.status) === filter);
    const fields = matching.map((field) => ({
      reviewTargets: (entryAssets.get(entryKey(field.sourceId, field.nodeId)) ?? []).filter(
        (asset) =>
          asset.status !== 'excluded' &&
          (asset.schemaFields?.some(({ sourceFieldId }) => sourceFieldId === field.id) ||
            asset.plainTextSources?.some(({ id }) => id === field.id) ||
            field.destinations.some(
              ({ assetId }) => assetId === asset.id || asset.destinationAssetIds?.includes(assetId),
            ) ||
            (asset.note?.sourceFieldId === field.id &&
              !isNoteDestinationPending(asset, new Set()))),
      ),
      id: field.id,
      actionable: field.status === 'pending' || field.status === 'invalid',
      name: sourceFieldDisplayName(field.name),
      entry:
        field.nodeName ||
        originFor(entryAssets.get(entryKey(field.sourceId, field.nodeId)) ?? [])?.name ||
        entryAssets.get(entryKey(field.sourceId, field.nodeId))?.[0]?.name ||
        'Entry unavailable',
      proposed: field.status === 'pending' ? [...(proposed.get(field.id) ?? [])] : [],
      source: sources.get(field.sourceId) ?? 'Source',
      status:
        hasAssetContext && field.status === 'pending'
          ? proposed.has(field.id)
            ? 'Proposed'
            : 'Unassigned'
          : fieldStatuses[displayStatus(field.status)],
      tone:
        hasAssetContext && field.status === 'pending' && proposed.has(field.id)
          ? ('info' as const)
          : fieldTones[displayStatus(field.status)],
      destinations: [
        ...new Set(
          field.destinations.map(({ assetId, fieldId }) => {
            const asset = assetNames.get(assetId);
            const field = getAssetFieldDisplayName(fieldId);
            return asset ? `${asset} · ${field}` : field;
          }),
        ),
      ],
    }));
    return filter
      ? fields
      : [
          ...sourceDiagnostics.map((diagnostic, index) => ({
            id: `diagnostic:${diagnostic.sourceId}:${index}`,
            name: diagnostic.message,
            source: sources.get(diagnostic.sourceId) ?? 'Source',
            status: diagnosticStatuses[importDiagnosticCategory(diagnostic)],
            tone: diagnosticTones[importDiagnosticCategory(diagnostic)],
            count: diagnostic.count,
          })),
          ...fields,
        ];
  }, [
    expanded,
    sourceFields,
    unassigned,
    proposedFields,
    hasAssetContext,
    sourceDiagnostics,
    filter,
    sources,
    assetNames,
    entryAssets,
    proposed,
  ]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(details.length / pageSize) - 1));
  const summarizedDiagnostics = coverage.diagnostics.reduce(
    (summary, diagnostic) => {
      summary[importDiagnosticCategory(diagnostic)] += diagnostic.count;
      return summary;
    },
    { unsupported: 0, skipped: 0, transformed: 0, metadata: 0 },
  );
  const selectedFields = eligible.filter(({ id }) => selection.selectedIdsSet.has(id));
  const selectedByEntry = new Map<string, Coverage['fields']>();
  for (const field of selectedFields) {
    const key = entryKey(field.sourceId, field.nodeId);
    const fields = selectedByEntry.get(key) ?? [];
    fields.push(field);
    selectedByEntry.set(key, fields);
  }
  const selectedEntries = [...selectedByEntry].map(([key, fields]) => {
    const assets = entryAssets.get(key) ?? [];
    const origin = originFor(assets);
    return { fields, origin, assets };
  });
  const unavailableEntry = selectedEntries.find(({ fields, origin, assets }) => {
    if (!origin) return true;
    const availableIds = new Set(
      selectableSourceFields(origin, assetSourceFieldRows(origin, fields, assets), assets).map(
        ({ id }) => id,
      ),
    );
    return fields.some(({ id }) => !availableIds.has(id));
  });
  const canOrganize = !unavailableEntry;
  const organizeUnavailable = unavailableEntry?.origin
    ? 'Some selected fields already have a destination or are unavailable. Select Unassigned fields to create or assign assets.'
    : 'A selected entry has no available asset. Clear it from the selection to continue.';
  const canMove = selectedEntries.every(({ origin, assets }) =>
    origin ? fieldOperationTargets(assets, origin).length > 0 : true,
  );
  const startOperation = (action: FieldOperationRequest['action']) => {
    if (!fieldOperations || !selectedFields.length || !canOrganize) return;
    setOperationError(undefined);
    setResult(undefined);
    const entries = [];
    for (const { fields, origin, assets } of selectedEntries) {
      if (!origin) {
        const { sourceId, name, nodeName } = fields[0];
        setOperationError(
          `No available asset for ${nodeName || `the entry containing “${sourceFieldDisplayName(name)}”`} · ${sources.get(sourceId) ?? 'Source'}.`,
        );
        return;
      }
      entries.push({
        sourceAssetId: origin.id,
        fieldIds: fields.map(({ id }) => id),
        targetAssetId: action === 'move' ? fieldOperationTargets(assets, origin)[0]?.id : undefined,
      });
    }
    setExpanded(false);
    marquee.cancel();
    setPreview(
      fieldOperations.preview({
        action,
        sourceAssetId: entries[0].sourceAssetId,
        fieldIds: selectedFields.map(({ id }) => id),
        entries,
      }),
    );
  };
  const dismissDetails = () => {
    setExpanded(false);
    setSource('');
    setPage(0);
    setExclude([]);
    setOperationError(undefined);
    marquee.cancel();
    selection.replace([]);
  };
  const confirmExclusion = () => {
    if (!onExcludeFields) return;
    const { changedIds, skippedIds } = onExcludeFields(exclude);
    setResult({ changed: changedIds.length, skipped: skippedIds.length, action: 'excluded' });
    if (changedIds.length) dismissDetails();
    else setExclude([]);
  };

  if (!coverage.fields.length && !coverage.diagnostics.length) return null;
  const proposedCount = coverage.fields.filter(
    ({ status, id }) => status === 'pending' && proposed.has(id),
  ).length;
  const summary = [
    ...(Object.keys(counts) as (keyof typeof fieldStatuses)[])
      .filter(
        (status) =>
          !(hasAssetContext && status === 'pending') &&
          (counts[status] || (!reviewing && status !== 'pending' && status !== 'invalid')),
      )
      .map((status) => ({
        label: `${counts[status]} ${fieldStatuses[status].toLowerCase()}`,
        tone: fieldTones[status],
      })),
    ...(hasAssetContext
      ? [
          ...(counts.pending > proposedCount
            ? [{ label: `${counts.pending - proposedCount} unassigned`, tone: 'warning' as const }]
            : []),
          ...(proposedCount ? [{ label: `${proposedCount} proposed`, tone: 'info' as const }] : []),
        ]
      : []),
    ...(Object.keys(summarizedDiagnostics) as (keyof typeof diagnosticStatuses)[])
      .filter((kind) => summarizedDiagnostics[kind] && (!reviewing || kind !== 'transformed'))
      .map((kind) => ({
        label: `${summarizedDiagnostics[kind]} ${diagnosticStatuses[kind].toLowerCase()}`,
        tone: diagnosticTones[kind],
      })),
  ];
  return (
    <Card
      tone="default"
      paddingHorizontal="s"
      paddingVertical="xs"
      gap="xs"
      className="importer-coverage-card"
    >
      <Box flexDirection="row" alignItems="flex-start" gap="xs">
        <Box
          className="importer-coverage-summary"
          flexDirection="row"
          alignItems="center"
          flexWrap="wrap"
          gap="xs"
        >
          <Text variant="bodySmall" semibold className="importer-coverage-caption">
            {reviewing ? 'Source field coverage' : 'Planned source field coverage'}
          </Text>
          {summary.map(({ label, tone }) => (
            <Badge key={label} tone={tone} size="sm">
              {label}
            </Badge>
          ))}
          {!summary.length ? (
            <Text variant="bodySmall" color="gray">
              View source transformations.
            </Text>
          ) : null}
        </Box>
        <Box style={{ flexShrink: 0 }}>
          <Button
            title="Details"
            accessibilityLabel="View source field details"
            variant="plain"
            size="sm"
            minHeight={24}
            onPress={() => {
              setFilter(hasAssetContext ? 'unassigned' : '');
              setPage(0);
              setExpanded(true);
            }}
          />
        </Box>
      </Box>
      {result && !expanded ? (
        <Box role="status" flexDirection="row" alignItems="center" flexWrap="wrap" gap="xs">
          {typeof result === 'string' ? (
            <Text variant="bodySmall" className="importer-coverage-feedback">
              {result}
            </Text>
          ) : (
            <>
              <Badge tone="neutral" size="sm">
                {`${result.changed} ${result.action}`}
              </Badge>
              <Badge tone={result.skipped ? 'warning' : 'neutral'} size="sm">
                {`${result.skipped} skipped`}
              </Badge>
            </>
          )}
        </Box>
      ) : null}
      {preview && fieldOperations ? (
        <FieldOperationModal
          initialPreview={preview}
          fields={selectedFields}
          targets={reviewAssets ?? []}
          sourceNames={sources}
          operations={fieldOperations}
          onDismiss={() => {
            setPreview(undefined);
            setSource('');
            setPage(0);
            selection.replace([]);
          }}
          onResult={({ message }) => {
            setPreview(undefined);
            setSource('');
            setPage(0);
            setResult(message.startsWith('Fields organized.') ? undefined : message);
            selection.replace([]);
          }}
        />
      ) : (
        <BaseModal
          scrollBody={false}
          visible={expanded}
          title={
            exclude.length
              ? `Exclude ${exclude.length} unresolved ${exclude.length === 1 ? 'field' : 'fields'}?`
              : 'Source field details'
          }
          titleIcon={<Icon name={exclude.length ? 'ban' : 'list'} size={20} label="" />}
          onDismiss={dismissDetails}
          footer={
            exclude.length ? (
              <Box flexDirection="row" gap="s">
                <Button title="Cancel" variant="plain" onPress={() => setExclude([])} />
                <Button title="Confirm exclusion" color="danger" onPress={confirmExclusion} />
              </Box>
            ) : reviewing ? (
              <FieldSelectionActions
                count={selectedFields.length}
                canMove={canMove}
                canOrganize={canOrganize}
                organizeUnavailable={organizeUnavailable}
                canExclude={selectedFields.length > 0}
                moveUnavailable="Each selected entry needs a compatible asset"
                onClear={() => {
                  setOperationError(undefined);
                  selection.replace([]);
                }}
                onStart={fieldOperations ? startOperation : undefined}
                onExclude={
                  onExcludeFields ? () => setExclude(selectedFields.map(({ id }) => id)) : undefined
                }
              />
            ) : undefined
          }
        >
          {exclude.length ? (
            <Text variant="bodyRegular" color="gray">
              These fields will be left out of the staged plans.
            </Text>
          ) : (
            <Box gap="s" className="importer-coverage-body">
              <SourceFilter
                sources={sources}
                value={source}
                onChange={(value) => {
                  setSource(value);
                  setPage(0);
                  setResult(undefined);
                  setOperationError(undefined);
                  marquee.cancel();
                  selection.replace([]);
                }}
              />
              <ScrollableTabs
                label="Filter source fields"
                tabs={(
                  [
                    ['', 'All'],
                    ['unassigned', 'Unassigned'],
                    ['proposed', 'Proposed'],
                    ['pending', 'Pending'],
                    ['invalid', 'Invalid'],
                    ['excluded', 'Excluded'],
                    ['mapped', 'Mapped'],
                  ] as const
                )
                  .filter(([value]) =>
                    value === 'pending'
                      ? !hasAssetContext
                      : value === 'proposed' || value === 'unassigned'
                        ? hasAssetContext
                        : true,
                  )
                  .map(([value, label]) => ({
                    value,
                    label,
                    count:
                      value === 'unassigned'
                        ? unassigned.length
                        : value === 'proposed'
                          ? proposedFields.length
                          : value
                            ? sourceCounts[value]
                            : sourceFields.length + sourceDiagnostics.length,
                    accessibilityLabel: `Show ${label} fields`,
                  }))}
                value={filter}
                onChange={(value) => {
                  setFilter(value);
                  setPage(0);
                }}
              />
              {filter === 'unassigned' && unassigned.length > 0 ? (
                <Text variant="bodySmall" color="gray">
                  {unassignedFieldsExplanation}
                </Text>
              ) : null}
              {eligible.length && reviewing ? (
                <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="s">
                  {filteredIds.length ? (
                    <Box flexDirection="row" alignItems="center" gap="s">
                      <Checkbox
                        aria-label={`${selectAllLabel} in this filter`}
                        checked={allSelected}
                        mixed={!allSelected && selectedInFilter > 0}
                        readOnly
                        onClick={() => selection.toggleGroup(filteredIds)}
                      />
                      <Text variant="bodySmall">{selectAllLabel}</Text>
                    </Box>
                  ) : null}
                  <Tooltip content="Drag from the list margin to select fields. Ctrl/Cmd+drag adds fields. Ctrl/Cmd+click toggles individual fields, Shift+click selects a range, and Ctrl/Cmd+A selects all fields in this filter. Escape clears the selection.">
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
                </Box>
              ) : null}
              {operationError ? (
                <Text variant="bodySmall" color="danger120" role="alert">
                  {operationError}
                </Text>
              ) : null}
              {result || fieldOperations?.canUndo ? (
                <Box flexDirection="row" alignItems="center" flexWrap="wrap" gap="xs">
                  {result ? (
                    <Text variant="bodySmall" role="status">
                      {typeof result === 'string'
                        ? result
                        : `${result.changed} ${result.action} · ${result.skipped} skipped`}
                    </Text>
                  ) : null}
                  {fieldOperations?.canUndo ? (
                    <Button
                      title="Undo field changes"
                      size="sm"
                      variant="plain"
                      onPress={() => {
                        const outcome = fieldOperations.undo();
                        if (outcome.success) {
                          setResult(outcome.message);
                          setOperationError(undefined);
                        } else {
                          setOperationError(outcome.message);
                        }
                      }}
                    />
                  ) : null}
                </Box>
              ) : null}
              <Box
                ref={marquee.setContainerRef}
                className="importer-coverage-details"
                gap="xs"
                tabIndex={0}
                role="region"
                aria-label="Source field details"
              >
                {details
                  .slice(currentPage * pageSize, (currentPage + 1) * pageSize)
                  .map((detail) => (
                    <Box
                      key={detail.id}
                      flexDirection="row"
                      alignItems="flex-start"
                      gap="s"
                      padding="s"
                      borderWidth={1}
                      borderRadius="s"
                      borderColor="gray10"
                      backgroundColor={
                        selection.selectedIdsSet.has(detail.id) ? 'gray5' : undefined
                      }
                      dataSet={
                        reviewing && 'actionable' in detail && detail.actionable
                          ? { coverageFieldId: detail.id }
                          : undefined
                      }
                      onClick={(event: React.MouseEvent) => {
                        if (
                          reviewing &&
                          'actionable' in detail &&
                          detail.actionable &&
                          (event.ctrlKey || event.metaKey || event.shiftKey)
                        )
                          selection.toggle(detail.id, event.shiftKey);
                      }}
                    >
                      {reviewing ? (
                        <Box width={18} style={{ flexShrink: 0, paddingTop: 1 }}>
                          {'actionable' in detail && detail.actionable ? (
                            <Checkbox
                              aria-label={`${detail.name} from ${detail.source}`}
                              checked={selection.selectedIdsSet.has(detail.id)}
                              readOnly
                              onClick={(event) => selection.toggle(detail.id, event.shiftKey)}
                            />
                          ) : null}
                        </Box>
                      ) : null}
                      <Box flex={1} minWidth={0} gap="xxs">
                        <Text variant="bodySmall" semibold>
                          {detail.name}
                        </Text>
                        <Box
                          ref={(element) =>
                            element?.setAttribute('title', element.textContent ?? '')
                          }
                        >
                          <Text
                            variant="bodySmall"
                            color="gray"
                            className="importer-coverage-metadata"
                          >
                            {'entry' in detail ? `${detail.entry} · ` : ''}
                            {detail.source}
                            {'count' in detail && detail.count > 1
                              ? ` · ${detail.count} found`
                              : ''}
                          </Text>
                        </Box>
                        {'proposed' in detail && detail.proposed.length ? (
                          <Box
                            ref={(element) =>
                              element?.setAttribute('title', element.textContent ?? '')
                            }
                          >
                            <Text
                              variant="xSmall"
                              color="gray"
                              className="importer-coverage-metadata"
                            >
                              Proposed in {detail.proposed.join(' · ')}
                            </Text>
                          </Box>
                        ) : null}
                        {'destinations' in detail && detail.destinations.length ? (
                          <Text variant="xSmall" color="gray">
                            {detail.destinations.join(' · ')}
                          </Text>
                        ) : null}
                      </Box>
                      <Box alignItems="flex-end" gap="xs" style={{ flexShrink: 0 }}>
                        <Badge tone={detail.tone} size="sm">
                          {detail.status}
                        </Badge>
                        {onReviewMapping && 'reviewTargets' in detail
                          ? detail.reviewTargets.map((asset) => (
                              <Button
                                key={asset.id}
                                title={
                                  detail.reviewTargets.length > 1
                                    ? `Review ${asset.name}`
                                    : 'Review mapping'
                                }
                                size="sm"
                                variant="plain"
                                onPress={() => {
                                  setExpanded(false);
                                  marquee.cancel();
                                  selection.replace([]);
                                  onReviewMapping(asset);
                                }}
                              />
                            ))
                          : null}
                      </Box>
                    </Box>
                  ))}
                {!details.length ? (
                  <Text variant="bodySmall" color="gray">
                    No source fields match this filter.
                  </Text>
                ) : null}
              </Box>
              <Box flexDirection="row" gap="s">
                <Button
                  title="Previous fields"
                  variant="plain"
                  size="sm"
                  disabled={currentPage === 0}
                  onPress={() => setPage(currentPage - 1)}
                />
                <Button
                  title="More fields"
                  variant="plain"
                  size="sm"
                  disabled={(currentPage + 1) * pageSize >= details.length}
                  onPress={() => setPage(currentPage + 1)}
                />
              </Box>
            </Box>
          )}
        </BaseModal>
      )}
    </Card>
  );
}
