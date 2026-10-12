import { useEffect, useState } from 'react';
import { getPlanAssetIconName } from '@modules/plans/domain/asset-metadata';
import { getAssetTypeDisplayName } from '@modules/_shared/domain/asset-type-display-name';
import {
  BaseModal,
  Box,
  Icon,
  IconAction,
  PanelHeader,
  Pressable,
  Text,
  Toggle,
} from '@modules/_shared/ui/components';
import Button from '@modules/_shared/ui/components/Base/Button';
import { keyboardActivation } from '@modules/_shared/ui/keyboard-activation';
import { openVaultFiles } from '@shared/infrastructure/files';
import type { ImportedVault, VaultEntry } from '@modules/import/domain/vault';
import type { StoredEntry } from '@modules/import/infrastructure/stores/vault-store';
import type { PlanDraft } from '@modules/plans/domain/workspace-model';
import { PlansWorkspace } from './PlansWorkspace';
import type { ImportSession } from '@modules/import/domain/import-model';
import { clearImportSession } from '@modules/import/domain/import-model';
import { secureCleanup } from '@shared/application/secure-cleanup-controller';
import { useMappingSuggestions } from '@modules/mapping/application/use-mapping-suggestions';
import type { SuggestedAsset } from '@modules/mapping/domain/suggestion';

type SourceField = {
  id: string;
  assetFieldSource: string;
  label: string;
  value: string;
  sensitive?: boolean;
};

export function MappingWorkspace({
  entries,
  vaults,
  plans,
  selectedPlanClientId,
  mappedSourceFieldIds,
  ignoredSourceFieldIds,
  busy,
  onImport,
  onSelectPlan,
  onCreatePlan,
  onEditPlan,
  onDeletePlan,
  onEditAsset,
  onDeleteAsset,
  onMoveAsset,
  onToggleIgnore,
  session,
  onSave,
  onApplySuggestion,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  entries: StoredEntry[];
  vaults: ImportedVault[];
  plans: PlanDraft[];
  selectedPlanClientId: string | null;
  mappedSourceFieldIds: Set<string>;
  ignoredSourceFieldIds: Set<string>;
  busy: boolean;
  onImport: (files: Awaited<ReturnType<typeof openVaultFiles>>) => Promise<void> | void;
  onSelectPlan: (clientId: string) => void;
  onCreatePlan: () => void;
  onEditPlan: (clientId: string) => void;
  onDeletePlan: (planClientId: string) => void;
  onEditAsset: (planClientId: string, assetId: string) => void;
  onDeleteAsset: (planClientId: string, assetId: string) => void;
  onMoveAsset: (input: {
    fromPlanClientId: string;
    toPlanClientId: string;
    assetId: string;
  }) => void;
  onToggleIgnore: (sourceFieldId: string) => void;
  session: ImportSession;
  onSave: () => void;
  onApplySuggestion: (suggestion: SuggestedAsset) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  useEffect(() => secureCleanup.register(() => clearImportSession(session)), [session]);
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const { suggestions, selectedSuggestionKeys, suggest, dismiss, toggle, apply } =
    useMappingSuggestions(session, onApplySuggestion);
  const sourceFieldCount = entries.reduce(
    (count, entry) => count + sourceFields(entry.current).length,
    0,
  );
  const assetCount = plans.reduce((count, plan) => count + plan.assets.length, 0);
  /** Keyboard/explicit-action equivalent of dragging a node onto a Plan: targets
   *  the currently selected Plan (matching how `onApplySuggestion` in the host
   *  always applies to the active Plan), or creates one first — the same
   *  fallback `onDropOutside` uses for a background drop. */
  const mapNodesToPlan = (nodeIds: string[]) => {
    if (!selectedPlanClientId) onCreatePlan();
    suggest(nodeIds);
  };

  return (
    <>
      <Box className="mapping-workspace">
        <Box className="mw-panel">
          <PanelHeader
            title="Imported Data"
            description="Select a field to map it into a Plan Asset."
            actions={
              <Button
                title={busy ? 'Opening…' : 'Import'}
                size="sm"
                disabled={busy}
                onPress={async () => onImport(await openVaultFiles())}
              />
            }
          />
          <Box className="mw-panel-body" gap="m">
            <Box flexDirection="row" justifyContent="space-between" alignItems="center">
              <Text variant="bodySmall" color="gray">
                {sourceFieldCount} fields · {plans.length} Plans · {assetCount} Assets
              </Text>
              <Box flexDirection="row" gap="s">
                <Button
                  title="Undo"
                  variant="plain"
                  size="sm"
                  disabled={!canUndo}
                  onPress={onUndo}
                />
                <Button
                  title="Redo"
                  variant="plain"
                  size="sm"
                  disabled={!canRedo}
                  onPress={onRedo}
                />
              </Box>
            </Box>
            {vaults.map((vault) => (
              <VaultTreeNode
                key={vault.id}
                vault={vault}
                entries={entries.filter((entry) => entry.current.sourceId === vault.id)}
                expandedEntryId={expandedEntryId}
                onToggleEntry={(entryId) =>
                  setExpandedEntryId((current) => (current === entryId ? null : entryId))
                }
                revealed={revealed}
                mappedSourceFieldIds={mappedSourceFieldIds}
                ignoredSourceFieldIds={ignoredSourceFieldIds}
                onReveal={(fieldId) =>
                  setRevealed((current) => {
                    const next = new Set(current);
                    if (next.has(fieldId)) next.delete(fieldId);
                    else next.add(fieldId);
                    return next;
                  })
                }
                onToggleIgnore={onToggleIgnore}
                onMapNodes={mapNodesToPlan}
              />
            ))}
          </Box>
        </Box>
        <Box className="mw-panel">
          <PlansWorkspace
            plans={plans}
            selectedPlanClientId={selectedPlanClientId}
            onSelectPlan={onSelectPlan}
            onCreatePlan={onCreatePlan}
            onEditPlan={onEditPlan}
            onDeletePlan={onDeletePlan}
            onEditAsset={onEditAsset}
            onDeleteAsset={onDeleteAsset}
            onMoveAsset={onMoveAsset}
            session={session}
            onDropSuggestion={suggest}
            onDropOutside={(nodeIds) => {
              onCreatePlan();
              suggest(nodeIds);
            }}
          />
          <Box
            className="mw-panel-footer"
            flexDirection="row"
            justifyContent="flex-end"
            alignItems="center"
            gap="s"
          >
            <Box flex={1}>
              <Text variant="bodySmall" color="gray">
                {assetCount === 0
                  ? 'Add at least one Plan Asset before saving.'
                  : `Ready to save ${plans.length} Plan${plans.length === 1 ? '' : 's'} with ${assetCount} Asset${assetCount === 1 ? '' : 's'}.`}
              </Text>
            </Box>
            <Button
              title="Save"
              disabled={plans.length === 0 || assetCount === 0}
              onPress={onSave}
            />
          </Box>
        </Box>
      </Box>
      <BaseModal
        visible={suggestions.length > 0}
        title="Suggested Assets"
        description="Pick the Assets you want to create, then apply. You can edit or review them from the Plan afterwards."
        onDismiss={dismiss}
        footer={
          <>
            <Button title="Close" variant="plain" onPress={dismiss} />
            <Button
              title="Apply suggestion"
              disabled={selectedSuggestionKeys.size === 0}
              onPress={apply}
            />
          </>
        }
      >
        {suggestions.map((suggestion) => {
          const key = `${suggestion.fromNodeId}:${suggestion.type}`;
          return (
            <AssetPreviewer
              key={key}
              suggestion={suggestion}
              session={session}
              selected={selectedSuggestionKeys.has(key)}
              onToggleSelected={() => toggle(suggestion)}
            />
          );
        })}
      </BaseModal>
    </>
  );
}

function VaultTreeNode({
  vault,
  entries,
  expandedEntryId,
  onToggleEntry,
  revealed,
  mappedSourceFieldIds,
  ignoredSourceFieldIds,
  onReveal,
  onToggleIgnore,
  onMapNodes,
}: {
  vault: ImportedVault;
  entries: StoredEntry[];
  expandedEntryId: string | null;
  onToggleEntry: (entryId: string) => void;
  revealed: Set<string>;
  mappedSourceFieldIds: Set<string>;
  ignoredSourceFieldIds: Set<string>;
  onReveal: (fieldId: string) => void;
  onToggleIgnore: (fieldId: string) => void;
  onMapNodes: (nodeIds: string[]) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <Box gap="m">
      <Pressable
        onPress={() => setCollapsed((value) => !value)}
        accessibilityRole="button"
        accessibilityLabel={`${collapsed ? 'Expand' : 'Collapse'} ${vault.name}`}
        {...keyboardActivation(() => setCollapsed((value) => !value))}
      >
        <Box
          flexDirection="row"
          alignItems="center"
          gap="s"
          paddingVertical="s"
          style={{ borderBottomWidth: 1, borderBottomColor: '#EAECF0' }}
        >
          <Icon name="box-archive" type="font-awesome-6" color="gray" label="Imported vault" />
          <Box flex={1} gap="xs">
            <Text variant="bodyRegular" bold>
              {vault.name}
            </Text>
            <Text variant="bodySmall" color="gray">
              {entries.length} entr{entries.length === 1 ? 'y' : 'ies'} · {vault.kind}
            </Text>
          </Box>
          <Icon
            name={collapsed ? 'chevron-right' : 'chevron-down'}
            type="font-awesome-6"
            color="gray"
          />
        </Box>
      </Pressable>
      {!collapsed ? (
        <Box gap="l" style={{ paddingLeft: 28 }}>
          {groupEntries(entries).map(({ name, entries: groupEntriesForDisplay }) => (
            <SourceGroup
              key={`${vault.id}:${name}`}
              name={name}
              entries={groupEntriesForDisplay}
              expandedEntryId={expandedEntryId}
              onToggleEntry={onToggleEntry}
              revealed={revealed}
              mappedSourceFieldIds={mappedSourceFieldIds}
              ignoredSourceFieldIds={ignoredSourceFieldIds}
              onReveal={onReveal}
              onToggleIgnore={onToggleIgnore}
              onMapNodes={onMapNodes}
            />
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

function SourceEntry({
  entry,
  expanded,
  onToggleExpand,
  revealed,
  mappedSourceFieldIds,
  ignoredSourceFieldIds,
  onReveal,
  onToggleIgnore,
  onMapNodes,
}: {
  entry: VaultEntry;
  expanded: boolean;
  onToggleExpand: () => void;
  revealed: Set<string>;
  mappedSourceFieldIds: Set<string>;
  ignoredSourceFieldIds: Set<string>;
  onReveal: (fieldId: string) => void;
  onToggleIgnore: (fieldId: string) => void;
  onMapNodes: (nodeIds: string[]) => void;
}) {
  const fields = sourceFields(entry);
  const mappedCount = fields.filter((field) => mappedSourceFieldIds.has(field.id)).length;
  const isFullyMapped = fields.length > 0 && mappedCount === fields.length;
  const [isDragging, setIsDragging] = useState(false);
  return (
    <Box
      className="tree-row"
      backgroundColor={expanded ? 'gray5' : undefined}
      style={{
        opacity: isDragging ? 0.5 : 1,
        transform: isDragging ? 'scale(0.97)' : 'scale(1)',
        transition: 'opacity 120ms ease, transform 120ms ease',
      }}
      {...({
        draggable: !isFullyMapped,
        onDragStart: (event: {
          dataTransfer?: { setData: (type: string, value: string) => void };
        }) => {
          event.dataTransfer?.setData(
            'application/x-inheriti-source-node',
            JSON.stringify([entry.id]),
          );
          setIsDragging(true);
        },
        onDragEnd: () => setIsDragging(false),
      } as Record<string, unknown>)}
    >
      <Pressable
        onPress={onToggleExpand}
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${entry.title || 'entry'}`}
        {...keyboardActivation(onToggleExpand)}
      >
        <Box
          paddingVertical="s"
          paddingHorizontal="m"
          flexDirection="row"
          alignItems="center"
          gap="s"
        >
          {isFullyMapped ? (
            <Box
              width={20}
              height={20}
              borderRadius="pill"
              backgroundColor="success"
              alignItems="center"
              justifyContent="center"
            >
              <Icon
                name="check"
                type="font-awesome-6"
                size={11}
                color="white"
                label="Already added"
              />
            </Box>
          ) : null}
          <Box flex={1} gap="xs">
            <Text variant="bodyRegular" bold>
              {entry.title || 'Untitled entry'}
            </Text>
            <Text variant="bodySmall" color="gray">
              {fields.length} field{fields.length === 1 ? '' : 's'}
            </Text>
          </Box>
          <Icon
            name={expanded ? 'chevron-down' : 'chevron-right'}
            type="font-awesome-6"
            color="gray"
          />
        </Box>
      </Pressable>
      {!isFullyMapped ? (
        <Box paddingHorizontal="m" paddingBottom="s" flexDirection="row" justifyContent="flex-end">
          <IconAction
            name="plus"
            label={`Map ${entry.title || 'entry'} to Plan`}
            onPress={() => onMapNodes([entry.id])}
          />
        </Box>
      ) : null}
      {expanded ? (
        <Box padding="m" gap="s" style={{ borderTopWidth: 1, borderTopColor: '#EAECF0' }}>
          {fields.map((field) => {
            const isRevealed = revealed.has(field.id);
            const isIgnored = ignoredSourceFieldIds.has(field.id);
            return (
              <Box
                key={field.id}
                flexDirection="row"
                alignItems="center"
                gap="s"
                paddingVertical="s"
                paddingHorizontal="m"
                borderRadius="s"
              >
                <Box flex={1} gap="xs">
                  <Text variant="bodySmall" bold>
                    {field.label}
                  </Text>
                  <Box flexDirection="row" alignItems="center" gap="xs">
                    {field.sensitive ? (
                      <Box
                        {...({
                          onClick: () => onReveal(field.id),
                          ...keyboardActivation(() => onReveal(field.id)),
                          role: 'button',
                          'aria-label': isRevealed ? 'Hide value' : 'Reveal value',
                          style: { cursor: 'pointer' },
                        } as Record<string, unknown>)}
                      >
                        <Icon
                          name={isRevealed ? 'eye-slash' : 'eye'}
                          type="font-awesome-6"
                          size={14}
                          color="gray50"
                        />
                      </Box>
                    ) : null}
                    <Text variant="bodySmall" color={isIgnored ? 'gray' : undefined}>
                      {field.sensitive && !isRevealed ? '••••••••' : field.value || '—'}
                    </Text>
                  </Box>
                </Box>
                <Toggle
                  value={!isIgnored}
                  onValueChange={() => onToggleIgnore(field.id)}
                  accessibilityLabel={isIgnored ? 'Restore field' : 'Ignore field'}
                />
              </Box>
            );
          })}
        </Box>
      ) : null}
    </Box>
  );
}

function SourceGroup({
  name,
  entries,
  expandedEntryId,
  onToggleEntry,
  revealed,
  mappedSourceFieldIds,
  ignoredSourceFieldIds,
  onReveal,
  onToggleIgnore,
  onMapNodes,
}: {
  name: string;
  entries: StoredEntry[];
  expandedEntryId: string | null;
  onToggleEntry: (entryId: string) => void;
  revealed: Set<string>;
  mappedSourceFieldIds: Set<string>;
  ignoredSourceFieldIds: Set<string>;
  onReveal: (fieldId: string) => void;
  onToggleIgnore: (fieldId: string) => void;
  onMapNodes: (nodeIds: string[]) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const unmappedEntryIds = entries
    .filter((entry) =>
      sourceFields(entry.current).some((field) => !mappedSourceFieldIds.has(field.id)),
    )
    .map((entry) => entry.current.id);
  return (
    <Box gap="m">
      <Box flexDirection="row" alignItems="center" gap="s">
        <Box
          flexDirection="row"
          alignItems="center"
          gap="s"
          flex={1}
          {...({
            onClick: () => setCollapsed((value) => !value),
            ...keyboardActivation(() => setCollapsed((value) => !value)),
            role: 'button',
            'aria-label': `${collapsed ? 'Expand' : 'Collapse'} ${name}`,
            style: { cursor: 'pointer' },
          } as Record<string, unknown>)}
        >
          <Icon
            name={collapsed ? 'chevron-right' : 'chevron-down'}
            type="font-awesome-6"
            color="gray"
          />
          <Icon name="folder" type="font-awesome-6" color="gray" label="Source group" />
          <Text variant="bodySmall" bold color="gray">
            {name}
          </Text>
        </Box>
        {unmappedEntryIds.length > 0 ? (
          <IconAction
            name="plus"
            label={`Map all of ${name} to Plan`}
            onPress={() => onMapNodes(unmappedEntryIds)}
          />
        ) : null}
      </Box>
      {!collapsed ? (
        <Box style={{ paddingLeft: 20 }}>
          {entries.map((entry) => (
            <SourceEntry
              key={entry.current.id}
              entry={entry.current}
              expanded={expandedEntryId === entry.current.id}
              onToggleExpand={() => onToggleEntry(entry.current.id)}
              revealed={revealed}
              mappedSourceFieldIds={mappedSourceFieldIds}
              ignoredSourceFieldIds={ignoredSourceFieldIds}
              onReveal={onReveal}
              onToggleIgnore={onToggleIgnore}
              onMapNodes={onMapNodes}
            />
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

function groupEntries(entries: StoredEntry[]): Array<{ name: string; entries: StoredEntry[] }> {
  const groups = new Map<string, StoredEntry[]>();
  entries.forEach((entry) => {
    const name = entry.current.group || 'Root entries';
    const group = groups.get(name) ?? [];
    group.push(entry);
    groups.set(name, group);
  });
  return Array.from(groups, ([name, groupedEntries]) => ({ name, entries: groupedEntries }));
}

function sourceFields(entry: VaultEntry): SourceField[] {
  return [
    {
      id: `${entry.id}:username`,
      assetFieldSource: 'meta.username',
      label: 'Username',
      value: entry.username,
    },
    {
      id: `${entry.id}:password`,
      assetFieldSource: 'secret.password',
      label: 'Password',
      value: entry.password,
      sensitive: true,
    },
    { id: `${entry.id}:url`, assetFieldSource: 'meta.url', label: 'URL', value: entry.url },
    {
      id: `${entry.id}:notes`,
      assetFieldSource: 'secret.text',
      label: 'Notes',
      value: entry.notes,
    },
    ...entry.extraFields.map((field) => ({
      id: `${entry.id}:extra:${field.key}`,
      assetFieldSource: `meta.${field.key}`,
      label: field.key,
      value: field.value,
    })),
  ];
}

function fieldLabel(assetFieldSource: string): string {
  const key = assetFieldSource.split('.').pop() ?? assetFieldSource;
  const withSpaces = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

/** Read-only accordion preview of a Plan Asset — mirrors Business UI's PlanDataAssetPreview. */
function AssetPreviewer({
  suggestion,
  session,
  selected,
  onToggleSelected,
}: {
  suggestion: SuggestedAsset;
  session: ImportSession;
  selected: boolean;
  onToggleSelected: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const fields = Object.entries(suggestion.fieldBindings).map(([assetFieldSource, binding]) => ({
    assetFieldSource,
    label: fieldLabel(assetFieldSource),
    value: () =>
      binding.kind === 'literal'
        ? binding.value.reveal()
        : binding.kind === 'sources'
          ? binding.sources
              .flatMap((source) => {
                const value = session.fieldsById[source.sourceFieldId]?.value;
                return value?.isEmpty ? [] : [`${source.name}: ${value?.reveal() ?? ''}`];
              })
              .join('\n')
          : (session.fieldsById[binding.sourceFieldId]?.value.reveal() ?? ''),
    sensitive: assetFieldSource.startsWith('secret.'),
  }));

  return (
    <Box
      borderWidth={expanded ? 1 : 0}
      borderColor={selected ? 'success120' : 'gray30'}
      borderRadius="m"
      overflow="hidden"
    >
      <Box
        flexDirection="row"
        alignItems="center"
        gap="m"
        padding="m"
        borderWidth={expanded ? 0 : 1}
        borderColor="gray30"
        backgroundColor="gray5"
        borderRadius="m"
        style={{
          cursor: 'pointer',
          ...(expanded ? { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 } : null),
        }}
        {...({
          onClick: () => setExpanded((value) => !value),
          ...keyboardActivation(() => setExpanded((value) => !value)),
          role: 'button',
          'aria-label': expanded ? 'Collapse preview' : 'Expand preview',
        } as Record<string, unknown>)}
      >
        <Box
          width={20}
          height={20}
          borderRadius="pill"
          borderWidth={2}
          borderColor={selected ? 'success' : 'gray30'}
          backgroundColor="white"
          alignItems="center"
          justifyContent="center"
          {...({
            onClick: (event: { stopPropagation?: () => void }) => {
              event.stopPropagation?.();
              onToggleSelected();
            },
            ...keyboardActivation(onToggleSelected, { stopPropagation: true }),
            role: 'radio',
            'aria-checked': selected,
            'aria-label': selected ? 'Deselect this Asset' : 'Select this Asset — I want this one',
            style: { cursor: 'pointer' },
          } as Record<string, unknown>)}
        >
          {selected ? (
            <Box width={10} height={10} borderRadius="pill" backgroundColor="success" />
          ) : null}
        </Box>
        <Icon
          name={getPlanAssetIconName(suggestion.type)}
          color="gray"
          numberSize={40}
          label={getAssetTypeDisplayName(suggestion.type)}
        />
        <Box flex={1} gap="xs">
          <Text variant="heading3">{suggestion.name}</Text>
          <Text variant="bodySmall" color="gray">
            {getAssetTypeDisplayName(suggestion.type)}
          </Text>
        </Box>
        <Icon
          name={expanded ? 'eye-slash' : 'eye'}
          type="font-awesome-6"
          color="gray"
          numberSize={25}
        />
      </Box>
      {expanded ? (
        <Box padding="m" gap="s" style={{ borderTopWidth: 1, borderTopColor: '#EAECF0' }}>
          <Text variant="bodySmall" color="gray">
            {suggestion.rationale}
          </Text>
          {fields.length === 0 ? (
            <Text variant="bodySmall" color="warning120">
              No fields matched automatically — apply it, then edit it from the Plan.
            </Text>
          ) : (
            fields.map((field) => {
              const isRevealed = revealed.has(field.assetFieldSource);
              return (
                <Box
                  key={field.assetFieldSource}
                  flexDirection="row"
                  justifyContent="space-between"
                  alignItems="center"
                  gap="s"
                >
                  <Box flex={1} gap="xs">
                    <Text variant="smallUppercase" color="gray">
                      {field.label}
                    </Text>
                    <Text variant="bodySmall" style={{ whiteSpace: 'pre-line' }}>
                      {field.sensitive && !isRevealed ? '••••••••' : field.value() || '—'}
                    </Text>
                  </Box>
                  {field.sensitive ? (
                    <Box
                      {...({
                        onClick: (event: { stopPropagation?: () => void }) => {
                          event.stopPropagation?.();
                          setRevealed((current) => {
                            const next = new Set(current);
                            if (next.has(field.assetFieldSource))
                              next.delete(field.assetFieldSource);
                            else next.add(field.assetFieldSource);
                            return next;
                          });
                        },
                        ...keyboardActivation(
                          () =>
                            setRevealed((current) => {
                              const next = new Set(current);
                              if (next.has(field.assetFieldSource))
                                next.delete(field.assetFieldSource);
                              else next.add(field.assetFieldSource);
                              return next;
                            }),
                          { stopPropagation: true },
                        ),
                        role: 'button',
                        'aria-label': isRevealed ? 'Hide value' : 'Reveal value',
                        style: { cursor: 'pointer' },
                      } as Record<string, unknown>)}
                    >
                      <Icon
                        name={isRevealed ? 'eye-slash' : 'eye'}
                        type="font-awesome-6"
                        size={14}
                        color="gray50"
                      />
                    </Box>
                  ) : null}
                </Box>
              );
            })
          )}
        </Box>
      ) : null}
    </Box>
  );
}
