import {
  makePlanDraft,
  type AssetDraft,
  type FieldBinding,
  type PlanDraft,
  type WorkspaceState,
} from '@modules/plans/domain/workspace-model';

/**
 * Every workspace mutation is a pure `(state, args) -> state` command that
 * returns a new `WorkspaceState` with `revision` bumped. DnD in the UI only ever
 * emits these — it never mutates directly.
 */

type Command<Args extends unknown[]> = (state: WorkspaceState, ...args: Args) => WorkspaceState;

export interface PlanDetailsCommandInput {
  clientId: string;
  name: string;
  description?: string;
  categoryId: string | null;
  sharingModel: 'SHARED' | 'PRIVATE';
  moderatedAccess: boolean;
  authenticationMethodIds: string[];
  teamIds?: string[];
  authenticationMode?: 'EXCLUSIVE' | 'ALL_REQUIRED';
  approvalMode?: 'THRESHOLD' | 'UNANIMOUS';
  requestedMinimumApprovals?: number;
}

export interface PlanMetadataCommandInput {
  clientId: string;
  name: string;
  description?: string;
}

function next(state: WorkspaceState, patch: Partial<WorkspaceState>): WorkspaceState {
  return { ...state, ...patch, revision: state.revision + 1 };
}

function withPlan(
  state: WorkspaceState,
  clientId: string,
  update: (plan: PlanDraft) => PlanDraft,
): WorkspaceState {
  const plan = state.plansByClientId[clientId];
  if (!plan) return state;
  return next(state, {
    plansByClientId: { ...state.plansByClientId, [clientId]: update(plan) },
  });
}

export const createPlan: Command<[{ clientId: string; name: string }]> = (
  state,
  { clientId, name },
) => {
  if (state.plansByClientId[clientId]) return state;
  return next(state, {
    planOrder: [...state.planOrder, clientId],
    plansByClientId: { ...state.plansByClientId, [clientId]: makePlanDraft(clientId, name) },
  });
};

export const renamePlan: Command<[{ clientId: string; name: string }]> = (
  state,
  { clientId, name },
) => withPlan(state, clientId, (plan) => ({ ...plan, name }));

export const updatePlanMetadata: Command<[PlanMetadataCommandInput]> = (state, details) => {
  const name = details.name.trim();
  if (!name) return state;
  const description = details.description?.trim();
  return withPlan(state, details.clientId, (plan) => ({
    ...plan,
    name,
    description: description || undefined,
  }));
};

export const updatePlanDetails: Command<[PlanDetailsCommandInput]> = (state, details) =>
  withPlan(state, details.clientId, (plan) => ({
    ...plan,
    name: details.name,
    description: details.description,
    categoryId: details.categoryId,
    governance: {
      ...plan.governance,
      sharingModel: details.sharingModel,
      moderatedAccess: details.moderatedAccess,
      authenticationMethodIds: [...details.authenticationMethodIds],
      teamIds: details.teamIds ? [...details.teamIds] : plan.teamIds,
      authenticationMode: details.authenticationMode,
      approvalMode: details.approvalMode,
      requestedMinimumApprovals: details.requestedMinimumApprovals,
    },
  }));

export const setPlanCategory: Command<[{ clientId: string; categoryId: string | null }]> = (
  state,
  { clientId, categoryId },
) => withPlan(state, clientId, (plan) => ({ ...plan, categoryId }));

export const setPlanTeams: Command<[{ clientId: string; teamIds: string[] }]> = (
  state,
  { clientId, teamIds },
) => withPlan(state, clientId, (plan) => ({ ...plan, teamIds: [...teamIds] }));

export const removePlan: Command<[{ clientId: string }]> = (state, { clientId }) => {
  if (!state.plansByClientId[clientId]) return state;
  const plansByClientId = { ...state.plansByClientId };
  delete plansByClientId[clientId];
  return next(state, {
    planOrder: state.planOrder.filter((id) => id !== clientId),
    plansByClientId,
  });
};

export const reorderPlans: Command<[{ order: string[] }]> = (state, { order }) => {
  const known = new Set(state.planOrder);
  const cleaned = order.filter((id) => known.has(id));
  if (cleaned.length !== state.planOrder.length) return state;
  return next(state, { planOrder: cleaned });
};

export const createAsset: Command<[{ planClientId: string; asset: AssetDraft }]> = (
  state,
  { planClientId, asset },
) => withPlan(state, planClientId, (plan) => ({ ...plan, assets: [...plan.assets, asset] }));

export const editAsset: Command<[{ planClientId: string; asset: AssetDraft }]> = (
  state,
  { planClientId, asset },
) =>
  withPlan(state, planClientId, (plan) => ({
    ...plan,
    assets: plan.assets.map((a) => (a.id === asset.id ? asset : a)),
  }));

export const removeAsset: Command<[{ planClientId: string; assetId: string }]> = (
  state,
  { planClientId, assetId },
) =>
  withPlan(state, planClientId, (plan) => ({
    ...plan,
    assets: plan.assets.filter((a) => a.id !== assetId),
  }));

export const moveAsset: Command<
  [{ fromPlanClientId: string; toPlanClientId: string; assetId: string }]
> = (state, { fromPlanClientId, toPlanClientId, assetId }) => {
  const from = state.plansByClientId[fromPlanClientId];
  const to = state.plansByClientId[toPlanClientId];
  if (!from || !to || fromPlanClientId === toPlanClientId) return state;
  const asset = from.assets.find((a) => a.id === assetId);
  if (!asset) return state;
  return next(state, {
    plansByClientId: {
      ...state.plansByClientId,
      [fromPlanClientId]: { ...from, assets: from.assets.filter((a) => a.id !== assetId) },
      [toPlanClientId]: { ...to, assets: [...to.assets, asset] },
    },
  });
};

export const bindField: Command<
  [{ planClientId: string; assetId: string; assetFieldSource: string; binding: FieldBinding }]
> = (state, { planClientId, assetId, assetFieldSource, binding }) =>
  withPlan(state, planClientId, (plan) => ({
    ...plan,
    assets: plan.assets.map((a) =>
      a.id === assetId
        ? { ...a, fieldBindings: { ...a.fieldBindings, [assetFieldSource]: binding } }
        : a,
    ),
  }));

export const unbindField: Command<
  [{ planClientId: string; assetId: string; assetFieldSource: string }]
> = (state, { planClientId, assetId, assetFieldSource }) =>
  withPlan(state, planClientId, (plan) => ({
    ...plan,
    assets: plan.assets.map((a) => {
      if (a.id !== assetId) return a;
      const fieldBindings = { ...a.fieldBindings };
      delete fieldBindings[assetFieldSource];
      return { ...a, fieldBindings };
    }),
  }));

export const ignoreSourceField: Command<[{ sourceFieldId: string }]> = (
  state,
  { sourceFieldId },
) =>
  state.ignoredSourceFieldIds.includes(sourceFieldId)
    ? state
    : next(state, { ignoredSourceFieldIds: [...state.ignoredSourceFieldIds, sourceFieldId] });

export const unignoreSourceField: Command<[{ sourceFieldId: string }]> = (
  state,
  { sourceFieldId },
) =>
  next(state, {
    ignoredSourceFieldIds: state.ignoredSourceFieldIds.filter((id) => id !== sourceFieldId),
  });
