import { useEffect, useState } from 'react';
import { getPlanAssetIconName } from '@modules/plans/domain/asset-metadata';
import type { AssetEditorValue } from '@modules/plans/ui/asset-editor';
import { getAssetTypeDisplayName } from '@modules/_shared/domain/asset-type-display-name';
import {
  Alert,
  BaseModal,
  Box,
  Icon,
  IconAction,
  NoItemsPlaceholder,
  PanelHeader,
  Pressable,
  Text,
} from '@modules/_shared/ui/components';
import Button from '@modules/_shared/ui/components/Base/Button';
import type { PlanDraft } from '@modules/plans/domain/workspace-model';
import { planDraftView } from '@modules/plans/domain/workspace-selectors';
import { SensitiveValue, type ImportSession } from '@modules/import/domain/import-model';
import { materialiseAsset } from '@modules/plans/domain/asset-materializer';
import { keyboardActivation } from '@modules/_shared/ui/keyboard-activation';
import {
  calculatePlanUsage,
  previewAssetMove,
  type PlanUsage,
  type PlanUsageLimits,
} from '@modules/plans/domain/plan-usage';

/** Business UI's own Asset-usage defaults (documented in the SDK's usage-calculator
 *  docstring: 500 chars / 10 files / 50 MB) — an explicit UI default, not authority;
 *  the host is expected to supply real limits once D0.7 lands. */
const DEFAULT_PLAN_USAGE_LIMITS: PlanUsageLimits = {
  maxChars: 500,
  maxFiles: 10,
  maxFileBytes: 50 * 1024 * 1024,
};

function formatUsage(usage: PlanUsage, limits: PlanUsageLimits): string {
  return `${usage.chars}/${limits.maxChars} chars · ${usage.files}/${limits.maxFiles} files`;
}

function readDroppedNodeIds(event: DragEvent): string[] | null {
  const nodePayload = event.dataTransfer?.getData('application/x-inheriti-source-node');
  if (!nodePayload) return null;
  try {
    const nodeIds = JSON.parse(nodePayload) as unknown;
    if (Array.isArray(nodeIds) && nodeIds.every((id): id is string => typeof id === 'string'))
      return nodeIds;
  } catch {
    /* Ignore malformed drag payloads. */
  }
  return null;
}

export function PlansWorkspace({
  plans,
  selectedPlanClientId,
  onSelectPlan,
  onCreatePlan,
  onEditPlan,
  onDeletePlan,
  onEditAsset,
  onDeleteAsset,
  onDropSuggestion,
  onDropOutside,
  session,
  onMoveAsset,
  usageLimits = DEFAULT_PLAN_USAGE_LIMITS,
}: {
  plans: PlanDraft[];
  selectedPlanClientId: string | null;
  onSelectPlan: (clientId: string) => void;
  onCreatePlan: () => void;
  onEditPlan: (clientId: string) => void;
  onDeletePlan: (planClientId: string) => void;
  onEditAsset: (planClientId: string, assetId: string) => void;
  onDeleteAsset: (planClientId: string, assetId: string) => void;
  onDropSuggestion: (sourceNodeIds: string[]) => void;
  onDropOutside: (sourceNodeIds: string[]) => void;
  /** Needed to materialise Assets for usage/move-preview display only — never persisted. */
  session: ImportSession;
  onMoveAsset: (input: {
    fromPlanClientId: string;
    toPlanClientId: string;
    assetId: string;
  }) => void;
  usageLimits?: PlanUsageLimits;
}) {
  const [dragOverPlanId, setDragOverPlanId] = useState<string | null>(null);
  const [backgroundDragOver, setBackgroundDragOver] = useState(false);
  const [movingAsset, setMovingAsset] = useState<{ planClientId: string; assetId: string } | null>(
    null,
  );
  useEffect(() => {
    const clear = () => {
      setDragOverPlanId(null);
      setBackgroundDragOver(false);
    };
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
    };
  }, []);
  return (
    <>
      <PanelHeader
        title="Plans"
        description="Group mapped fields into Plan Assets, then into Plans."
        actions={<Button title="New Plan" size="sm" onPress={onCreatePlan} />}
      />
      <Box
        className="mw-panel-body"
        style={{
          outline: backgroundDragOver ? '2px dashed #A3B3BF' : 'none',
          outlineOffset: -8,
          transition: 'outline-color 120ms ease',
        }}
        onDragOver={(event: DragEvent) => event.preventDefault()}
        onDragEnter={(event: DragEvent) => {
          event.preventDefault();
          setBackgroundDragOver(true);
        }}
        onDragLeave={(event: DragEvent) => {
          if (
            event.relatedTarget instanceof Node &&
            event.currentTarget instanceof Node &&
            event.currentTarget.contains(event.relatedTarget)
          )
            return;
          setBackgroundDragOver(false);
        }}
        onDrop={(event: DragEvent) => {
          event.preventDefault();
          setBackgroundDragOver(false);
          const nodeIds = readDroppedNodeIds(event);
          if (nodeIds) onDropOutside(nodeIds);
        }}
      >
        {plans.length === 0 ? (
          <NoItemsPlaceholder
            iconName="folder"
            description="Drop an entry here, or create a Plan, to start mapping imported fields."
          />
        ) : (
          plans.map((plan) => {
            const expanded = plan.clientId === selectedPlanClientId;
            const isDragOver = dragOverPlanId === plan.clientId;
            const view = planDraftView(plan);
            const dropOnPlan = (event: DragEvent) => {
              event.preventDefault();
              event.stopPropagation();
              setDragOverPlanId(null);
              const nodeIds = readDroppedNodeIds(event);
              if (!nodeIds) return;
              onSelectPlan(plan.clientId);
              onDropSuggestion(nodeIds);
            };
            const materialisedAssets = plan.assets.map(
              (asset) => materialiseAsset(asset, session).asset,
            );
            const usage = calculatePlanUsage(materialisedAssets, usageLimits);
            return (
              <Box
                key={plan.clientId}
                className="tree-row"
                backgroundColor={isDragOver ? 'gray10' : expanded ? 'gray5' : undefined}
                style={{
                  outline: isDragOver ? '2px dashed #667085' : 'none',
                  outlineOffset: -2,
                  transition: 'outline-color 120ms ease',
                }}
                onDragOver={(event: DragEvent) => event.preventDefault()}
                onDragEnter={(event: DragEvent) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setDragOverPlanId(plan.clientId);
                }}
                onDragLeave={(event: DragEvent) => {
                  if (
                    event.relatedTarget instanceof Node &&
                    event.currentTarget instanceof Node &&
                    event.currentTarget.contains(event.relatedTarget)
                  )
                    return;
                  setDragOverPlanId((current) => (current === plan.clientId ? null : current));
                }}
                onDrop={dropOnPlan}
              >
                <Box
                  flexDirection="row"
                  alignItems="center"
                  gap="s"
                  paddingVertical="s"
                  paddingHorizontal="m"
                >
                  <Pressable
                    onPress={() => onSelectPlan(plan.clientId)}
                    accessibilityRole="button"
                    accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${plan.name}`}
                    style={{ flex: 1 }}
                    {...keyboardActivation(() => onSelectPlan(plan.clientId))}
                  >
                    <Box flexDirection="row" alignItems="center" gap="s">
                      <Icon name="folder" type="font-awesome-6" color="gray" label="Plan" />
                      <Box flex={1} gap="xs">
                        <Text variant="bodyRegular" bold>
                          {plan.name}
                        </Text>
                        <Text variant="bodySmall" color="gray">
                          {plan.assets.length} Asset{plan.assets.length === 1 ? '' : 's'} ·{' '}
                          {view.status === 'VALID'
                            ? 'Ready'
                            : `${view.issues.length} issue${view.issues.length === 1 ? '' : 's'}`}
                        </Text>
                      </Box>
                    </Box>
                  </Pressable>
                  <IconAction
                    name="pen-to-square"
                    label={`Edit ${plan.name}`}
                    onPress={() => onEditPlan(plan.clientId)}
                  />
                  <IconAction
                    name="trash"
                    label={`Delete ${plan.name}`}
                    onPress={() => onDeletePlan(plan.clientId)}
                  />
                  <Icon
                    name={expanded ? 'chevron-down' : 'chevron-right'}
                    type="font-awesome-6"
                    color="gray"
                  />
                </Box>
                {expanded ? (
                  <Box gap="s" padding="m" style={{ borderTopWidth: 1, borderTopColor: '#EAECF0' }}>
                    {view.issues
                      .filter((issue) => issue.code !== 'NO_ASSETS')
                      .slice(0, 3)
                      .map((issue) => (
                        <Alert key={`${issue.code}:${issue.assetId ?? ''}`}>{issue.message}</Alert>
                      ))}
                    {view.issues.length > 3 ? (
                      <Text variant="bodySmall" color="gray">
                        +{view.issues.length - 3} more issues
                      </Text>
                    ) : null}
                    {plan.assets.length > 0 ? (
                      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
                        <Text
                          variant="bodySmall"
                          color={usage.withinLimits ? 'gray' : 'warning120'}
                        >
                          {formatUsage(usage, usageLimits)}
                        </Text>
                        {!usage.withinLimits ? (
                          <Text variant="bodySmall" color="warning120">
                            Over limit
                          </Text>
                        ) : null}
                      </Box>
                    ) : null}
                    {plan.assets.length === 0 ? (
                      <Text variant="bodySmall" color="gray">
                        No Assets yet. Map a field or add one to get started.
                      </Text>
                    ) : null}
                    {plan.assets.map((asset) => (
                      <Box
                        key={asset.id}
                        paddingVertical="s"
                        paddingHorizontal="m"
                        backgroundColor="gray5"
                        borderRadius="s"
                        onDragOver={(event: DragEvent) => event.preventDefault()}
                        onDrop={dropOnPlan}
                      >
                        <Box flexDirection="row" alignItems="center" gap="s">
                          <Icon
                            name={getPlanAssetIconName(asset.type)}
                            color="gray"
                            label={`${getAssetTypeDisplayName(asset.type)} Asset`}
                          />
                          <Box flex={1}>
                            <Text variant="bodySmall">
                              {asset.name} · {getAssetTypeDisplayName(asset.type)}
                            </Text>
                          </Box>
                          <IconAction
                            name="arrow-right-arrow-left"
                            label={`Move ${asset.name} to another Plan`}
                            disabled={plans.length < 2}
                            onPress={() =>
                              setMovingAsset({ planClientId: plan.clientId, assetId: asset.id })
                            }
                          />
                          <IconAction
                            name="pen-to-square"
                            label={`Edit ${asset.name}`}
                            onPress={() => onEditAsset(plan.clientId, asset.id)}
                          />
                          <IconAction
                            name="trash"
                            label={`Delete ${asset.name}`}
                            onPress={() => onDeleteAsset(plan.clientId, asset.id)}
                          />
                        </Box>
                      </Box>
                    ))}
                  </Box>
                ) : null}
              </Box>
            );
          })
        )}
      </Box>
      {movingAsset ? (
        <MoveAssetDialog
          plans={plans}
          session={session}
          usageLimits={usageLimits}
          fromPlanClientId={movingAsset.planClientId}
          assetId={movingAsset.assetId}
          onDismiss={() => setMovingAsset(null)}
          onConfirm={(toPlanClientId) => {
            onMoveAsset({
              fromPlanClientId: movingAsset.planClientId,
              toPlanClientId,
              assetId: movingAsset.assetId,
            });
            setMovingAsset(null);
          }}
        />
      ) : null}
    </>
  );
}

function usageDelta(
  usage: { before: PlanUsage; after: PlanUsage },
  limits: PlanUsageLimits,
): string {
  return `${formatUsage(usage.before, limits)} → ${formatUsage(usage.after, limits)}`;
}

/** Preview the usage delta on both Plans before confirming a move. */
function MoveAssetDialog({
  plans,
  session,
  usageLimits,
  fromPlanClientId,
  assetId,
  onDismiss,
  onConfirm,
}: {
  plans: PlanDraft[];
  session: ImportSession;
  usageLimits: PlanUsageLimits;
  fromPlanClientId: string;
  assetId: string;
  onDismiss: () => void;
  onConfirm: (toPlanClientId: string) => void;
}) {
  const [targetPlanClientId, setTargetPlanClientId] = useState<string | null>(null);
  const fromPlan = plans.find((plan) => plan.clientId === fromPlanClientId);
  const asset = fromPlan?.assets.find((item) => item.id === assetId);
  const targetPlan = plans.find((plan) => plan.clientId === targetPlanClientId);
  const otherPlans = plans.filter((plan) => plan.clientId !== fromPlanClientId);
  if (!fromPlan || !asset) return null;

  const preview = targetPlan
    ? previewAssetMove({
        asset: materialiseAsset(asset, session).asset,
        fromAssets: fromPlan.assets.map((item) => materialiseAsset(item, session).asset),
        toAssets: targetPlan.assets.map((item) => materialiseAsset(item, session).asset),
        limits: usageLimits,
      })
    : null;

  return (
    <BaseModal
      visible
      title={`Move "${asset.name}"`}
      description={`Currently in "${fromPlan.name}". Pick the destination Plan.`}
      onDismiss={onDismiss}
      footer={
        <>
          <Button title="Cancel" variant="plain" onPress={onDismiss} />
          <Button
            title="Move"
            disabled={!targetPlanClientId}
            onPress={() => targetPlanClientId && onConfirm(targetPlanClientId)}
          />
        </>
      }
    >
      <Box flexDirection="row" gap="s" flexWrap="wrap">
        {otherPlans.map((plan) => (
          <Button
            key={plan.clientId}
            title={plan.name}
            size="sm"
            variant={targetPlanClientId === plan.clientId ? 'contained' : 'outlined'}
            onPress={() => setTargetPlanClientId(plan.clientId)}
          />
        ))}
      </Box>
      {preview ? (
        <Box gap="xs">
          <Text variant="bodySmall" bold>
            {fromPlan.name}
          </Text>
          <Text variant="bodySmall" color={preview.from.after.withinLimits ? 'gray' : 'warning120'}>
            {usageDelta(preview.from, usageLimits)}
          </Text>
          <Text variant="bodySmall" bold>
            {targetPlan?.name}
          </Text>
          <Text variant="bodySmall" color={preview.to.after.withinLimits ? 'gray' : 'warning120'}>
            {usageDelta(preview.to, usageLimits)}
          </Text>
          {!preview.to.after.withinLimits ? (
            <Alert>Moving this Asset would put the destination Plan over its limit.</Alert>
          ) : null}
        </Box>
      ) : null}
    </BaseModal>
  );
}

export function assetEditorValueToDraft(value: AssetEditorValue, planClientId: string) {
  return {
    planClientId,
    asset: {
      id: value.id ?? crypto.randomUUID(),
      type: value.type,
      name: typeof value.meta.name === 'string' ? value.meta.name : 'Untitled Asset',
      fieldBindings: Object.entries({ ...value.meta, ...value.secret }).reduce<
        Record<string, { kind: 'literal'; value: SensitiveValue }>
      >((bindings, [field, fieldValue]) => {
        if (field === 'name' || fieldValue === undefined || fieldValue === null) return bindings;
        const source = value.meta[field] !== undefined ? `meta.${field}` : `secret.${field}`;
        const stringValue =
          fieldValue instanceof Blob ? `[file:${fieldValue.size}]` : String(fieldValue);
        bindings[source] = { kind: 'literal', value: new SensitiveValue(stringValue) };
        return bindings;
      }, {}),
    },
  };
}
