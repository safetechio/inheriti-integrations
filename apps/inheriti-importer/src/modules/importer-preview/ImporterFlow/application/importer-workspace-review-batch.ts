import {
  getCorePlanAssetTypes,
  getPlanAssetFormFields,
} from '@modules/plans/domain/asset-metadata';
import { bindField, unbindField } from '@modules/plans/domain/workspace-commands';
import type {
  AssetDraft,
  FieldBinding,
  PlanDraft,
  WorkspaceState,
} from '@modules/plans/domain/workspace-model';
import { listPlanDrafts } from '@modules/plans/domain/workspace-selectors';
import type { SuggestedAsset } from '@modules/mapping/domain/suggestion';
import { compatibleMappingUpdates } from '../../AssetReviewQueue/review-mapping';
import {
  hasIncludedSchemaField,
  type AssetReviewStatus,
  type ReviewAsset,
  type ReviewBatchAction,
  type ReviewBatchResult,
} from '../../AssetReviewQueue/types';
import {
  mappedFieldIds,
  requiresExactAssetMatch,
  statusKey,
} from './importer-workspace-suggestions';
import type { ReviewDecisions } from './importer-workspace-types';
import type { ImporterWorkspaceContext } from './use-importer-workspace';

interface DraftLocation {
  planClientId: string;
  index: number;
  draft: AssetDraft;
}

interface AppliedMapping {
  field: string;
  binding: Extract<FieldBinding, { kind: 'source' }>;
  drafts: (DraftLocation & { previousBinding?: FieldBinding })[];
}

export interface ReviewBatchEntry {
  nodeId: string;
  sourceId?: string;
  previousDecision?: AssetReviewStatus;
  decision: AssetReviewStatus;
  originalDrafts: DraftLocation[];
  mappings?: AppliedMapping[];
  preserveDecision?: boolean;
}

export type ReviewBatch = Map<string, ReviewBatchEntry>;

function updatePlanAssets(
  workspace: WorkspaceState,
  update: (plan: PlanDraft) => AssetDraft[],
): WorkspaceState {
  const plansByClientId = { ...workspace.plansByClientId };
  let changed = false;
  for (const plan of listPlanDrafts(workspace)) {
    const assets = update(plan);
    if (assets === plan.assets) continue;
    plansByClientId[plan.clientId] = { ...plan, assets };
    changed = true;
  }
  return changed ? { ...workspace, plansByClientId, revision: workspace.revision + 1 } : workspace;
}

/** Preserve other mappings and the latest decision when the user edits one field. */
export function invalidateReviewBatch(batch: ReviewBatch, id: string, field?: string): ReviewBatch {
  const entry = batch.get(id);
  if (!entry) return batch;
  const next = new Map(batch);
  const mappings = field && entry.mappings?.filter((mapping) => mapping.field !== field);
  if (mappings && mappings.length) next.set(id, { ...entry, mappings, preserveDecision: true });
  else next.delete(id);
  return next;
}

export function createReviewBatchActions(
  context: ImporterWorkspaceContext,
  decisions: ReviewDecisions,
  getBatch: () => ReviewBatch,
  recordBatch: (batch: ReviewBatch) => void,
  invalidateGlobalBatch: (ids: string[]) => void,
  onReviewChange?: () => void,
) {
  const {
    session,
    workspace,
    projection,
    mappingOverrides,
    setDecisions,
    setMappingOverrides,
    updateWorkspace,
  } = context;

  let draftIndex:
    | {
        byId: Map<string, DraftLocation[]>;
        byField: Map<string, DraftLocation[]>;
      }
    | undefined;

  function indexDrafts() {
    if (draftIndex) return draftIndex;
    const byId = new Map<string, DraftLocation[]>();
    const byField = new Map<string, DraftLocation[]>();
    function index(by: Map<string, DraftLocation[]>, key: string, location: DraftLocation) {
      const matches = by.get(key);
      if (matches) matches.push(location);
      else by.set(key, [location]);
    }
    for (const { clientId, assets } of listPlanDrafts(workspace)) {
      assets.forEach((draft, position) => {
        const location = { planClientId: clientId, index: position, draft };
        index(byId, draft.id, location);
        for (const binding of Object.values(draft.fieldBindings)) {
          if (binding.kind === 'source') index(byField, binding.sourceFieldId, location);
          if (binding.kind === 'sources')
            for (const { sourceFieldId } of binding.sources)
              index(byField, sourceFieldId, location);
        }
      });
    }
    draftIndex = { byId, byField };
    return draftIndex;
  }

  function requested(assets: ReviewAsset[]) {
    const rows = new Map(projection.assets.map((asset) => [asset.id, asset]));
    const suggestions = new Map(projection.suggestions.map((item) => [statusKey(item), item]));
    return [...new Set(assets.map((asset) => asset.id))].map((id) => ({
      id,
      asset: rows.get(id),
      suggestion: suggestions.get(id),
    }));
  }

  function assignedDrafts(suggestion: SuggestedAsset): DraftLocation[] {
    const { byId, byField } = indexDrafts();
    const exact = byId.get(statusKey(suggestion)) ?? [];
    if (requiresExactAssetMatch(session, suggestion)) return exact;
    const matches = new Set(exact);
    for (const field of mappedFieldIds(suggestion)) {
      for (const location of byField.get(field) ?? []) matches.add(location);
    }
    return [...matches];
  }

  function finish(batch: ReviewBatch, result: ReviewBatchResult) {
    invalidateGlobalBatch(result.changedIds);
    recordBatch(batch);
    setDecisions((current) => ({
      ...current,
      ...Object.fromEntries([...batch].map(([id, entry]) => [id, entry.decision])),
    }));
    onReviewChange?.();
  }

  function reviewAssets(action: ReviewBatchAction, assets: ReviewAsset[]): ReviewBatchResult {
    const result: ReviewBatchResult = { changedIds: [], skippedIds: [] };
    const batch: ReviewBatch = new Map();
    const decision = action === 'accept' ? 'accepted' : 'excluded';
    for (const { id, asset, suggestion } of requested(assets)) {
      if (
        !asset ||
        !suggestion ||
        asset.status === decision ||
        (action === 'accept' && !hasIncludedSchemaField(asset))
      ) {
        result.skippedIds.push(id);
        continue;
      }
      batch.set(id, {
        nodeId: suggestion.fromNodeId,
        sourceId: session.nodesById[suggestion.fromNodeId]?.sourceId,
        previousDecision: decisions[id],
        decision,
        originalDrafts: assignedDrafts(suggestion),
      });
      result.changedIds.push(id);
    }
    if (!batch.size) return result;

    const removedByPlan = new Map<string, Set<AssetDraft>>();
    for (const entry of batch.values()) {
      for (const { planClientId, draft } of action === 'exclude' ? entry.originalDrafts : []) {
        const assets = removedByPlan.get(planClientId) ?? new Set();
        assets.add(draft);
        removedByPlan.set(planClientId, assets);
      }
    }
    if (removedByPlan.size)
      updateWorkspace((current) =>
        updatePlanAssets(current, (plan) => {
          const removed = removedByPlan.get(plan.clientId);
          return removed && plan.assets.some((draft) => removed.has(draft))
            ? plan.assets.filter((draft) => !removed.has(draft))
            : plan.assets;
        }),
      );
    finish(batch, result);
    return result;
  }

  function ownsSourceField(suggestion: SuggestedAsset, sourceFieldId: string): boolean {
    const node = session.nodesById[suggestion.fromNodeId];
    const field = session.fieldsById[sourceFieldId];
    return Boolean(
      node &&
      field &&
      node.fieldIds.includes(sourceFieldId) &&
      field.parentNodeId === node.id &&
      field.sourceId === node.sourceId,
    );
  }

  function applyMappings(templateInput: ReviewAsset, assets: ReviewAsset[]): ReviewBatchResult {
    const result: ReviewBatchResult = { changedIds: [], skippedIds: [] };
    const batch: ReviewBatch = new Map();
    const [{ asset: template, suggestion: templateSuggestion }] = requested([templateInput]);
    const allowedFields = new Set(
      template && getCorePlanAssetTypes().some((type) => type === template.type)
        ? getPlanAssetFormFields(template.type).map((field) => field.source)
        : [],
    );

    for (const { id, asset, suggestion } of requested(assets)) {
      const mappings: AppliedMapping[] = [];
      let originalDrafts: DraftLocation[] = [];
      if (template && templateSuggestion && asset && suggestion) {
        const updates = compatibleMappingUpdates(template, asset);
        if (updates.length) originalDrafts = assignedDrafts(suggestion);
        for (const { targetField, sourceFieldId } of updates) {
          const originBinding = templateSuggestion.fieldBindings[targetField];
          if (
            !allowedFields.has(targetField) ||
            originBinding?.kind !== 'source' ||
            !ownsSourceField(templateSuggestion, originBinding.sourceFieldId) ||
            !ownsSourceField(suggestion, sourceFieldId) ||
            Object.hasOwn(mappingOverrides[id] ?? {}, targetField)
          )
            continue;

          const locations = originalDrafts.map((location) => ({
            ...location,
            previousBinding: location.draft.fieldBindings[targetField],
          }));
          const originalBinding = suggestion.fieldBindings[targetField];
          if (
            locations.some(
              ({ draft, previousBinding }) =>
                draft.type !== suggestion.type ||
                (previousBinding !== undefined
                  ? previousBinding.kind !== 'source' ||
                    originalBinding?.kind !== 'source' ||
                    previousBinding.sourceFieldId !== originalBinding.sourceFieldId
                  : originalBinding !== undefined),
            )
          )
            continue;
          mappings.push({
            field: targetField,
            binding: { kind: 'source', sourceFieldId },
            drafts: locations,
          });
        }
      }
      if (!suggestion || !mappings.length) {
        result.skippedIds.push(id);
        continue;
      }
      batch.set(id, {
        nodeId: suggestion.fromNodeId,
        sourceId: session.nodesById[suggestion.fromNodeId]?.sourceId,
        previousDecision: decisions[id],
        decision: 'needs-review',
        originalDrafts,
        mappings,
      });
      result.changedIds.push(id);
    }
    if (!batch.size) return result;

    setMappingOverrides((current) => {
      const next = { ...current };
      for (const [id, entry] of batch) {
        next[id] = { ...current[id] };
        for (const { field, binding } of entry.mappings ?? []) {
          if (!Object.hasOwn(next[id], field)) next[id][field] = binding.sourceFieldId;
        }
      }
      return next;
    });
    if (
      [...batch.values()].some((entry) => entry.mappings?.some((mapping) => mapping.drafts.length))
    )
      updateWorkspace((current) => {
        let next = current;
        for (const entry of batch.values()) {
          for (const { field, binding, drafts } of entry.mappings ?? []) {
            for (const { planClientId, draft, previousBinding } of drafts) {
              const latest = next.plansByClientId[planClientId]?.assets.find(
                (item) => item.id === draft.id && item.type === draft.type,
              );
              if (!latest || latest.fieldBindings[field] !== previousBinding) continue;
              next = bindField(next, {
                planClientId,
                assetId: draft.id,
                assetFieldSource: field,
                binding,
              });
            }
          }
        }
        return next;
      });
    finish(batch, result);
    return result;
  }

  function undoReviewBatch(): ReviewBatchResult {
    const batch = getBatch();
    const result: ReviewBatchResult = { changedIds: [], skippedIds: [] };
    if (!batch.size) return result;
    recordBatch(new Map());

    const restoredByPlan = new Map<string, DraftLocation[]>();
    const restoredIds = new Set<string>();
    const undoEntries: ReviewBatch = new Map();
    for (const [id, entry] of batch) {
      const current = context.byId(id);
      if (
        !current ||
        current.fromNodeId !== entry.nodeId ||
        session.nodesById[entry.nodeId]?.sourceId !== entry.sourceId
      ) {
        result.skippedIds.push(id);
        continue;
      }

      const assigned = assignedDrafts(current);
      const originalAssignments = new Set(entry.originalDrafts.map(({ draft }) => draft.id));
      if (
        entry.decision !== 'excluded' &&
        (assigned.length !== entry.originalDrafts.length ||
          assigned.some(({ draft }) => !originalAssignments.has(draft.id)))
      ) {
        result.skippedIds.push(id);
        continue;
      }
      if (entry.mappings) {
        const mappings = entry.mappings.filter(
          ({ field, binding, drafts }) =>
            mappingOverrides[id]?.[field] === binding.sourceFieldId &&
            drafts.every(({ draft }) => {
              const latest = assigned.find((item) => item.draft.id === draft.id)?.draft;
              return latest?.type === draft.type && latest.fieldBindings[field] === binding;
            }),
        );
        if (!mappings.length) {
          result.skippedIds.push(id);
          continue;
        }
        undoEntries.set(id, {
          ...entry,
          mappings,
          preserveDecision: entry.preserveDecision || mappings.length !== entry.mappings.length,
        });
      } else {
        const originalDrafts = entry.decision === 'excluded' ? entry.originalDrafts : [];
        const excludedDraftIds = new Set(originalDrafts.map(({ draft }) => draft.id));
        const hasExisting =
          entry.decision === 'excluded' &&
          (assigned.length > 0 ||
            originalDrafts.length !== excludedDraftIds.size ||
            [...excludedDraftIds].some((id) => indexDrafts().byId.has(id) || restoredIds.has(id)));
        const byPlan = new Map<string, DraftLocation[]>();
        for (const location of originalDrafts) {
          byPlan.set(location.planClientId, [
            ...(byPlan.get(location.planClientId) ?? []),
            location,
          ]);
        }
        const noRoom = [...byPlan].some(([planId, locations]) => {
          const plan = workspace.plansByClientId[planId];
          return (
            !plan ||
            plan.assets.length + (restoredByPlan.get(planId)?.length ?? 0) + locations.length > 10
          );
        });
        if (decisions[id] !== entry.decision || hasExisting || noRoom) {
          result.skippedIds.push(id);
          continue;
        }
        for (const [planId, locations] of byPlan) {
          restoredByPlan.set(planId, [...(restoredByPlan.get(planId) ?? []), ...locations]);
        }
        excludedDraftIds.forEach((id) => restoredIds.add(id));
        undoEntries.set(id, entry);
      }
      result.changedIds.push(id);
    }
    if (!undoEntries.size) return result;

    if ([...undoEntries.values()].some((entry) => entry.mappings?.length))
      setMappingOverrides((current) => {
        const next = { ...current };
        for (const [id, entry] of undoEntries) {
          if (!entry.mappings) continue;
          const overrides = { ...current[id] };
          for (const { field, binding } of entry.mappings) {
            if (overrides[field] === binding.sourceFieldId) delete overrides[field];
          }
          if (Object.keys(overrides).length) next[id] = overrides;
          else delete next[id];
        }
        return next;
      });

    if (
      restoredByPlan.size ||
      [...undoEntries.values()].some((entry) =>
        entry.mappings?.some((mapping) => mapping.drafts.length),
      )
    )
      updateWorkspace((current) => {
        let next = updatePlanAssets(current, (plan) => {
          const locations = restoredByPlan.get(plan.clientId);
          if (!locations?.length || plan.assets.length + locations.length > 10) return plan.assets;
          const assets = [...plan.assets];
          for (const { index, draft } of [...locations].sort((a, b) => a.index - b.index)) {
            if (!assets.some((item) => item.id === draft.id)) assets.splice(index, 0, draft);
          }
          return assets;
        });
        for (const entry of undoEntries.values()) {
          for (const { field, binding, drafts } of entry.mappings ?? []) {
            for (const { draft, previousBinding } of drafts) {
              const plan = listPlanDrafts(next).find((candidate) =>
                candidate.assets.some(
                  (item) =>
                    item.id === draft.id &&
                    item.type === draft.type &&
                    item.fieldBindings[field] === binding,
                ),
              );
              if (!plan) continue;
              const args = {
                planClientId: plan.clientId,
                assetId: draft.id,
                assetFieldSource: field,
              };
              next = previousBinding
                ? bindField(next, { ...args, binding: previousBinding })
                : unbindField(next, args);
            }
          }
        }
        return next;
      });

    invalidateGlobalBatch(result.changedIds);
    setDecisions((current) => {
      const next = { ...current };
      for (const [id, entry] of undoEntries) {
        if (entry.preserveDecision || current[id] !== entry.decision) continue;
        if (entry.previousDecision) next[id] = entry.previousDecision;
        else delete next[id];
      }
      return next;
    });
    onReviewChange?.();
    return result;
  }

  return { reviewAssets, applyMappings, undoReviewBatch };
}
