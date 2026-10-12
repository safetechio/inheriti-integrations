import { useState } from 'react';
import type { DropState, GroupingAsset, PlanDraft } from '../types';
import { hasPlanCapacity } from '../capacity';

export function usePlanGrouping() {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropState, setDropState] = useState<Record<string, DropState>>({});
  const [assignedId, setAssignedId] = useState<string | null>(null);
  const startDrag = (id: string) => setDraggedId(id);
  const endDrag = () => {
    setDraggedId(null);
    setDropState({});
  };
  const assign = (
    asset: GroupingAsset,
    plan: PlanDraft,
    onAssign?: (asset: GroupingAsset, plan: PlanDraft) => void,
  ) => {
    if (!asset.valid || !hasPlanCapacity(plan) || !onAssign) return;
    onAssign(asset, plan);
    setAssignedId(asset.id);
    endDrag();
  };
  const updateDrop = (plan: PlanDraft, state: DropState) =>
    setDropState((current) => ({ ...current, [plan.id]: state }));
  const drop = (
    asset: GroupingAsset | undefined,
    plan: PlanDraft,
    onAssign?: (asset: GroupingAsset, plan: PlanDraft) => void,
  ) => {
    if (asset) assign(asset, plan, onAssign);
    else endDrag();
  };
  return {
    draggedId,
    dropState,
    assignedId,
    startDrag,
    endDrag,
    assign,
    updateDrop,
    drop,
  };
}
