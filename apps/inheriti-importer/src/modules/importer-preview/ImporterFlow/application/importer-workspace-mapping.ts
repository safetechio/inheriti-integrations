import { SensitiveValue } from '@modules/import/domain/import-model';
import { bindField, unbindField } from '@modules/plans/domain/workspace-commands';
import { listPlanDrafts } from '@modules/plans/domain/workspace-selectors';
import type { WorkspaceState } from '@modules/plans/domain/workspace-model';
import type { ReviewAsset } from '../../AssetReviewQueue/types';
import type { ImporterWorkspaceContext } from './use-importer-workspace';
import { reconcileCompanion } from './importer-workspace-companion';
import { projectSuggestions } from './importer-workspace-projection';
import {
  assetMatchesSuggestion,
  sourceSuggestions,
  plainTextValueWithoutNote,
  statusKey,
} from './importer-workspace-suggestions';

export function createMappingActions(context: ImporterWorkspaceContext) {
  const {
    session,
    mappingOverrides,
    setPlainTextOverrides,
    setMappingOverrides,
    setDecisions,
    updateWorkspace,
    byId,
  } = context;

  function clearPlainTextOverride(asset: ReviewAsset) {
    asset.plainTextValue?.clear();
    setPlainTextOverrides((current) => {
      current[asset.id]?.clear();
      return Object.fromEntries(Object.entries(current).filter(([key]) => key !== asset.id));
    });
  }

  function recordMapping(
    assetId: string,
    targetField: string,
    sourceFieldId?: string,
    isPlainText = false,
  ) {
    setMappingOverrides((current) => {
      if (!isPlainText || sourceFieldId)
        return {
          ...current,
          [assetId]: { ...current[assetId], [targetField]: sourceFieldId },
        };
      const assetOverrides = { ...current[assetId] };
      delete assetOverrides[targetField];
      const next = { ...current };
      if (Object.keys(assetOverrides).length) next[assetId] = assetOverrides;
      else delete next[assetId];
      return next;
    });
  }

  /** Reset text through the same note partition used by the review. */
  function resetPlainTextBinding(suggestion: NonNullable<ReturnType<typeof byId>>) {
    const originals = sourceSuggestions(session);
    const overrides = { ...mappingOverrides };
    const key = statusKey(suggestion);
    const edits = { ...overrides[key] };
    delete edits['secret.text'];
    if (Object.keys(edits).length) overrides[key] = edits;
    else delete overrides[key];
    const converted = originals.find(
      (candidate) =>
        candidate.fromNodeId === suggestion.fromNodeId &&
        candidate.variant !== 'additional-fields' &&
        candidate.type !== 'PLAIN-TEXT',
    );
    const convertedIds =
      converted && suggestion.type === 'PLAIN-TEXT' && !suggestion.variant
        ? new Set([statusKey(converted)])
        : new Set<string>();
    return projectSuggestions(session, originals, overrides, {}, convertedIds).find(
      (candidate) => statusKey(candidate) === key,
    )?.fieldBindings['secret.text'];
  }

  function mappedWorkspace(
    current: WorkspaceState,
    suggestion: NonNullable<ReturnType<typeof byId>>,
    targetField: string,
    sourceFieldId?: string,
    isPlainTextValue = false,
  ): WorkspaceState {
    const reconciled = reconcileCompanion(context, current, suggestion, targetField, sourceFieldId);
    if (reconciled) return reconciled;
    for (const plan of listPlanDrafts(current)) {
      const draft = plan.assets.find((item) => assetMatchesSuggestion(session, item, suggestion));
      if (!draft) continue;
      const previousBinding = draft.fieldBindings[targetField];
      if (suggestion.type === 'PLAIN-TEXT' && targetField === 'meta.notes') {
        const restoredId =
          previousBinding?.kind === 'source' && previousBinding.sourceFieldId !== sourceFieldId
            ? previousBinding.sourceFieldId
            : undefined;
        const noteBinding = sourceFieldId
          ? bindField(current, {
              planClientId: plan.clientId,
              assetId: draft.id,
              assetFieldSource: targetField,
              binding: { kind: 'source', sourceFieldId },
            })
          : unbindField(current, {
              planClientId: plan.clientId,
              assetId: draft.id,
              assetFieldSource: targetField,
            });
        if (draft.fieldBindings['secret.text']?.kind === 'literal') return noteBinding;
        const textBinding = plainTextValueWithoutNote(
          session,
          suggestion,
          sourceFieldId,
          restoredId,
        );
        return textBinding
          ? bindField(noteBinding, {
              planClientId: plan.clientId,
              assetId: draft.id,
              assetFieldSource: 'secret.text',
              binding: textBinding,
            })
          : unbindField(noteBinding, {
              planClientId: plan.clientId,
              assetId: draft.id,
              assetFieldSource: 'secret.text',
            });
      }
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
      const fallbackBinding = resetPlainTextBinding(suggestion);
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
  }

  function mapAssetField(asset: ReviewAsset, targetField: string, sourceFieldId?: string) {
    const suggestion = byId(asset.id);
    if (!suggestion) return;
    const isPlainTextValue = suggestion.type === 'PLAIN-TEXT' && targetField === 'secret.text';
    if (isPlainTextValue) clearPlainTextOverride(asset);
    recordMapping(asset.id, targetField, sourceFieldId, isPlainTextValue);
    setDecisions((current) => ({ ...current, [asset.id]: 'needs-review' }));
    updateWorkspace((current) =>
      mappedWorkspace(current, suggestion, targetField, sourceFieldId, isPlainTextValue),
    );
  }

  function editPlainText(asset: ReviewAsset, value: string) {
    const suggestion = byId(asset.id);
    if (!suggestion || suggestion.type !== 'PLAIN-TEXT') return;
    asset.plainTextValue?.clear();
    setPlainTextOverrides((current) => {
      current[asset.id]?.clear();
      return { ...current, [asset.id]: new SensitiveValue(value) };
    });
    setDecisions((current) => ({ ...current, [asset.id]: 'needs-review' }));
    updateWorkspace((current) => {
      for (const plan of listPlanDrafts(current)) {
        const draft = plan.assets.find((item) => assetMatchesSuggestion(session, item, suggestion));
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

  return { mapAssetField, editPlainText };
}
