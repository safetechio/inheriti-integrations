import { useId, useMemo, useRef, useState } from 'react';
import {
  BaseModal,
  Box,
  Button,
  Checkbox,
  FormSelect,
  Icon,
  ScrollableTabs,
  Text,
  Tooltip,
} from '@main-components';
import { useMarqueeSelection } from '@modules/_shared/ui/hooks/use-marquee-selection';
import { getAssetTypeDisplayName } from '@modules/_shared/domain/asset-type-display-name';
import type { SourceCoverageField } from '@modules/mapping/application/source-coverage';
import type {
  FieldOperationControls,
  FieldOperationGroup,
  FieldOperationPreview,
  FieldOperationRequest,
  FieldOperationResult,
} from '../../field-operations';
import { applySelectedFieldLayout } from '../../selected-field-layout';
import { useModalSelectionShortcuts } from '../../hooks/use-modal-selection-shortcuts';
import { useReviewSelection } from '../../hooks/use-review-selection';
import { hasIncludedSchemaField, type ReviewAsset } from '../../types';
import { FieldOperationGroupEditor } from '../FieldOperationGroupEditor';
import { CompactEntryRow } from './components/CompactEntryRow';
import { OperationErrors } from './components/OperationErrors';

const titles = {
  detect: 'Create assets',
  create: 'Create assets',
  suggest: 'Create assets',
  move: 'Assign fields to an asset',
  'plain-text': 'Keep as protected text',
  'duplicate-text': 'Create a Plain Text copy',
};

const titleIcons = {
  detect: 'plus',
  create: 'plus',
  suggest: 'plus',
  move: 'arrow-right-arrow-left',
  'plain-text': 'lock',
  'duplicate-text': 'copy',
};

export function fieldOperationTargets(assets: ReviewAsset[], origin: ReviewAsset): ReviewAsset[] {
  return assets.filter(
    (target) =>
      target.sourceId === origin.sourceId &&
      target.sourceNodeId === origin.sourceNodeId &&
      target.status !== 'excluded' &&
      !target.plainTextValue &&
      (target.type === 'PLAIN-TEXT'
        ? target.id !== origin.id
        : target.schemaFields?.some(
            ({ key, sourceFieldId }) => key.startsWith('secret.') && !sourceFieldId,
          )),
  );
}

const pageSize = 20;

export function FieldOperationModal({
  initialPreview,
  fields,
  targets,
  sourceNames,
  operations,
  onDismiss,
  onResult,
}: {
  initialPreview: FieldOperationPreview;
  fields: SourceCoverageField[];
  targets: ReviewAsset[];
  sourceNames?: ReadonlyMap<string, string>;
  operations: FieldOperationControls;
  onDismiss: () => void;
  onResult: (result: FieldOperationResult) => void;
}) {
  const [preview, setPreview] = useState(initialPreview);
  const [commitError, setCommitError] = useState<string>();
  const nextGroup = useRef(0);
  const [limit, setLimit] = useState(pageSize);
  const [expandedEntry, setExpandedEntry] = useState<string>();
  const editedEntries = useRef(new Set<string>());
  const [layoutScopeRestricted, setLayoutScopeRestricted] = useState(false);
  const [layoutFeedback, setLayoutFeedback] = useState<string>();
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const repeatHintId = useId();
  const { action, operationId } = preview.request;
  const { groups, entries } = preview;
  const explicit = Boolean(preview.request.entries);
  const creating = action === 'create' || action === 'suggest' || action === 'detect';
  const compact = explicit && (entries?.length ?? 0) > 1 && creating;
  const creationCount = compact ? groups.length : 0;
  const defaultPlainText =
    compact &&
    groups.length === entries?.length &&
    groups.every(
      ({ type, fieldBindings }) =>
        type === 'PLAIN-TEXT' && Boolean(fieldBindings['secret.text']?.length),
    );
  const [selectedSource, setSelectedSource] = useState('');
  const sourceTabs = useMemo(() => {
    const sources = new Map<string, { value: string; label: string; count: number }>();
    for (const entry of entries ?? []) {
      const source = sources.get(entry.sourceId) ?? {
        value: entry.sourceId,
        label: sourceNames?.get(entry.sourceId) ?? 'Source',
        count: 0,
      };
      source.count += 1;
      sources.set(entry.sourceId, source);
    }
    return [...sources.values()];
  }, [entries, sourceNames]);
  const activeSource = sourceTabs.some(({ value }) => value === selectedSource)
    ? selectedSource
    : '';
  const allSourceTabs = [{ value: '', label: 'All', count: entries?.length ?? 0 }, ...sourceTabs];
  const selectedIds = new Set(fields.map(({ id }) => id));
  const assignedIds = new Set(
    groups.flatMap(({ fieldBindings }) =>
      Object.values(fieldBindings)
        .flat()
        .filter((id) => selectedIds.has(id)),
    ),
  );
  const remainingCount = selectedIds.size - assignedIds.size;
  const groupsByNode = useMemo(() => {
    const index = new Map<string, FieldOperationGroup[]>();
    for (const group of groups) {
      const siblings = index.get(group.nodeId) ?? [];
      siblings.push(group);
      index.set(group.nodeId, siblings);
    }
    return index;
  }, [groups]);
  const { targetsById, targetsByNode } = useMemo(() => {
    const targetsById = new Map<string, ReviewAsset>();
    const targetsByNode = new Map<string, ReviewAsset[]>();
    for (const target of targets) {
      targetsById.set(target.id, target);
      if (!target.sourceNodeId) continue;
      const siblings = targetsByNode.get(target.sourceNodeId) ?? [];
      siblings.push(target);
      targetsByNode.set(target.sourceNodeId, siblings);
    }
    return { targetsById, targetsByNode };
  }, [targets]);
  const assetsById = useMemo(
    () => new Map(preview.assets.map((asset) => [asset.id, asset])),
    [preview.assets],
  );
  const emptyTextGroupMessages = new Set(
    (entries ?? [{ name: '', nodeId: fields[0]?.nodeId }]).flatMap(({ name, nodeId }) =>
      (nodeId ? (groupsByNode.get(nodeId) ?? []) : groups).flatMap(
        ({ type, fieldBindings }, index) =>
          creating && type === 'PLAIN-TEXT' && !Object.keys(fieldBindings).length
            ? [`${name ? `${name}: ` : ''}Map valid source fields in destination ${index + 1}.`]
            : [],
      ),
    ),
  );
  const assetTypes =
    operations.assetTypes ??
    preview.assets.flatMap(({ type, alternatives }) => [type, ...alternatives]);
  const repeatLabel =
    preview.compatibleEntryCount > 1
      ? `Apply to ${preview.compatibleEntryCount} compatible entries`
      : 'Apply to compatible entries';
  const update = (updates: Partial<FieldOperationRequest>) => {
    setCommitError(undefined);
    setLayoutFeedback(undefined);
    setPreview(operations.preview({ ...preview.request, ...updates }));
  };
  const updateGroups = (groups: FieldOperationGroup[]) => update({ groups });
  const addGroup = (nodeId?: string) => {
    if (!nodeId || !operationId) return;
    editedEntries.current.add(nodeId);
    const groupNumber = ++nextGroup.current;
    update({
      groups: [
        ...groups,
        {
          id: `${nodeId}:ASSET-${operationId}-extra-${groupNumber}`,
          nodeId,
          type: 'PLAIN-TEXT',
          name: '',
          automaticName: true,
          fieldBindings: {},
        },
      ],
    });
  };

  const targetSelect = (
    label: string,
    originId: string,
    targetId: string | undefined,
    options: ReviewAsset[],
    onChange: (id: string) => void,
  ) => (
    <FormSelect
      label={label}
      value={targetId ?? ''}
      options={options.map(({ id, name, type }) => ({
        value: id,
        label: `${id === originId ? 'This asset — ' : ''}${name} · ${getAssetTypeDisplayName(type)}`,
      }))}
      onChange={onChange}
    />
  );

  const renderGroup = (group: FieldOperationGroup, groupFields: SourceCoverageField[]) => {
    const siblingGroups = groupsByNode.get(group.nodeId) ?? [];
    const reservedSourceIds = new Set(
      siblingGroups
        .filter(({ id }) => id !== group.id)
        .flatMap(({ fieldBindings }) => Object.values(fieldBindings).flat()),
    );
    const target = targetsById.get(group.id);
    if (action === 'move') {
      for (const { sourceFieldId } of target?.schemaFields ?? []) {
        if (sourceFieldId) reservedSourceIds.add(sourceFieldId);
      }
    }
    const asset = assetsById.get(group.id) ?? target;
    return (
      <FieldOperationGroupEditor
        key={group.id}
        group={group}
        assetTypes={assetTypes}
        schemaFields={asset?.schemaFields ?? operations.schemaFields?.(group.type) ?? []}
        fields={groupFields}
        reservedSourceIds={reservedSourceIds}
        move={action === 'move'}
        fixedType={action === 'plain-text'}
        onChange={(next) => {
          editedEntries.current.add(group.nodeId);
          updateGroups(groups.map((item) => (item.id === next.id ? next : item)));
        }}
        onRemove={
          creating && siblingGroups.length > 1
            ? () => {
                editedEntries.current.add(group.nodeId);
                updateGroups(groups.filter(({ id }) => id !== group.id));
              }
            : undefined
        }
      />
    );
  };

  const changeEntryTarget = (sourceAssetId: string, nodeId: string, targetAssetId: string) => {
    const entries = preview.request.entries?.map((entry) =>
      entry.sourceAssetId === sourceAssetId ? { ...entry, targetAssetId } : entry,
    );
    if (!preview.request.groups) {
      update({ entries });
      return;
    }
    const reset = operations.preview({ ...preview.request, entries, groups: undefined });
    update({
      entries: reset.request.entries,
      groups: reset.groups.map((group) =>
        group.nodeId === nodeId ? group : (groupsByNode.get(group.nodeId)?.[0] ?? group),
      ),
    });
  };

  const fieldsById = useMemo(() => new Map(fields.map((field) => [field.id, field])), [fields]);
  const scopedEntries = (entries ?? []).filter(
    ({ sourceId }) => !activeSource || sourceId === activeSource,
  );
  const compactEntries = compact ? scopedEntries.slice(0, limit) : [];
  const layoutSelection = useReviewSelection(
    (entries ?? []).map(({ sourceAssetId: id }) => ({ id })),
    scopedEntries.map(({ sourceAssetId: id }) => ({ id })),
  );
  const entryMarquee = useMarqueeSelection({
    selectedIds: layoutSelection.selectedIds,
    onSelect: (ids) => {
      setLayoutScopeRestricted(true);
      layoutSelection.replace(ids);
    },
    resetKey: JSON.stringify([activeSource, limit, expandedEntry]),
    rowSelector: '[data-field-operation-entry-id]',
    getRowIds: (row) =>
      row.dataset.fieldOperationEntryId ? [row.dataset.fieldOperationEntryId] : [],
    excludeSelector: '.field-operation-entry-editor',
  });
  useModalSelectionShortcuts({
    enabled: compact,
    title: 'Create assets',
    canSelectAll: scopedEntries.length > 0,
    canClear: false,
    onSelectAll: () => {
      setLayoutScopeRestricted(true);
      layoutSelection.replace(scopedEntries.map(({ sourceAssetId }) => sourceAssetId));
    },
    onClear: () => {},
  });
  const needsPlainTextGrouping = (nodeId: string, fieldIds: string[]) => {
    const [first, ...others] = groupsByNode.get(nodeId) ?? [];
    const plainTextIds = first?.fieldBindings['secret.text'];
    return (
      others.length > 0 ||
      first?.type !== 'PLAIN-TEXT' ||
      !Array.isArray(plainTextIds) ||
      plainTextIds.length !== fieldIds.length ||
      fieldIds.some((id) => !plainTextIds.includes(id))
    );
  };
  const groupAsPlainText = (entryFields: { nodeId: string; fieldIds: string[] }[]) => {
    if (!operationId) return;
    const affected = new Set(entryFields.map(({ nodeId }) => nodeId));
    const regrouped = entryFields.map(({ nodeId, fieldIds }) => {
      editedEntries.current.add(nodeId);
      const textGroup = groupsByNode.get(nodeId)?.find(({ type }) => type === 'PLAIN-TEXT');
      return {
        id: textGroup?.id ?? `${nodeId}:ASSET-${operationId}-extra-${++nextGroup.current}`,
        nodeId,
        type: 'PLAIN-TEXT',
        name: textGroup?.name ?? '',
        automaticName: textGroup?.automaticName ?? true,
        fieldBindings: { 'secret.text': fieldIds },
      };
    });
    updateGroups([...groups.filter(({ nodeId }) => !affected.has(nodeId)), ...regrouped]);
  };
  const plainTextEntries = scopedEntries.filter(
    ({ sourceAssetId, nodeId, fieldIds }) =>
      (!layoutScopeRestricted || layoutSelection.selectedIdsSet.has(sourceAssetId)) &&
      needsPlainTextGrouping(nodeId, fieldIds),
  );
  const hasGlobalError = preview.errors.some((error) => !error.includes(': '));
  let entrySlots = 0;
  const entrySections = (compact ? compactEntries : scopedEntries).flatMap((entry, index) => {
    const { nodeId, sourceId, sourceAssetId, name, targetAssetId, fieldIds } = entry;
    const entryGroups = groupsByNode.get(nodeId) ?? [];
    const availableSlots = compact ? Number.POSITIVE_INFINITY : limit - entrySlots;
    entrySlots += Math.max(1, entryGroups.length);
    if (availableSlots <= 0) return [];

    const label = `${name} · ${sourceNames?.get(sourceId) ?? 'Source'}`;
    const rowName = activeSource ? name : label;
    const expanded = expandedEntry === sourceAssetId;
    const assignedCount = fieldIds.filter((id) => assignedIds.has(id)).length;
    const assetSummary =
      entryGroups.length === 1
        ? getAssetTypeDisplayName(entryGroups[0].type)
        : `${entryGroups.length} assets`;
    const entryError = entryGroups.flatMap(({ id }) => preview.groupErrors?.[id] ?? []).join(' ');
    const ready =
      !hasGlobalError &&
      !entryError &&
      entryGroups.length > 0 &&
      entryGroups.every(({ id }) => {
        const asset = assetsById.get(id);
        return asset && hasIncludedSchemaField(asset);
      });
    const status =
      assignedCount < fieldIds.length
        ? 'Needs fields'
        : entryError
          ? 'Review fields'
          : ready
            ? 'Ready'
            : 'Not checked';
    const row = compact ? (
      <CompactEntryRow
        name={rowName}
        error={entryError}
        entryId={sourceAssetId}
        type={entryGroups.length === 1 ? entryGroups[0].type : undefined}
        typeLabel={assetSummary}
        fieldSummary={`${assignedCount}/${fieldIds.length} ${fieldIds.length === 1 ? 'field' : 'fields'} assigned`}
        status={status}
        expanded={expanded}
        selected={layoutSelection.selectedIdsSet.has(sourceAssetId)}
        onEdit={() => setExpandedEntry(expanded ? undefined : sourceAssetId)}
        onSelect={(range) => {
          setLayoutScopeRestricted(true);
          layoutSelection.toggle(sourceAssetId, range);
        }}
        rowRef={(node) => {
          if (node) rowRefs.current.set(sourceAssetId, node);
          else rowRefs.current.delete(sourceAssetId);
        }}
        onNavigate={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            const next = compactEntries[index + (event.key === 'ArrowUp' ? -1 : 1)];
            if (next) rowRefs.current.get(next.sourceAssetId)?.focus();
          }
        }}
      />
    ) : null;
    if (compact && !expanded) return [<Box key={sourceAssetId}>{row}</Box>];
    const groupFields = fieldIds.flatMap((id) => {
      const field = fieldsById.get(id);
      return field?.sourceId === sourceId && field.nodeId === nodeId ? [field] : [];
    });
    const origin = targetsById.get(sourceAssetId);
    const layout =
      compact && expanded && operationId
        ? applySelectedFieldLayout({
            templateNodeId: nodeId,
            operationId,
            entries: entries ?? [],
            groups,
            fields,
            validGroupIds: preview.assets.filter(hasIncludedSchemaField).map(({ id }) => id),
            targetNodeIds: (layoutScopeRestricted
              ? (entries ?? []).filter(({ sourceAssetId }) =>
                  layoutSelection.selectedIdsSet.has(sourceAssetId),
                )
              : scopedEntries
            )
              .filter((entry) => entry.sourceId === sourceId)
              .map(({ nodeId }) => nodeId),
            editedNodeIds: editedEntries.current,
          })
        : undefined;
    return [
      <Box key={sourceAssetId} gap="s">
        {row ?? (
          <Box
            flexDirection="row"
            alignItems="center"
            justifyContent="space-between"
            gap="s"
            flexWrap="wrap"
          >
            <Text variant="bodySmall" semibold accessibilityRole="heading">
              {rowName}
            </Text>
            <Text variant="bodySmall" color="gray">
              {assignedCount}/{fieldIds.length} {fieldIds.length === 1 ? 'field' : 'fields'}{' '}
              assigned
            </Text>
          </Box>
        )}
        <Box gap="s" className="field-operation-entry-editor">
          {action === 'move' && origin
            ? targetSelect(
                `Target asset for ${label}`,
                sourceAssetId,
                targetAssetId,
                fieldOperationTargets(targetsByNode.get(nodeId) ?? [], origin),
                (id) => changeEntryTarget(sourceAssetId, nodeId, id),
              )
            : null}
          {entryGroups.slice(0, availableSlots).map((group) => renderGroup(group, groupFields))}
          {creating && entryGroups.length > 0 && entryGroups.length <= availableSlots ? (
            <Button
              title={`Add asset group for ${label}`}
              size="sm"
              variant="outlined"
              onPress={() => {
                if (!compact) setLimit((current) => current + 1);
                addGroup(nodeId);
              }}
            />
          ) : null}
          {creating && needsPlainTextGrouping(nodeId, fieldIds) ? (
            <Button
              title={compact ? `Group as Plain Text for ${label}` : 'Group as Plain Text'}
              size="sm"
              variant="plain"
              onPress={() => groupAsPlainText([entry])}
            />
          ) : null}
          {layout ? (
            <Box gap="xs">
              <Tooltip content="Apply this field distribution to matching entries in this source. Field names must be unique; each entry keeps its own values. Manually edited entries are kept. Select rows to limit the targets.">
                <Button
                  title={`Apply layout to ${layout.matchedNodeIds.length} matching ${layout.matchedNodeIds.length === 1 ? 'entry' : 'entries'}`}
                  size="sm"
                  variant="outlined"
                  disabled={!layout.matchedNodeIds.length}
                  onPress={() => {
                    updateGroups(layout.groups);
                    const reasons = new Map<string, number>();
                    for (const { reason } of layout.skipped)
                      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
                    const reasonLabels: Record<string, string> = {
                      edited: 'kept manual changes',
                      'missing-field': 'had different fields',
                      'ambiguous-field': 'had ambiguous field names',
                      'different-source': 'belonged to other sources',
                      'invalid-template': 'needed a complete layout',
                    };
                    setLayoutFeedback(
                      `Layout applied to ${layout.matchedNodeIds.length} ${layout.matchedNodeIds.length === 1 ? 'entry' : 'entries'}${layout.skipped.length ? ` · ${[...reasons].map(([reason, count]) => `${count} ${reasonLabels[reason]}`).join(' · ')}` : ''}. Review the preview before creating.`,
                    );
                  }}
                />
              </Tooltip>
              {remainingCount > 0 ? (
                <Text variant="bodySmall" color="gray">
                  {remainingCount}{' '}
                  {remainingCount === 1
                    ? 'selected field remains in its original entry'
                    : 'selected fields remain in their original entries'}{' '}
                  until assigned.
                </Text>
              ) : null}
            </Box>
          ) : null}
        </Box>
      </Box>,
    ];
  });

  const scopeSummary = (
    <Box gap="xxs" role="status">
      <Text variant="bodySmall">
        {preview.affectedEntryCount === 1 && !preview.request.repeatCompatible
          ? 'Selected entry only'
          : `${preview.affectedEntryCount} ${preview.affectedEntryCount === 1 ? 'entry' : 'entries'} affected`}
        {preview.request.repeatCompatible && preview.skippedEntryCount > 0
          ? ` · ${preview.skippedEntryCount} skipped`
          : ''}
      </Text>
      {action !== 'duplicate-text' && remainingCount > 0 ? (
        <Text variant="bodySmall" color="gray">
          {remainingCount} {remainingCount === 1 ? 'field stays' : 'fields stay'} in{' '}
          {explicit && (entries?.length ?? 0) > 1 ? 'their original entries' : 'the original entry'}
          .
        </Text>
      ) : null}
    </Box>
  );

  return (
    <BaseModal
      visible
      maxWidth={explicit ? 840 : 640}
      bodyScrollRef={compact ? entryMarquee.setContainerRef : undefined}
      title={titles[action]}
      titleIcon={<Icon name={titleIcons[action]} type="font-awesome-6" size={20} label="" />}
      description={
        action === 'duplicate-text'
          ? 'Copy the entire edited value as protected Plain Text.'
          : defaultPlainText
            ? 'One Plain Text asset per entry. Review or split any entry before creating.'
            : creating
              ? 'Review the proposed assets, group fields as Plain Text, or split fields across assets.'
              : `Review where to store ${fields.length} selected ${fields.length === 1 ? 'field' : 'fields'}.`
      }
      onDismiss={onDismiss}
      bodyHeader={
        action !== 'duplicate-text' && sourceTabs.length > 1 ? (
          <Box paddingHorizontal="l" paddingVertical="s">
            <ScrollableTabs
              label="Field operation sources"
              tabs={allSourceTabs}
              value={activeSource ?? ''}
              scrollLabel="sources"
              onChange={(value) => {
                setSelectedSource(value);
                setLimit(pageSize);
              }}
            />
          </Box>
        ) : undefined
      }
      footer={
        <>
          {action !== 'duplicate-text' ? (
            <Box flex={1} minWidth={0} justifyContent="center" aria-live="polite">
              <Text variant="bodySmall" semibold>
                {assignedIds.size}/{selectedIds.size} {selectedIds.size === 1 ? 'field' : 'fields'}{' '}
                assigned
                {explicit && entries?.length
                  ? ` · ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`
                  : ''}
                {compact
                  ? ` · ${creationCount} ${creationCount === 1 ? 'asset' : 'assets'} to create`
                  : ''}
              </Text>
            </Box>
          ) : null}
          <Button title="Cancel" size="sm" variant="outlined" onPress={onDismiss} />
          <Button
            title={
              compact
                ? `Create ${creationCount} ${creationCount === 1 ? 'asset' : 'assets'}`
                : 'Confirm'
            }
            size="sm"
            disabled={!preview.canConfirm}
            onPress={() => {
              const result = operations.commit(preview);
              if (result.success) onResult(result);
              else setCommitError(result.message);
            }}
          />
        </>
      }
    >
      <OperationErrors
        errors={[...new Set(preview.errors)].filter(
          (error) => compact || !emptyTextGroupMessages.has(error),
        )}
        entryNames={(entries ?? []).map(({ name }) => name)}
      />
      {explicit ? (
        <>
          {compact ? (
            <Box flexDirection="row" gap="xs" alignItems="center" flexWrap="wrap">
              <Text variant="bodySmall" color="gray">
                {layoutScopeRestricted
                  ? `${layoutSelection.selectedIds.length} ${layoutSelection.selectedIds.length === 1 ? 'entry' : 'entries'} selected for layout`
                  : 'Edit an entry to split fields. Select rows to limit where a layout is applied.'}
              </Text>
              {layoutSelection.selectedIds.length ? (
                <Button
                  title="Clear layout selection"
                  size="sm"
                  variant="plain"
                  onPress={() => {
                    setLayoutScopeRestricted(true);
                    layoutSelection.replace([]);
                  }}
                />
              ) : null}
              {layoutScopeRestricted ? (
                <Button
                  title="Use all matching entries"
                  size="sm"
                  variant="plain"
                  onPress={() => {
                    layoutSelection.replace([]);
                    setLayoutScopeRestricted(false);
                  }}
                />
              ) : null}
            </Box>
          ) : null}
          {compact && plainTextEntries.length ? (
            <Button
              title="Group entries as Plain Text"
              size="sm"
              variant="outlined"
              onPress={() => groupAsPlainText(plainTextEntries)}
            />
          ) : null}
          {layoutFeedback ? (
            <Text variant="bodySmall" role="status">
              {layoutFeedback}
            </Text>
          ) : null}
          {entrySections}
          {(compact ? scopedEntries.length : entrySlots) > limit ? (
            <Button
              title="Show more entries and groups"
              size="sm"
              variant="outlined"
              onPress={() => setLimit(limit + pageSize)}
            />
          ) : null}
        </>
      ) : (
        <>
          {action === 'move'
            ? targetSelect(
                'Target asset',
                preview.request.sourceAssetId,
                preview.request.targetAssetId,
                targets,
                (targetAssetId) => update({ targetAssetId, groups: undefined }),
              )
            : null}
          {action !== 'duplicate-text' ? groups.map((group) => renderGroup(group, fields)) : null}
          {creating && fields[0] ? (
            <Box flexDirection="row" gap="s" flexWrap="wrap">
              {needsPlainTextGrouping(fields[0].nodeId, preview.request.fieldIds) ? (
                <Button
                  title="Group as Plain Text"
                  size="sm"
                  variant="outlined"
                  onPress={() =>
                    groupAsPlainText([
                      {
                        nodeId: fields[0].nodeId,
                        fieldIds: preview.request.fieldIds,
                      },
                    ])
                  }
                />
              ) : null}
              <Button
                title="Add asset group"
                size="sm"
                variant="outlined"
                onPress={() => addGroup(fields[0].nodeId)}
              />
            </Box>
          ) : null}
        </>
      )}
      {!explicit ? (
        <Box gap="s" padding="m" borderWidth={1} borderColor="gray10" borderRadius="s">
          <Text variant="bodySmall" semibold accessibilityRole="heading">
            Where this applies
          </Text>
          {!explicit && action !== 'move' && action !== 'duplicate-text' && action !== 'detect' ? (
            <Box flexDirection="row" alignItems="flex-start" gap="s">
              <Checkbox
                aria-label={repeatLabel}
                aria-describedby={repeatHintId}
                checked={Boolean(preview.request.repeatCompatible)}
                readOnly
                onClick={() => update({ repeatCompatible: !preview.request.repeatCompatible })}
              />
              <Box flex={1} minWidth={0} gap="s">
                <Box gap="xs">
                  <Text variant="bodySmall" semibold>
                    {repeatLabel}
                  </Text>
                  <Text variant="bodySmall" color="gray" nativeID={repeatHintId}>
                    Repeat these field choices in entries with matching field names from this
                    source. Each entry keeps its own values.
                  </Text>
                </Box>
                {scopeSummary}
              </Box>
            </Box>
          ) : (
            scopeSummary
          )}
        </Box>
      ) : null}
      {commitError ? (
        <Text variant="bodySmall" color="danger120" role="alert">
          {commitError}
        </Text>
      ) : null}
    </BaseModal>
  );
}
