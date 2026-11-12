import { useState } from 'react';
import { BaseModal, Box, Button, Icon, PanelHeader, Stack, theme } from '@main-components';
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
        <Stack gap="m" className="plan-draft-column" style={{ flex: '2 1 420px', minWidth: 0 }}>
          <PanelHeader
            title="Draft plans"
            actions={
              <Button
                title="New plan"
                startIcon={<Icon name="plus" size={12} color={theme.colors.gray} />}
                variant="outlined"
                color="gray"
                disabled={!onCreatePlan}
                onPress={() => onCreatePlan?.()}
              />
            }
          />
          <PlanDraftList
            plans={plans}
            selectedPlan={selectedPlan}
            unassigned={unassigned}
            grouping={grouping}
            onAssign={onAssign}
            onEditPlan={onUpdatePlan ? (plan) => setEditingPlanId(plan.id) : undefined}
            onDeletePlan={
              onDeletePlan && plans.length > 1
                ? (plan) => {
                    if (plan.assignedAssets?.length) setDeletingPlanId(plan.id);
                    else onDeletePlan(plan);
                  }
                : undefined
            }
            onSelectPlan={onSelectPlan}
            onUnassign={onUnassign}
          />
        </Stack>
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
        description={`The ${deletingPlan?.assignedAssets?.length ?? 0} ${(deletingPlan?.assignedAssets?.length ?? 0) === 1 ? 'Asset' : 'Assets'} in this plan will return to Unassigned.`}
        onDismiss={() => setDeletingPlanId(undefined)}
        footer={
          <>
            <Button title="Cancel" variant="plain" onPress={() => setDeletingPlanId(undefined)} />
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
        {null}
      </BaseModal>
    </Stack>
  );
}

export default PlanGroupingSurface;
