import type { StagingState } from '../../FinalStagingChecklist';
import type { ReviewAsset } from '../../AssetReviewQueue';
import type { GroupingAsset, PlanDraft, PlanMetadataValues } from '../../PlanGroupingSurface';
import type { ImporterFlowStage } from './use-importer-flow';
import type { ImportFile } from '../../SourceImportStatus';
import { assignAsset, unassignAsset, assignAssets, unassignAssets } from './flow-assignment';
import { reviewAsset } from './flow-review';
import { getImporterFlowReadiness } from '../application/flow-readiness';

export type FlowState = {
  files: ImportFile[];
  stage: ImporterFlowStage;
  stagingState: StagingState;
  selectedAssetId?: string;
  assets: ReviewAsset[];
  unassigned: GroupingAsset[];
  plans: PlanDraft[];
};
export type FlowAction =
  | { type: 'stage'; stage: ImporterFlowStage }
  | { type: 'select-asset'; asset: ReviewAsset }
  | { type: 'review-asset'; action: string; asset: ReviewAsset; autoAdvance: boolean }
  | { type: 'assign-asset'; asset: GroupingAsset; plan: PlanDraft }
  | { type: 'unassign-asset'; asset: GroupingAsset; plan: PlanDraft }
  | { type: 'assign-assets'; assets: GroupingAsset[]; plan: PlanDraft }
  | { type: 'unassign-assets'; assets: GroupingAsset[] }
  | {
      type: 'create-plan';
      id: string;
      options?: { name?: string; folderId?: string | null; scope?: 'SHARED' | 'PERSONAL' };
    }
  | {
      type: 'create-plans-from-assets';
      assets: GroupingAsset[];
      ids: string[];
      options: { name: string; folderId: string | null; scope: 'SHARED' | 'PERSONAL' };
    }
  | { type: 'update-plan'; id: string; values: PlanMetadataValues }
  | { type: 'delete-plan'; id: string }
  | { type: 'delete-plans'; ids: string[] }
  | { type: 'move-plans'; ids: string[]; folderId: string | null; scope: 'SHARED' | 'PERSONAL' }
  | { type: 'stage-import' }
  | {
      type: 'source-status';
      name: string;
      status: ImportFile['status'];
      entries?: number;
      warnings?: number;
    }
  | { type: 'set-staging'; state: StagingState };
export function flowReducer(state: FlowState, action: FlowAction): FlowState {
  if (action.type === 'create-plan' && state.plans.some((plan) => plan.id === action.id))
    return state;
  if (action.type === 'stage') return { ...state, stage: action.stage };
  if (action.type === 'source-status')
    return {
      ...state,
      stagingState: 'configured',
      files: state.files.map((file) =>
        file.name === action.name
          ? {
              ...file,
              status: action.status,
              entries: action.entries ?? file.entries,
              warnings: action.warnings ?? file.warnings,
            }
          : file,
      ),
    };
  if (action.type === 'set-staging') return { ...state, stagingState: action.state };
  if (action.type === 'select-asset') return { ...state, selectedAssetId: action.asset.id };
  if (action.type === 'review-asset')
    return reviewAsset(state, action.action, action.asset, action.autoAdvance);
  if (action.type === 'assign-asset') return assignAsset(state, action.asset, action.plan);
  if (action.type === 'unassign-asset') return unassignAsset(state, action.asset, action.plan);
  if (action.type === 'assign-assets') return assignAssets(state, action.assets, action.plan);
  if (action.type === 'unassign-assets') return unassignAssets(state, action.assets);
  if (action.type === 'move-plans') {
    const ids = new Set(action.ids);
    const selected = state.plans.filter((plan) => ids.has(plan.id));
    if (
      !ids.size ||
      ids.size !== action.ids.length ||
      selected.length !== ids.size ||
      selected.some(
        (plan) => plan.sharingModel !== (action.scope === 'PERSONAL' ? 'PRIVATE' : 'SHARED'),
      ) ||
      selected.every((plan) => plan.folderId === action.folderId)
    )
      return state;
    return {
      ...state,
      plans: state.plans.map((plan) =>
        ids.has(plan.id) ? { ...plan, folderId: action.folderId } : plan,
      ),
    };
  }
  if (action.type === 'create-plans-from-assets') {
    const available = [
      ...state.unassigned,
      ...state.plans.flatMap((plan) => plan.assignedAssets ?? []),
    ];
    const selected = action.assets.map((asset) => available.filter((item) => item.id === asset.id));
    if (
      !action.assets.length ||
      !action.options.name.trim() ||
      selected.some((matches) => matches.length !== 1 || !matches[0].valid) ||
      new Set(action.assets.map((asset) => asset.id)).size !== action.assets.length ||
      action.ids.length !== Math.ceil(action.assets.length / 10) ||
      new Set(action.ids).size !== action.ids.length ||
      action.ids.some((id) => state.plans.some((plan) => plan.id === id))
    )
      return state;
    const plans = action.ids.map((id, index) => {
      const assignedAssets = selected.slice(index * 10, (index + 1) * 10).map((items) => items[0]);
      return {
        id,
        name:
          action.ids.length === 1
            ? action.options.name.trim()
            : `${action.options.name.trim()} ${index + 1}`,
        folderId: action.options.folderId,
        sharingModel:
          action.options.scope === 'PERSONAL' ? ('PRIVATE' as const) : ('SHARED' as const),
        assets: assignedAssets.length,
        capacity: `${assignedAssets.length} / 10 Assets`,
        valid: true,
        assignedAssets,
      };
    });
    return {
      ...state,
      stagingState: 'configured',
      unassigned: state.unassigned.filter(
        (asset) => !action.assets.some((item) => item.id === asset.id),
      ),
      plans: [
        ...plans,
        ...state.plans.map((plan) => {
          const assignedAssets = (plan.assignedAssets ?? []).filter(
            (asset) => !action.assets.some((item) => item.id === asset.id),
          );
          return assignedAssets.length === (plan.assignedAssets ?? []).length
            ? plan
            : {
                ...plan,
                assignedAssets,
                assets: assignedAssets.length,
                capacity: `${assignedAssets.length} / 10 Assets`,
              };
        }),
      ],
    };
  }
  if (action.type === 'create-plan')
    return {
      ...state,
      stagingState: 'configured',
      plans: [
        {
          id: action.id,
          name: action.options?.name ?? `Plan ${state.plans.length + 1}`,
          folderId: action.options?.folderId,
          sharingModel: action.options?.scope === 'PERSONAL' ? 'PRIVATE' : 'SHARED',
          assets: 0,
          capacity: '0 / 10 Assets',
          valid: true,
          assignedAssets: [],
        },
        ...state.plans,
      ],
    };
  if (action.type === 'update-plan') {
    const plan = state.plans.find((item) => item.id === action.id);
    const { name, description, folderId, scope } = action.values;
    const nextName = name.trim();
    if (!plan || !nextName || nextName.length > 160) return state;
    const updated = {
      ...plan,
      name: nextName,
      description,
      folderId: folderId === undefined ? plan.folderId : folderId,
      sharingModel: scope === undefined ? plan.sharingModel : scope === 'PERSONAL' ? 'PRIVATE' as const : 'SHARED' as const,
    };
    return {
      ...state,
      stagingState: 'configured',
      plans: state.plans.map((item) => item.id === plan.id ? updated : item),
    };
  }
  if (action.type === 'delete-plan') {
    const removed = state.plans.find((plan) => plan.id === action.id);
    if (!removed) return state;
    return {
      ...state,
      stagingState: 'configured',
      plans: state.plans.filter((plan) => plan.id !== action.id),
      unassigned: [...state.unassigned, ...(removed.assignedAssets ?? [])],
    };
  }
  if (action.type === 'delete-plans') {
    const ids = new Set(action.ids);
    if (!ids.size || ids.size !== action.ids.length ||
      action.ids.some((id) => !state.plans.some((plan) => plan.id === id))) return state;
    return {
      ...state,
      stagingState: 'configured',
      plans: state.plans.filter((plan) => !ids.has(plan.id)),
      unassigned: [...state.unassigned, ...state.plans.filter((plan) => ids.has(plan.id)).flatMap((plan) => plan.assignedAssets ?? [])],
    };
  }
  return getImporterFlowReadiness(state).staging ? { ...state, stagingState: 'releasing' } : state;
}
