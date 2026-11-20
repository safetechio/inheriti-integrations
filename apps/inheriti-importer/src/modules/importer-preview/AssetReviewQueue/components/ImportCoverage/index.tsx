import { useMemo, useState } from 'react';
import { BaseModal, Box, Button, Card, Checkbox, Text } from '@main-components';
import { getAssetFieldDisplayName } from '@modules/_shared/domain/asset-field-display-name';
import type { ReviewBatchResult } from '../../types';
import type { SourceCoverage as Coverage } from '@modules/mapping/application/source-coverage';

const fieldStatuses = {
  mapped: 'Mapped',
  protected: 'Protected text',
  excluded: 'Excluded',
  pending: 'Pending',
  invalid: 'Invalid',
};
const diagnosticStatuses = {
  unsupported: 'Unsupported',
  skipped: 'Skipped by parser',
  transformed: 'Transformed',
};
const pageSize = 20;

export function ImportCoverage({
  coverage,
  sourceNames,
  assetNames,
  onPreserveFields,
  onExcludeFields,
}: {
  coverage: Coverage;
  sourceNames: ReadonlyMap<string, string>;
  assetNames: ReadonlyMap<string, string>;
  onPreserveFields?: (ids: string[]) => ReviewBatchResult;
  onExcludeFields?: (ids: string[]) => ReviewBatchResult;
}) {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<keyof typeof fieldStatuses | ''>('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [exclude, setExclude] = useState<string[]>([]);
  const [result, setResult] = useState<string>();
  const { counts, pendingIds } = useMemo(() => {
    const counts = { mapped: 0, protected: 0, excluded: 0, pending: 0, invalid: 0 };
    const pendingIds: string[] = [];
    for (const field of coverage.fields) {
      counts[field.status]++;
      if (field.status === 'pending' || field.status === 'invalid') pendingIds.push(field.id);
    }
    return { counts, pendingIds };
  }, [coverage.fields]);
  const details = useMemo(() => {
    if (!expanded) return [];
    const fields = coverage.fields
      .filter((field) => !filter || field.status === filter)
      .map((field) => ({
        id: field.id,
        actionable: field.status === 'pending' || field.status === 'invalid',
        name: field.name,
        source: sourceNames.get(field.sourceId) ?? 'Source',
        status: fieldStatuses[field.status],
        destinations: field.destinations.map(({ assetId, fieldId }) => {
          const asset = assetNames.get(assetId);
          const field = getAssetFieldDisplayName(fieldId);
          return asset ? `${asset} · ${field}` : field;
        }),
      }));
    return filter
      ? fields
      : [
          ...coverage.diagnostics.map((diagnostic, index) => ({
            id: `diagnostic:${diagnostic.sourceId}:${index}`,
            name: diagnostic.message,
            source: sourceNames.get(diagnostic.sourceId) ?? 'Source',
            status: diagnosticStatuses[diagnostic.kind],
            count: diagnostic.count,
          })),
          ...fields,
        ];
  }, [expanded, coverage, filter, sourceNames, assetNames]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(details.length / pageSize) - 1));
  const summarizedDiagnostics = coverage.diagnostics.reduce(
    (summary, { kind, count }) => {
      summary[kind] += count;
      return summary;
    },
    { unsupported: 0, skipped: 0, transformed: 0 },
  );
  const selectedPending = pendingIds.filter((id) => selected.includes(id));
  const actionIds = selectedPending.length ? selectedPending : pendingIds;
  const report = (outcome: ReviewBatchResult, action: string) => {
    setResult(`${outcome.changedIds.length} ${action} · ${outcome.skippedIds.length} skipped`);
    setSelected([]);
  };

  if (!coverage.fields.length && !coverage.diagnostics.length) return null;
  const reviewing = Boolean(onPreserveFields || onExcludeFields);
  const summary = [
    ...Object.entries(counts)
      .filter(
        ([status, count]) => count || (!reviewing && status !== 'pending' && status !== 'invalid'),
      )
      .map(
        ([status, count]) =>
          `${count} ${fieldStatuses[status as keyof typeof fieldStatuses].toLowerCase()}`,
      ),
    summarizedDiagnostics.unsupported ? `${summarizedDiagnostics.unsupported} unsupported` : '',
    summarizedDiagnostics.skipped ? `${summarizedDiagnostics.skipped} skipped by parser` : '',
    !reviewing && summarizedDiagnostics.transformed
      ? `${summarizedDiagnostics.transformed} transformed`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Card tone="default" padding="s" className="importer-coverage-card">
      <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap="xs">
        <Text variant="bodySmall" semibold className="importer-coverage-caption">
          {reviewing ? 'Source field coverage' : 'Planned source field coverage'}
        </Text>
        <Button
          title="Details"
          accessibilityLabel="View source field details"
          variant="plain"
          size="sm"
          minHeight={24}
          onPress={() => setExpanded(true)}
        />
      </Box>
      <Text variant="bodySmall" color="gray" className="importer-coverage-caption">
        {summary || 'View source transformations.'}
      </Text>
      <BaseModal
        visible={expanded}
        title={
          exclude.length
            ? `Exclude ${exclude.length} unresolved ${exclude.length === 1 ? 'field' : 'fields'}?`
            : 'Source field details'
        }
        onDismiss={() => {
          setExpanded(false);
          setExclude([]);
          setSelected([]);
        }}
        footer={
          exclude.length ? (
            <Box flexDirection="row" gap="s">
              <Button title="Cancel" variant="plain" onPress={() => setExclude([])} />
              <Button
                title="Confirm exclusion"
                color="danger"
                onPress={() => {
                  if (onExcludeFields) report(onExcludeFields(exclude), 'excluded');
                  setExclude([]);
                }}
              />
            </Box>
          ) : (
            <Button
              title="Done"
              variant="outlined"
              onPress={() => {
                setExpanded(false);
                setSelected([]);
              }}
            />
          )
        }
      >
        {exclude.length ? (
          <Text variant="bodyRegular" color="gray">
            These fields will be left out of the staged plans.
          </Text>
        ) : (
          <Box gap="xs">
            <Box flexDirection="row" alignItems="center" flexWrap="wrap" gap="s">
              <select
                className="asset-type-select importer-coverage-filter"
                aria-label="Filter source field coverage"
                value={filter}
                onChange={(event) => {
                  const value = event.target.value;
                  if (!value || Object.hasOwn(fieldStatuses, value)) {
                    setFilter(value as typeof filter);
                    setPage(0);
                  }
                }}
              >
                <option value="">All fields and source warnings</option>
                {Object.entries(fieldStatuses).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label} ({counts[value as keyof typeof counts]})
                  </option>
                ))}
              </select>
              {pendingIds.length && onPreserveFields ? (
                <Button
                  title="Preserve as protected text"
                  size="sm"
                  variant="outlined"
                  onPress={() => report(onPreserveFields(actionIds), 'preserved')}
                />
              ) : null}
              {pendingIds.length && onExcludeFields ? (
                <Button
                  title="Exclude fields"
                  size="sm"
                  variant="plain"
                  color="danger"
                  onPress={() => setExclude(actionIds)}
                />
              ) : null}
            </Box>
            {pendingIds.length && reviewing ? (
              <Text variant="bodySmall" color="gray">
                {selectedPending.length
                  ? `${selectedPending.length} unresolved fields selected`
                  : `Select individual fields or apply an action to all ${pendingIds.length} unresolved fields.`}
              </Text>
            ) : null}
            {result ? (
              <Text variant="bodySmall" role="status">
                {result}
              </Text>
            ) : null}
            <Box
              className="importer-coverage-details"
              gap="xs"
              tabIndex={0}
              role="region"
              aria-label="Source field details"
            >
              {details.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map((detail) => (
                <Box key={detail.id} gap="xxs">
                  <Box flexDirection="row" alignItems="center" gap="xs">
                    {reviewing && 'actionable' in detail && detail.actionable ? (
                      <Checkbox
                        aria-label={`${detail.name} from ${detail.source}`}
                        checked={selected.includes(detail.id)}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setSelected((previous) =>
                            checked
                              ? [...previous, detail.id]
                              : previous.filter((id) => id !== detail.id),
                          );
                        }}
                      />
                    ) : null}
                    <Text variant="bodySmall" semibold>
                      {detail.name}
                    </Text>
                  </Box>
                  <Text variant="bodySmall" color="gray">
                    {detail.source} · {detail.status}
                    {'count' in detail ? ` · ${detail.count}` : ''}
                  </Text>
                  {'destinations' in detail && detail.destinations.length ? (
                    <Text variant="bodySmall" color="gray">
                      {detail.destinations.join(' · ')}
                    </Text>
                  ) : null}
                </Box>
              ))}
              {!details.length ? (
                <Text variant="bodySmall" color="gray">
                  No source fields match this filter.
                </Text>
              ) : null}
            </Box>
            {details.length > pageSize ? (
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
            ) : null}
          </Box>
        )}
      </BaseModal>
    </Card>
  );
}
