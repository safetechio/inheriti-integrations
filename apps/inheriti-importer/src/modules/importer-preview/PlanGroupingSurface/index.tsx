import { useState } from 'react';
import { BaseModal, Box, Button, Icon, PanelHeader, Stack, Text } from '@main-components';
import { UnassignedAssets } from './components/UnassignedAssets';
import { PlanDraftList } from './components/PlanDraftList';
import { usePlanGrouping } from './hooks/use-plan-grouping';
import { PlanMetadataModal, type PlanMetadataValues } from './components/PlanMetadataModal';
import type { PlanGroupingSurfaceProps } from './types';
import './styles.css';

export type {
  GroupingAsset,
  PlanDraft,
  PlanGroupingSurfaceProps,
  PlanMetadataValues,
} from './types';

export function PlanGroupingSurface({
  unassigned,
  plans,
  description,
  selectedPlanId,
  onAssign,
  onSelectPlan,
  onCreatePlan,
  onDeletePlan,
  onUpdatePlan,
  onUnassign,
}: PlanGroupingSurfaceProps) {
  const grouping = usePlanGrouping();
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? plans[0];
  const [editingPlanId, setEditingPlanId] = useState<string>();
  const [deletingPlanId, setDeletingPlanId] = useState<string>();
  const editingPlan = plans.find((plan) => plan.id === editingPlanId);
  const deletingPlan = plans.find((plan) => plan.id === deletingPlanId);
  return (
    <Stack gap="l" className="plan-grouping-surface">
      <PanelHeader
        title="Plan drafts"
        actions={
          <Button
            title="New plan"
            startIcon={<Icon name="plus" size={12} />}
            variant="outlined"
            disabled={!onCreatePlan}
            onPress={() => onCreatePlan?.()}
          />
        }
      >
        {description ? (
          <Text variant="bodySmall" color="gray" style={{ fontSize: 13, opacity: 0.8 }}>
            {description}
          </Text>
        ) : null}
      </PanelHeader>
      <Box
        className="plan-grouping-columns"
        flexDirection="row"
        gap="l"
        style={{ flexWrap: 'wrap' }}
      >
        <UnassignedAssets
          assets={unassigned}
          selectedPlan={selectedPlan}
          grouping={grouping}
          onAssign={onAssign}
        />
        <PlanDraftList
          plans={plans}
          selectedPlan={selectedPlan}
          unassigned={unassigned}
          grouping={grouping}
          onAssign={onAssign}
          onEditPlan={onUpdatePlan ? (plan) => setEditingPlanId(plan.id) : undefined}
          onDeletePlan={onDeletePlan ? (plan) => setDeletingPlanId(plan.id) : undefined}
          onSelectPlan={onSelectPlan}
          onUnassign={onUnassign}
        />
      </Box>
      <PlanMetadataModal
        plan={editingPlan}
        visible={Boolean(editingPlan)}
        onDismiss={() => setEditingPlanId(undefined)}
        onSave={(values: PlanMetadataValues) => {
          if (!editingPlan) return;
          onUpdatePlan?.(editingPlan, values);
          setEditingPlanId(undefined);
        }}
      />
      <BaseModal
        visible={Boolean(deletingPlan)}
        title={`Delete ${deletingPlan?.name ?? 'plan draft'}?`}
        description="The plan draft will be removed. Its Assets will return to Unassigned."
        onDismiss={() => setDeletingPlanId(undefined)}
        footer={
          <>
            <Button
              title="Keep plan"
              variant="plain"
              onPress={() => setDeletingPlanId(undefined)}
            />
            <Button
              title="Delete draft"
              color="danger"
              onPress={() => {
                if (deletingPlan) onDeletePlan?.(deletingPlan);
                setDeletingPlanId(undefined);
              }}
            />
          </>
        }
      >
        {deletingPlan?.assignedAssets?.length ? (
          <Text variant="bodySmall" color="gray">
            {deletingPlan.assignedAssets.length} Asset
            {deletingPlan.assignedAssets.length === 1 ? '' : 's'} will need a new plan.
          </Text>
        ) : null}
      </BaseModal>
    </Stack>
  );
}

export default PlanGroupingSurface;
