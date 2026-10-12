export interface GroupingAsset {
  id: string;
  name: string;
  type: string;
  valid?: boolean;
}
export interface PlanDraft {
  id: string;
  name: string;
  description?: string;
  assets: number;
  capacity: string;
  valid: boolean;
  capacityWarning?: boolean;
  governanceHint?: string;
  assignedAssets?: GroupingAsset[];
}
export interface PlanMetadataValues {
  name: string;
  description: string;
}
export interface PlanGroupingSurfaceProps {
  unassigned: GroupingAsset[];
  plans: PlanDraft[];
  description?: string;
  selectedPlanId?: string;
  onAssign?: (asset: GroupingAsset, plan: PlanDraft) => void;
  onSelectPlan?: (plan: PlanDraft) => void;
  onCreatePlan?: () => void;
  onDeletePlan?: (plan: PlanDraft) => void;
  onUpdatePlan?: (plan: PlanDraft, values: PlanMetadataValues) => void;
  onUnassign?: (asset: GroupingAsset, plan: PlanDraft) => void;
}
export type DropState = 'idle' | 'over-valid' | 'over-invalid';
