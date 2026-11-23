import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { replaceEqualDeep } from '@tanstack/react-query';
import { type ImportSession } from '@modules/import/domain/import-model';
import { getAssetFieldDisplayName } from '@modules/_shared/domain/asset-field-display-name';
import {
  getImportablePlanAssetTypes,
  getPlanAssetFormFields,
} from '@modules/plans/domain/asset-metadata';
import { resolveSourceValue } from '@modules/mapping/application/suggestion-engine';
import type { SuggestedAsset } from '@modules/mapping/domain/suggestion';
import type { AssetReviewStatus, ReviewAsset } from '../../AssetReviewQueue/types';
import type { WorkspaceState } from '@modules/plans/domain/workspace-model';
import {
  type ImporterWorkspaceProjection,
  type MappingOverrides,
  type PlainTextOverrides,
  type ReviewDecisions,
  type AssetTypeOverrides,
  type WorkspaceReplacer,
  type WorkspaceSetter,
  type FieldOrganization,
} from './importer-workspace-types';
import { projectImporterWorkspace } from './importer-workspace-projection';
import {
  assetMatchesSuggestion,
  originalSuggestionFor,
  sourceSuggestions,
  statusKey,
} from './importer-workspace-suggestions';
import { listPlanDrafts } from '@modules/plans/domain/workspace-selectors';
import { createReviewActions } from './importer-workspace-review';
import {
  createReviewBatchActions,
  invalidateReviewBatch,
  type ReviewBatch,
  type ReviewBatchEntry,
} from './importer-workspace-review-batch';
import { createMappingActions } from './importer-workspace-mapping';
import { createPlanActions } from './importer-workspace-plans';
import { createSourceActions } from './importer-workspace-source';
import { createPreservationActions } from './importer-workspace-preservation';
import type { PreservationChoices } from './importer-workspace-notes';
import {
  failedFieldOperation,
  isolateDuplicatedText,
  planFieldOperation,
  type FieldOperationChange,
} from './importer-workspace-field-operations';
import { clearRemovedDraftLiterals, planDraftRemoval } from './importer-workspace-draft-removal';
import type { FieldOperationControls } from '../../AssetReviewQueue/field-operations';
import { canReviewAsset, hasIncludedSchemaField } from '../../AssetReviewQueue/types';

export interface ImporterWorkspaceContext {
  session: ImportSession;
  sourceOriginals?: SuggestedAsset[];
  workspace: WorkspaceState;
  preservation: PreservationChoices;
  organization: FieldOrganization;
  projection: ImporterWorkspaceProjection;
  mappingOverrides: MappingOverrides;
  plainTextOverrides: PlainTextOverrides;
  plainTextAssetIds: ReadonlySet<string>;
  structuredSuggestions: Record<string, SuggestedAsset>;
  typeOverrides: AssetTypeOverrides;
  setOrganization: Dispatch<SetStateAction<FieldOrganization>>;
  setTypeOverrides: Dispatch<SetStateAction<AssetTypeOverrides>>;
  setDecisions: Dispatch<SetStateAction<ReviewDecisions>>;
  setMappingOverrides: Dispatch<SetStateAction<MappingOverrides>>;
  setPlainTextOverrides: Dispatch<SetStateAction<PlainTextOverrides>>;
  setPlainTextAssetIds: Dispatch<SetStateAction<Set<string>>>;
  setStructuredSuggestions: Dispatch<SetStateAction<Record<string, SuggestedAsset>>>;
  updateWorkspace: (update: (current: WorkspaceState) => WorkspaceState) => void;
  replaceWorkspace?: WorkspaceReplacer;
  byId: (id: string) => SuggestedAsset | undefined;
}

export function useImporterWorkspace(
  session: ImportSession,
  workspace: WorkspaceState,
  setWorkspace: WorkspaceSetter,
  replaceWorkspace?: WorkspaceReplacer,
  onReviewChange?: () => void,
) {
  const [decisions, setDecisions] = useState<Record<string, AssetReviewStatus>>({});
  const selectedBatch = useRef<ReviewBatch>(new Map());
  const [canUndoReviewBatch, setCanUndoReviewBatch] = useState(false);
  const lastBatch = useRef<Record<string, AssetReviewStatus | undefined> | null>(null);
  const [mappingOverrides, setMappingOverrides] = useState<MappingOverrides>({});
  const [plainTextOverrides, setPlainTextOverrides] = useState<PlainTextOverrides>({});
  const [plainTextAssetIds, setPlainTextAssetIds] = useState<Set<string>>(new Set());
  const [structuredSuggestions, setStructuredSuggestions] = useState<
    Record<string, SuggestedAsset>
  >({});
  const [typeOverrides, setTypeOverrides] = useState<AssetTypeOverrides>({});
  const [organization, setOrganization] = useState<FieldOrganization>({ assets: {}, owners: {} });
  const [preservation, setPreservation] = useState<PreservationChoices>({});
  const sourceOriginals = useMemo(() => sourceSuggestions(session), [session]);
  const latestProjection = useRef<{
    session: ImportSession;
    projection: ImporterWorkspaceProjection;
  } | null>(null);
  const projection = useMemo(
    () => {
      const next = projectImporterWorkspace(
        session,
        workspace,
        decisions,
        mappingOverrides,
        plainTextOverrides,
        plainTextAssetIds,
        typeOverrides,
        preservation,
        organization,
        sourceOriginals,
      );
      const previous = latestProjection.current;
      // Every revision needs its own projection identity for field-operation previews.
      return previous?.session === session
        ? { ...replaceEqualDeep(previous.projection, next) }
        : next;
    },
    [
      session,
      workspace,
      decisions,
      mappingOverrides,
      plainTextOverrides,
      plainTextAssetIds,
      typeOverrides,
      preservation,
      organization,
      sourceOriginals,
    ],
  );
  const context: ImporterWorkspaceContext = {
    session,
    sourceOriginals,
    workspace,
    organization,
    preservation: { ...preservation, ignored: new Set(workspace.ignoredSourceFieldIds) },
    projection,
    mappingOverrides,
    plainTextOverrides,
    plainTextAssetIds,
    structuredSuggestions,
    typeOverrides,
    setOrganization,
    setTypeOverrides,
    setDecisions,
    setMappingOverrides,
    setPlainTextOverrides,
    setPlainTextAssetIds,
    setStructuredSuggestions,
    updateWorkspace: (update) => setWorkspace(update),
    replaceWorkspace,
    byId: (id) => projection.suggestions.find((suggestion) => statusKey(suggestion) === id),
  };

  const pending = useRef<{
    projection: ImporterWorkspaceProjection;
    token: symbol;
    sourceAssetId: string;
    change?: FieldOperationChange;
  } | null>(null);
  const edits = { plainTextOverrides, plainTextAssetIds, typeOverrides };
  const [fieldUndo, setFieldUndo] = useState<{
    before: Omit<FieldOperationChange, 'result'>;
    after: Omit<FieldOperationChange, 'result'>;
    session: ImportSession;
    changedAssetIds: string[];
    removedAssetIds?: string[];
    beforeEdits: typeof edits;
    afterEdits: typeof edits;
  } | null>(null);
  const canUndoFields = Boolean(
    fieldUndo &&
    fieldUndo.session === session &&
    fieldUndo.after.workspace === workspace &&
    fieldUndo.after.organization === organization &&
    fieldUndo.after.decisions === decisions &&
    fieldUndo.after.preservation === preservation &&
    fieldUndo.after.mappings === mappingOverrides &&
    fieldUndo.afterEdits.plainTextOverrides === plainTextOverrides &&
    fieldUndo.afterEdits.plainTextAssetIds === plainTextAssetIds &&
    fieldUndo.afterEdits.typeOverrides === typeOverrides,
  );
  const undoLiterals = useRef<{ undo: typeof fieldUndo; live: ImporterWorkspaceContext }>({
    undo: null,
    live: context,
  });
  useLayoutEffect(() => {
    const nextUndo = canUndoFields ? fieldUndo : null;
    const previous = undoLiterals.current.undo;
    if (previous?.removedAssetIds && previous !== nextUndo)
      clearRemovedDraftLiterals(
        previous.removedAssetIds,
        { ...previous.before, ...previous.beforeEdits },
        context,
        nextUndo ? { ...nextUndo.before, ...nextUndo.beforeEdits } : undefined,
      );
    undoLiterals.current = { undo: nextUndo, live: context };
  });
  useLayoutEffect(() => () => {
    const { undo, live } = undoLiterals.current;
    if (undo?.removedAssetIds)
      clearRemovedDraftLiterals(undo.removedAssetIds, { ...undo.before, ...undo.beforeEdits }, live);
  }, []);
  useLayoutEffect(() => {
    latestProjection.current = { session, projection };
    if (pending.current?.projection !== projection) pending.current = null;
    if (fieldUndo && !canUndoFields) setFieldUndo(null);
  }, [session, projection, fieldUndo, canUndoFields]);
  const invalidateFieldOperation = () => {
    pending.current = null;
    setFieldUndo(null);
  };
  const notifyReviewChange = () => {
    invalidateFieldOperation();
    onReviewChange?.();
  };
  const applyFieldChange = (next: Omit<FieldOperationChange, 'result'>) => {
    setOrganization(next.organization);
    setPreservation(next.preservation);
    setMappingOverrides(next.mappings);
    setDecisions(next.decisions);
    setWorkspace(next.workspace);
  };
  function applyFieldEdits(next: typeof edits) {
    setPlainTextOverrides(next.plainTextOverrides);
    setPlainTextAssetIds(next.plainTextAssetIds);
    setTypeOverrides(next.typeOverrides);
  }
  function commitFieldChange(
    change: FieldOperationChange,
    changedAssetIds: string[],
    nextEdits = edits,
    invalidateReviewHistory = () => {
      lastBatch.current = null;
      recordBatch(new Map());
    },
  ) {
    pending.current = null;
    invalidateReviewHistory();
    setFieldUndo({
      before: { organization, preservation, mappings: mappingOverrides, decisions, workspace },
      after: change,
      session,
      changedAssetIds,
      removedAssetIds: change.result.removedAssetIds,
      beforeEdits: edits,
      afterEdits: nextEdits,
    });
    applyFieldChange(change);
    if (nextEdits !== edits) applyFieldEdits(nextEdits);
    onReviewChange?.();
    return change.result;
  }
  const assetTypes = getImportablePlanAssetTypes();
  const fieldOperations: FieldOperationControls = {
    assetTypes,
    schemaFields: (type) =>
      getPlanAssetFormFields(type)
        .filter((field) => field.source.startsWith('secret.'))
        .map((field) => ({ key: field.source, label: getAssetFieldDisplayName(field.source) })),
    canUndo: canUndoFields,
    preview(request) {
      const { preview, change } = planFieldOperation(context, decisions, request);
      if (latestProjection.current?.projection === projection)
        pending.current = {
          projection,
          token: preview.token,
          change,
          sourceAssetId: request.sourceAssetId,
        };
      return preview;
    },
    commit(preview) {
      const operation = pending.current;
      if (
        !operation?.change ||
        operation.token !== preview.token ||
        operation.projection !== projection ||
        operation.projection !== latestProjection.current?.projection
      )
        return failedFieldOperation('The review changed. Preview this operation again.');
      const { change } = operation;
      isolateDuplicatedText(change);
      return commitFieldChange(change, [operation.sourceAssetId]);
    },
    remove(assetIds) {
      if (latestProjection.current?.projection !== projection)
        return failedFieldOperation('The selection changed. Select the drafts again.');
      const removal = planDraftRemoval(context, decisions, assetIds);
      return removal.change
        ? commitFieldChange(removal.change, removal.result.removedAssetIds, removal.edits)
        : removal.result;
    },
    undo() {
      if (!canUndoFields || !fieldUndo || latestProjection.current?.projection !== projection)
        return failedFieldOperation('There is no field operation to undo.');
      for (const [id, asset] of Object.entries(fieldUndo.after.organization.assets)) {
        if (fieldUndo.before.organization.assets[id]) continue;
        for (const binding of Object.values(asset.fieldBindings)) {
          if (binding.kind === 'literal') binding.value.clear();
        }
      }
      const restored = {
        ...fieldUndo.before,
        workspace: { ...fieldUndo.before.workspace, revision: workspace.revision + 1 },
      };
      applyFieldChange(restored);
      applyFieldEdits(fieldUndo.beforeEdits);
      notifyReviewChange();
      return {
        success: true,
        message: 'Field operation undone.',
        createdAssetIds: [],
        changedAssetIds: fieldUndo.changedAssetIds,
      };
    },
  };

  const sourceActions = createSourceActions(context);
  const reviewActions = createReviewActions(context);
  const mappingActions = createMappingActions(context);
  const invalidateGlobalBatch = (ids: string[]) => {
    if (!lastBatch.current) return;
    for (const id of ids) delete lastBatch.current[id];
  };
  const recordBatch = (batch: ReviewBatch) => {
    selectedBatch.current = batch;
    setCanUndoReviewBatch(batch.size > 0);
  };
  const invalidateBatchAsset = (id: string, field?: string) => {
    invalidateGlobalBatch([id]);
    recordBatch(invalidateReviewBatch(selectedBatch.current, id, field));
  };
  const discardSelectedEntries = (discard: (id: string, entry: ReviewBatchEntry) => boolean) => {
    if (!selectedBatch.current.size) return;
    recordBatch(new Map([...selectedBatch.current].filter(([id, entry]) => !discard(id, entry))));
  };
  const clearSelectedSource = (sourceId?: string) => {
    discardSelectedEntries((_id, entry) => {
      if (sourceId !== undefined && entry.sourceId !== sourceId) return false;
      if (entry.decision === 'excluded') {
        for (const { draft } of entry.originalDrafts) {
          for (const binding of Object.values(draft.fieldBindings)) {
            if (binding.kind === 'literal') binding.value.clear();
          }
        }
      }
      return true;
    });
  };
  const batchActions = createReviewBatchActions(
    context,
    decisions,
    () => selectedBatch.current,
    recordBatch,
    invalidateGlobalBatch,
    notifyReviewChange,
  );
  function clearOrganizedAssets(sourceId?: string) {
    const assets = { ...organization.assets };
    for (const [id, suggestion] of Object.entries(assets)) {
      if (sourceId && session.nodesById[suggestion.fromNodeId]?.sourceId !== sourceId) continue;
      for (const binding of Object.values(suggestion.fieldBindings)) {
        if (binding.kind === 'literal') binding.value.clear();
      }
      delete assets[id];
    }
    const owners = Object.fromEntries(
      Object.entries(organization.owners).filter(([, id]) => assets[id]),
    );
    const names = sourceId
      ? Object.fromEntries(
          Object.entries(organization.names ?? {}).filter(([id]) => {
            const nodeId = id.slice(0, id.lastIndexOf(':'));
            return session.nodesById[nodeId]?.sourceId !== sourceId;
          }),
        )
      : undefined;
    const generatedAssetIds = new Set(
      [...(organization.generatedAssetIds ?? [])].filter((id) => Object.hasOwn(assets, id)),
    );
    const releasedFieldIds = sourceId
      ? new Set(
          [...(organization.releasedFieldIds ?? [])].filter(
            (id) => session.fieldsById[id]?.sourceId !== sourceId,
          ),
        )
      : undefined;
    setOrganization({ assets, owners, names, generatedAssetIds, releasedFieldIds });
  }
  const preservationActions = createPreservationActions(
    context,
    decisions,
    setPreservation,
    (ids) => {
      ids.forEach((id) => invalidateBatchAsset(id));
      notifyReviewChange();
    },
    (change) =>
      commitFieldChange(
        { ...change, organization, preservation, mappings: mappingOverrides },
        change.result.changedAssetIds,
        edits,
        () => change.result.changedAssetIds.forEach((id) => invalidateBatchAsset(id)),
      ),
  );
  return {
    ...projection,
    ...preservationActions,
    ...reviewActions,
    ...mappingActions,
    ...createPlanActions(context),
    ...sourceActions,
    ...batchActions,
    canUndoReviewBatch,
    fieldOperations,
    renameAsset: (asset: ReviewAsset, value: string) => {
      const suggestion = context.byId(asset.id);
      const name = value.trim();
      if (!suggestion || !name || name.length > 160) return false;
      if (name === suggestion.name) return true;
      const original = originalSuggestionFor(session, sourceOriginals, suggestion);
      const id = original ? statusKey(original) : asset.id;
      setOrganization((current) => ({
        ...current,
        names: { ...current.names, [id]: name },
      }));
      setWorkspace((current) => {
        const plansByClientId = { ...current.plansByClientId };
        let changed = false;
        for (const plan of listPlanDrafts(current)) {
          const assets = plan.assets.map((draft) => {
            if (!assetMatchesSuggestion(session, draft, suggestion)) return draft;
            changed = true;
            return { ...draft, name };
          });
          plansByClientId[plan.clientId] = { ...plan, assets };
        }
        return changed ? { ...current, plansByClientId, revision: current.revision + 1 } : current;
      });
      notifyReviewChange();
      return true;
    },
    reviewAsset: (
      action: Parameters<typeof reviewActions.reviewAsset>[0],
      requested: ReviewAsset,
    ) => {
      const asset = context.projection.assets.find(({ id }) => id === requested.id);
      if (!asset || (asset.status === 'excluded' && action !== 'restore')) return;
      // An assigned asset can appear accepted before its decision is recorded.
      if (
        action === 'accept' &&
        (decisions[asset.id] === 'accepted' || !hasIncludedSchemaField(asset))
      )
        return;
      if ((action === 'exclude' || action === 'restore') && !canReviewAsset(action, asset)) return;
      const alternate = action.startsWith('alternate:');
      if (alternate && !assetTypes.some((type) => action === `alternate:${type}`))
        return;
      invalidateBatchAsset(asset.id);
      if (alternate || action === 'restore-suggestion') {
        const suggestion = context.byId(asset.id);
        if (suggestion)
          discardSelectedEntries((_id, entry) => entry.nodeId === suggestion.fromNodeId);
      }
      reviewActions.reviewAsset(action, asset);
      notifyReviewChange();
    },
    mapAssetField: (...args: Parameters<typeof mappingActions.mapAssetField>) => {
      invalidateBatchAsset(args[0].id, args[1]);
      const suggestion = context.byId(args[0].id);
      if (suggestion && !suggestion.variant)
        discardSelectedEntries(
          (id, entry) => id !== args[0].id && entry.nodeId === suggestion.fromNodeId,
        );
      mappingActions.mapAssetField(...args);
      notifyReviewChange();
    },
    editPlainText: (...args: Parameters<typeof mappingActions.editPlainText>) => {
      invalidateBatchAsset(args[0].id);
      mappingActions.editPlainText(...args);
      notifyReviewChange();
    },
    resetReview: () => {
      lastBatch.current = null;
      clearSelectedSource();
      setPreservation({});
      clearOrganizedAssets();

      sourceActions.resetReview();
      notifyReviewChange();
    },
    removeSource: (sourceId: string) => {
      lastBatch.current = null;
      clearSelectedSource(sourceId);
      clearOrganizedAssets(sourceId);
      const belongsToSource = (nodeId: string) => session.nodesById[nodeId]?.sourceId === sourceId;
      setPreservation((current) => ({
        sourceNotes: Object.fromEntries(
          Object.entries(current.sourceNotes ?? {}).filter(([id]) => id !== sourceId),
        ),
        entryNotes: Object.fromEntries(
          Object.entries(current.entryNotes ?? {}).filter(([id]) => !belongsToSource(id)),
        ),
        rescued: new Set(
          [...(current.rescued ?? [])].filter(
            (id) => session.fieldsById[id]?.sourceId !== sourceId,
          ),
        ),
        publicSkippedEntries: new Set(
          [...(current.publicSkippedEntries ?? [])].filter((id) => !belongsToSource(id)),
        ),
      }));
      sourceActions.removeSource(sourceId);
      notifyReviewChange();
    },
    acceptAllEligible: () => {
      const eligible = projection.assets.filter(
        (asset) =>
          !['accepted', 'excluded'].includes(asset.status) && hasIncludedSchemaField(asset),
      );
      if (!eligible.length) return 0;
      const eligibleIds = new Set(eligible.map((asset) => asset.id));
      discardSelectedEntries((id) => eligibleIds.has(id));
      lastBatch.current = Object.fromEntries(
        eligible.map((asset) => [asset.id, decisions[asset.id]]),
      );
      setDecisions((current) => ({
        ...current,
        ...Object.fromEntries(
          eligible
            .filter((asset) => !['accepted', 'excluded'].includes(current[asset.id] ?? ''))
            .map((asset) => [asset.id, 'accepted']),
        ),
      }));
      notifyReviewChange();
      return eligible.length;
    },
    undoAcceptAll: () => {
      const previous = lastBatch.current;
      if (!previous) return;
      lastBatch.current = null;
      discardSelectedEntries((id) => Object.hasOwn(previous, id));
      setDecisions((current) => {
        const next = { ...current };
        for (const [id, status] of Object.entries(previous)) {
          if (next[id] !== 'accepted') continue;
          if (status) next[id] = status;
          else delete next[id];
        }
        return next;
      });
      notifyReviewChange();
    },
    resolveSourceValue: (sourceFieldId: string) => resolveSourceValue(session, sourceFieldId),
  };
}
