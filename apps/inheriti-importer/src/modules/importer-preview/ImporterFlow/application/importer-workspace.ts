import { useMemo, useState } from 'react';
import {
  getCorePlanAssetTypes,
  getPlanAssetFormFields,
  validateAssetEditorValues,
} from '@modules/plans/domain/asset-metadata';
import {
  SensitiveValue,
  type ImportSession,
  type ImportedField,
} from '@modules/import/domain/import-model';
import {
  fieldsOf,
  allFieldsAsPlainText,
  resolveSourceValue,
  suggestWithFallback,
  suggestedAssetToDraft,
} from '@modules/mapping/application/suggestion-engine';
import { FieldAliasSuggestionStrategy } from '@modules/mapping/application/strategies/field-alias-strategy';
import type { SuggestedAsset } from '@modules/mapping/domain/suggestion';
import {
  hasIncludedSchemaField,
  type ReviewAsset,
  type AssetReviewStatus,
} from '../../AssetReviewQueue/types';
import type {
  GroupingAsset,
  PlanDraft as PreviewPlanDraft,
  PlanMetadataValues,
} from '../../PlanGroupingSurface';
import type { AssetDraft, PlanDraft, WorkspaceState } from '@modules/plans/domain/workspace-model';
import {
  bindField,
  createAsset,
  createPlan,
  removePlan,
  removeAsset,
  unbindField,
  updatePlanMetadata,
} from '@modules/plans/domain/workspace-commands';
import { listPlanDrafts } from '@modules/plans/domain/workspace-selectors';
import { validatePlanForExecution } from '@modules/plans/domain/workspace-validation';
import { getAssetFieldDisplayName } from '@modules/_shared/domain/asset-field-display-name';
import { materialiseAsset } from '@modules/plans/domain/asset-materializer';

export type ImporterWorkspaceAction =
  'accept' | 'exclude' | 'alternate:PLAIN-TEXT' | 'restore-suggestion';

type WorkspaceSetter = (
  next: WorkspaceState | ((current: WorkspaceState) => WorkspaceState),
) => void;
type WorkspaceReplacer = (
  next: (current: WorkspaceState) => WorkspaceState,
  discard: (workspace: WorkspaceState) => void,
) => void;

export interface ImporterWorkspaceProjection {
  suggestions: SuggestedAsset[];
  assets: ReviewAsset[];
  unassigned: GroupingAsset[];
  plans: PreviewPlanDraft[];
}

type MappingOverrides = Record<string, Record<string, string | undefined>>;
type PlainTextOverrides = Record<string, SensitiveValue>;

const statusKey = (suggestion: SuggestedAsset) => `${suggestion.fromNodeId}:${suggestion.type}`;

function suggestionFields(session: ImportSession, suggestion: SuggestedAsset): ImportedField[] {
  const node = session.nodesById[suggestion.fromNodeId];
  return node ? fieldsOf(session, node) : [];
}

function applyMappingOverrides(
  suggestion: SuggestedAsset,
  overrides: MappingOverrides,
): SuggestedAsset {
  const changes = overrides[statusKey(suggestion)];
  if (!changes) return suggestion;
  const fieldBindings = { ...suggestion.fieldBindings };
  Object.entries(changes).forEach(([target, sourceFieldId]) => {
    if (sourceFieldId) fieldBindings[target] = { kind: 'source', sourceFieldId };
    else delete fieldBindings[target];
  });
  return { ...suggestion, fieldBindings };
}

function mappedFieldIds(suggestion: SuggestedAsset): Set<string> {
  return new Set(
    Object.values(suggestion.fieldBindings).flatMap((binding) =>
      binding.kind === 'source'
        ? [binding.sourceFieldId]
        : binding.kind === 'sources'
          ? binding.sources.map((source) => source.sourceFieldId)
          : [],
    ),
  );
}

function bindingUsesSource(binding: AssetDraft['fieldBindings'][string], sourceIds: Set<string>) {
  if (binding.kind === 'source') return sourceIds.has(binding.sourceFieldId);
  return (
    binding.kind === 'sources' &&
    binding.sources.some((source) => sourceIds.has(source.sourceFieldId))
  );
}

function suggestionValidationErrors(
  session: ImportSession,
  suggestion: SuggestedAsset,
): Record<string, string> {
  const draft = suggestedAssetToDraft(suggestion, crypto.randomUUID());
  const materialised = materialiseAsset(draft, session);
  const errors = validateAssetEditorValues(suggestion.type, {
    meta: materialised.asset.meta,
    secret: materialised.asset.secret,
  });
  for (const error of materialised.errors) errors[error.assetFieldSource] = error.message;
  return errors;
}

function reviewStatus(
  suggestion: SuggestedAsset,
  workspace: WorkspaceState,
  decisions: Record<string, AssetReviewStatus>,
): AssetReviewStatus {
  const key = statusKey(suggestion);
  if (decisions[key]) return decisions[key];
  const sourceIds = mappedFieldIds(suggestion);
  const assigned = listPlanDrafts(workspace).some((plan) =>
    plan.assets.some(
      (asset) =>
        asset.id === key ||
        Object.values(asset.fieldBindings).some((binding) => bindingUsesSource(binding, sourceIds)),
    ),
  );
  if (assigned) return 'accepted';
  if (suggestion.type === 'PLAIN-TEXT' || suggestion.confidence === 0) return 'fallback';
  return suggestion.confidence >= 0.75 ? 'suggested' : 'needs-review';
}

function assetMatchesSuggestion(asset: AssetDraft, suggestion: SuggestedAsset): boolean {
  if (asset.id === statusKey(suggestion)) return true;
  const sourceIds = mappedFieldIds(suggestion);
  if (Object.values(asset.fieldBindings).some((binding) => bindingUsesSource(binding, sourceIds)))
    return true;
  return false;
}

export function projectImporterWorkspace(
  session: ImportSession,
  workspace: WorkspaceState,
  decisions: Record<string, AssetReviewStatus> = {},
  mappingOverrides: MappingOverrides = {},
  plainTextOverrides: PlainTextOverrides = {},
  plainTextAssetIds: ReadonlySet<string> = new Set(),
): ImporterWorkspaceProjection {
  const suggestions = suggestWithFallback([new FieldAliasSuggestionStrategy()], {
    session,
    nodeIds: session.rootNodeIds,
    knownAssetTypes: new Set(getCorePlanAssetTypes()),
  }).map((suggestion) => {
    const converted = plainTextAssetIds.has(statusKey(suggestion))
      ? allFieldsAsPlainText(
          session.nodesById[suggestion.fromNodeId]!,
          suggestionFields(session, suggestion),
        )
      : suggestion;
    const mapped = applyMappingOverrides(converted, mappingOverrides);
    const value = plainTextOverrides[statusKey(converted)];
    if (converted.type !== 'PLAIN-TEXT' || !value) return mapped;
    return {
      ...mapped,
      fieldBindings: { 'secret.text': { kind: 'literal' as const, value } },
    };
  });
  const assets = suggestions.map((suggestion): ReviewAsset => {
    const fields = suggestionFields(session, suggestion);
    const mappedIds = mappedFieldIds(suggestion);
    const mapped = fields.filter((field) => mappedIds.has(field.id)).map((field) => field.name);
    const unmapped = fields.filter((field) => !mappedIds.has(field.id)).map((field) => field.name);
    const validationErrors = suggestionValidationErrors(session, suggestion);
    const projectedStatus = reviewStatus(suggestion, workspace, decisions);
    const status =
      Object.keys(validationErrors).length > 0 &&
      !['accepted', 'excluded'].includes(projectedStatus)
        ? 'needs-review'
        : projectedStatus;
    const schemaFields = getPlanAssetFormFields(suggestion.type)
      .filter((field) => field.source.startsWith('secret.'))
      .map((field) => {
        const binding = suggestion.fieldBindings[field.source];
        const candidates = fields.map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          length: candidate.value.length,
        }));
        return {
          key: field.source,
          label: getAssetFieldDisplayName(field.source),
          sourceFieldId: binding?.kind === 'source' ? binding.sourceFieldId : undefined,
          sourceFieldName:
            binding?.kind === 'source'
              ? fields.find((item) => item.id === binding.sourceFieldId)?.name
              : undefined,
          candidates,
          validationError: validationErrors[field.source],
        };
      });
    return {
      id: statusKey(suggestion),
      name: suggestion.name,
      type: suggestion.type,
      status,
      suggestionLabel:
        suggestion.type === 'PLAIN-TEXT'
          ? 'Plain Text fallback'
          : `Suggested ${suggestion.type === 'USER-PSWD' ? 'Username and Password' : 'API Key'}`,
      rationale: suggestion.rationale,
      mapped,
      unmapped,
      source: fields[0]
        ? `${session.sources.find((source) => source.id === fields[0].sourceId)?.fileName ?? 'Imported source'} · ${suggestion.name}`
        : 'Imported source',
      alternatives: suggestion.type === 'PLAIN-TEXT' ? [] : ['PLAIN-TEXT'],
      previewFields: mapped,
      schemaFields,
      plainTextValue:
        suggestion.fieldBindings['secret.text']?.kind === 'literal'
          ? suggestion.fieldBindings['secret.text'].value
          : undefined,
      plainTextSources:
        suggestion.fieldBindings['secret.text']?.kind === 'sources'
          ? suggestion.fieldBindings['secret.text'].sources.map((source) => ({
              id: source.sourceFieldId,
              name: source.name,
              length: session.fieldsById[source.sourceFieldId]?.value.length,
            }))
          : undefined,
      convertedFromType: [...plainTextAssetIds]
        .find((id) => id.slice(0, id.lastIndexOf(':')) === suggestion.fromNodeId)
        ?.slice(suggestion.fromNodeId.length + 1),
    };
  });
  const unassigned = suggestions
    .filter(
      (suggestion) =>
        reviewStatus(suggestion, workspace, decisions) === 'accepted' &&
        !listPlanDrafts(workspace).some((plan) =>
          plan.assets.some((asset) => assetMatchesSuggestion(asset, suggestion)),
        ),
    )
    .map((suggestion): GroupingAsset => ({
      id: statusKey(suggestion),
      name: suggestion.name,
      type: suggestion.type,
      valid: true,
    }));
  const plans = listPlanDrafts(workspace).map((plan): PreviewPlanDraft => {
    const validation = validatePlanForExecution(plan, session);
    const invalidAssetIds = new Set(validation.materialisationErrors.map((error) => error.assetId));
    return {
      id: plan.clientId,
      name: plan.name,
      description: plan.description,
      assets: plan.assets.length,
      capacity: `${plan.assets.length} / 10 Assets`,
      valid: validation.valid,
      assignedAssets: plan.assets.map((asset) => {
        const suggestion = suggestions.find((candidate) =>
          assetMatchesSuggestion(asset, candidate),
        );
        return {
          id: suggestion ? statusKey(suggestion) : asset.id,
          name: asset.name,
          type: asset.type,
          valid: !invalidAssetIds.has(asset.id),
        };
      }),
      governanceHint: validation.issues[0]?.message,
    };
  });
  return { suggestions, assets, unassigned, plans };
}

export function removeSourceFromWorkspace(
  session: ImportSession,
  workspace: WorkspaceState,
  sourceId: string,
): WorkspaceState {
  const fieldIds = new Set(
    Object.values(session.fieldsById)
      .filter((field) => field.sourceId === sourceId)
      .map((field) => field.id),
  );
  const nodeIds = new Set(
    Object.values(session.nodesById)
      .filter((node) => node.sourceId === sourceId)
      .map((node) => node.id),
  );
  const plansByClientId = Object.fromEntries(
    Object.entries(workspace.plansByClientId).flatMap(([id, plan]) => {
      const assets = plan.assets.filter(
        (asset) =>
          !nodeIds.has(asset.id.slice(0, asset.id.lastIndexOf(':'))) &&
          !Object.values(asset.fieldBindings).some((binding) =>
            bindingUsesSource(binding, fieldIds),
          ),
      );
      if (plan.assets.length > 0 && assets.length === 0) return [];
      return [[id, { ...plan, assets }]];
    }),
  );
  const planOrder = workspace.planOrder.filter((id) => Boolean(plansByClientId[id]));
  const ignoredSourceFieldIds = workspace.ignoredSourceFieldIds.filter((id) => !fieldIds.has(id));
  const changed =
    planOrder.length !== workspace.planOrder.length ||
    workspace.planOrder.some(
      (id) => plansByClientId[id]?.assets.length !== workspace.plansByClientId[id]?.assets.length,
    ) ||
    ignoredSourceFieldIds.length !== workspace.ignoredSourceFieldIds.length;

  return changed
    ? {
        ...workspace,
        planOrder,
        plansByClientId,
        ignoredSourceFieldIds,
        revision: workspace.revision + 1,
      }
    : workspace;
}

export function clearWorkspaceLiterals(
  workspace: WorkspaceState,
  nodeIds?: ReadonlySet<string>,
): void {
  for (const plan of Object.values(workspace.plansByClientId)) {
    for (const asset of plan.assets) {
      if (nodeIds && !nodeIds.has(asset.id.slice(0, asset.id.lastIndexOf(':')))) continue;
      for (const binding of Object.values(asset.fieldBindings)) {
        if (binding.kind === 'literal') binding.value.clear();
      }
    }
  }
}

export function useImporterWorkspace(
  session: ImportSession,
  workspace: WorkspaceState,
  setWorkspace: WorkspaceSetter,
  replaceWorkspace?: WorkspaceReplacer,
) {
  const [decisions, setDecisions] = useState<Record<string, AssetReviewStatus>>({});
  const [mappingOverrides, setMappingOverrides] = useState<MappingOverrides>({});
  const [plainTextOverrides, setPlainTextOverrides] = useState<PlainTextOverrides>({});
  const [plainTextAssetIds, setPlainTextAssetIds] = useState<Set<string>>(new Set());
  const [structuredSuggestions, setStructuredSuggestions] = useState<
    Record<string, SuggestedAsset>
  >({});
  const projection = useMemo(
    () =>
      projectImporterWorkspace(
        session,
        workspace,
        decisions,
        mappingOverrides,
        plainTextOverrides,
        plainTextAssetIds,
      ),
    [session, workspace, decisions, mappingOverrides, plainTextOverrides, plainTextAssetIds],
  );
  const byId = (id: string) =>
    projection.suggestions.find((suggestion) => statusKey(suggestion) === id);
  const updateWorkspace = (update: (current: WorkspaceState) => WorkspaceState) =>
    setWorkspace(update);

  function reviewAsset(action: ImporterWorkspaceAction, asset: ReviewAsset) {
    const suggestion = byId(asset.id);
    if (!suggestion) return;
    if (action === 'restore-suggestion' && asset.convertedFromType) {
      const originalId = `${suggestion.fromNodeId}:${asset.convertedFromType}`;
      const original = structuredSuggestions[originalId];
      if (!original) return;
      setPlainTextAssetIds((current) => {
        const next = new Set(current);
        next.delete(originalId);
        return next;
      });
      setPlainTextOverrides((current) => {
        current[asset.id]?.clear();
        return Object.fromEntries(Object.entries(current).filter(([key]) => key !== asset.id));
      });
      setDecisions((current) =>
        Object.fromEntries(Object.entries(current).filter(([key]) => key !== asset.id)),
      );
      updateWorkspace((current) => {
        for (const plan of listPlanDrafts(current)) {
          const draft = plan.assets.find((item) => item.id === asset.id);
          if (!draft) continue;
          const removed = removeAsset(current, { planClientId: plan.clientId, assetId: draft.id });
          return createAsset(removed, {
            planClientId: plan.clientId,
            asset: suggestedAssetToDraft(original, originalId),
          });
        }
        return current;
      });
      return;
    }
    if (action === 'alternate:PLAIN-TEXT' && suggestion.type !== 'PLAIN-TEXT') {
      const converted = allFieldsAsPlainText(
        session.nodesById[suggestion.fromNodeId]!,
        suggestionFields(session, suggestion),
      );
      const convertedId = statusKey(converted);
      setPlainTextAssetIds((current) => new Set(current).add(asset.id));
      setStructuredSuggestions((current) => ({ ...current, [asset.id]: suggestion }));
      setDecisions((current) => ({ ...current, [convertedId]: 'needs-review' }));
      updateWorkspace((current) => {
        for (const plan of listPlanDrafts(current)) {
          const draft = plan.assets.find((item) => assetMatchesSuggestion(item, suggestion));
          if (!draft) continue;
          const removed = removeAsset(current, { planClientId: plan.clientId, assetId: draft.id });
          return createAsset(removed, {
            planClientId: plan.clientId,
            asset: suggestedAssetToDraft(converted, convertedId),
          });
        }
        return current;
      });
      return;
    }
    if (action === 'accept' && !hasIncludedSchemaField(asset)) return;
    if (action === 'exclude') {
      updateWorkspace((current) => {
        let next = current;
        for (const plan of listPlanDrafts(current)) {
          for (const item of plan.assets) {
            if (assetMatchesSuggestion(item, suggestion)) {
              next = removeAsset(next, { planClientId: plan.clientId, assetId: item.id });
            }
          }
        }
        return next;
      });
    }
    setDecisions((current) => ({
      ...current,
      [asset.id]: action === 'exclude' ? 'excluded' : 'accepted',
    }));
  }

  function assignAsset(asset: GroupingAsset, plan: PreviewPlanDraft) {
    const suggestion = byId(asset.id);
    if (!suggestion || !workspace.plansByClientId[plan.id]) return;
    updateWorkspace((current) => {
      const target = current.plansByClientId[plan.id];
      if (!target || target.assets.some((item) => assetMatchesSuggestion(item, suggestion)))
        return current;
      return createAsset(current, {
        planClientId: plan.id,
        asset: suggestedAssetToDraft(suggestion, statusKey(suggestion)),
      });
    });
  }

  function mapAssetField(asset: ReviewAsset, targetField: string, sourceFieldId?: string) {
    const suggestion = byId(asset.id);
    if (!suggestion) return;
    const isPlainTextValue = suggestion.type === 'PLAIN-TEXT' && targetField === 'secret.text';
    if (isPlainTextValue) {
      asset.plainTextValue?.clear();
      setPlainTextOverrides((current) => {
        current[asset.id]?.clear();
        return Object.fromEntries(Object.entries(current).filter(([key]) => key !== asset.id));
      });
    }
    setMappingOverrides((current) => {
      if (!isPlainTextValue || sourceFieldId)
        return {
          ...current,
          [asset.id]: { ...current[asset.id], [targetField]: sourceFieldId },
        };
      const assetOverrides = { ...current[asset.id] };
      delete assetOverrides[targetField];
      const next = { ...current };
      if (Object.keys(assetOverrides).length) next[asset.id] = assetOverrides;
      else delete next[asset.id];
      return next;
    });
    setDecisions((current) => ({ ...current, [asset.id]: 'needs-review' }));
    updateWorkspace((current) => {
      for (const plan of listPlanDrafts(current)) {
        const draft = plan.assets.find((item) => assetMatchesSuggestion(item, suggestion));
        if (!draft) continue;
        const previousBinding = draft.fieldBindings[targetField];
        if (isPlainTextValue && previousBinding?.kind === 'literal') previousBinding.value.clear();
        if (!sourceFieldId && !isPlainTextValue)
          return unbindField(current, {
            planClientId: plan.clientId,
            assetId: draft.id,
            assetFieldSource: targetField,
          });
        if (sourceFieldId)
          return bindField(current, {
            planClientId: plan.clientId,
            assetId: draft.id,
            assetFieldSource: targetField,
            binding: { kind: 'source', sourceFieldId },
          });
        const fallbackBinding = allFieldsAsPlainText(
          session.nodesById[suggestion.fromNodeId]!,
          suggestionFields(session, suggestion),
        ).fieldBindings[targetField];
        if (!fallbackBinding)
          return unbindField(current, {
            planClientId: plan.clientId,
            assetId: draft.id,
            assetFieldSource: targetField,
          });
        return bindField(current, {
          planClientId: plan.clientId,
          assetId: draft.id,
          assetFieldSource: targetField,
          binding: fallbackBinding,
        });
      }
      return current;
    });
  }

  function editPlainText(asset: ReviewAsset, value: string) {
    const suggestion = byId(asset.id);
    if (!suggestion || suggestion.type !== 'PLAIN-TEXT') return;
    asset.plainTextValue?.clear();
    setPlainTextOverrides((current) => {
      current[asset.id]?.clear();
      return {
        ...current,
        [asset.id]: new SensitiveValue(value),
      };
    });
    setDecisions((current) => ({ ...current, [asset.id]: 'needs-review' }));
    updateWorkspace((current) => {
      for (const plan of listPlanDrafts(current)) {
        const draft = plan.assets.find((item) => assetMatchesSuggestion(item, suggestion));
        if (!draft) continue;
        return bindField(current, {
          planClientId: plan.clientId,
          assetId: draft.id,
          assetFieldSource: 'secret.text',
          binding: { kind: 'literal', value: new SensitiveValue(value) },
        });
      }
      return current;
    });
  }

  function unassignAsset(asset: GroupingAsset, plan: PreviewPlanDraft) {
    const productionPlan = workspace.plansByClientId[plan.id];
    const suggestion = byId(asset.id);
    const draft = productionPlan?.assets.find((item) =>
      suggestion ? assetMatchesSuggestion(item, suggestion) : item.id === asset.id,
    );
    if (draft)
      updateWorkspace((current) =>
        removeAsset(current, { planClientId: plan.id, assetId: draft.id }),
      );
  }

  function newPlan() {
    const clientId = crypto.randomUUID();
    updateWorkspace((current) =>
      createPlan(current, { clientId, name: `Plan ${current.planOrder.length + 1}` }),
    );
  }

  function deletePlan(plan: Pick<PreviewPlanDraft, 'id'>) {
    updateWorkspace((current) => removePlan(current, { clientId: plan.id }));
  }

  function editPlanMetadata(plan: Pick<PreviewPlanDraft, 'id'>, values: PlanMetadataValues) {
    updateWorkspace((current) =>
      updatePlanMetadata(current, {
        clientId: plan.id,
        name: values.name,
        description: values.description,
      }),
    );
  }

  function resetReview() {
    projection.suggestions.forEach((suggestion) => {
      Object.values(suggestion.fieldBindings).forEach((binding) => {
        if (binding.kind === 'literal') binding.value.clear();
      });
    });
    setDecisions({});
    setMappingOverrides({});
    setPlainTextOverrides((current) => {
      Object.values(current).forEach((value) => value.clear());
      return {};
    });
    setPlainTextAssetIds(new Set());
    setStructuredSuggestions({});
  }

  function removeSource(sourceId: string) {
    const nodeIds = new Set(
      Object.values(session.nodesById)
        .filter((node) => node.sourceId === sourceId)
        .map((node) => node.id),
    );
    const belongsToSource = (key: string) => nodeIds.has(key.slice(0, key.lastIndexOf(':')));
    projection.suggestions.forEach((suggestion) => {
      if (!nodeIds.has(suggestion.fromNodeId)) return;
      Object.values(suggestion.fieldBindings).forEach((binding) => {
        if (binding.kind === 'literal') binding.value.clear();
      });
    });
    setDecisions((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !belongsToSource(key))),
    );
    setMappingOverrides((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !belongsToSource(key))),
    );
    setPlainTextOverrides((current) => {
      Object.entries(current).forEach(([key, value]) => {
        if (belongsToSource(key)) value.clear();
      });
      return Object.fromEntries(Object.entries(current).filter(([key]) => !belongsToSource(key)));
    });
    setPlainTextAssetIds((current) => new Set([...current].filter((key) => !belongsToSource(key))));
    setStructuredSuggestions((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !belongsToSource(key))),
    );
    const remove = (current: WorkspaceState) =>
      removeSourceFromWorkspace(session, current, sourceId);
    const clear = (discarded: WorkspaceState) => clearWorkspaceLiterals(discarded, nodeIds);
    if (replaceWorkspace) replaceWorkspace(remove, clear);
    else updateWorkspace(remove);
  }

  return {
    ...projection,
    reviewAsset,
    assignAsset,
    unassignAsset,
    mapAssetField,
    editPlainText,
    resolveSourceValue: (sourceFieldId: string) => resolveSourceValue(session, sourceFieldId),
    createPlan: newPlan,
    deletePlan,
    updatePlanMetadata: editPlanMetadata,
    resetReview,
    removeSource,
  };
}

export type { AssetDraft, PlanDraft };
