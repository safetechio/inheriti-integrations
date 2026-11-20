import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { type ImportSession } from '@modules/import/domain/import-model';
import { resolveSourceValue } from '@modules/mapping/application/suggestion-engine';
import type { SuggestedAsset } from '@modules/mapping/domain/suggestion';
import type { AssetReviewStatus } from '../../AssetReviewQueue/types';
import type { WorkspaceState } from '@modules/plans/domain/workspace-model';
import {
  type ImporterWorkspaceProjection,
  type MappingOverrides,
  type PlainTextOverrides,
  type ReviewDecisions,
  type AssetTypeOverrides,
  type WorkspaceReplacer,
  type WorkspaceSetter,
} from './importer-workspace-types';
import { projectImporterWorkspace } from './importer-workspace-projection';
import { statusKey } from './importer-workspace-suggestions';
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
import { hasIncludedSchemaField } from '../../AssetReviewQueue/types';

export interface ImporterWorkspaceContext {
  session: ImportSession;
  workspace: WorkspaceState;
  projection: ImporterWorkspaceProjection;
  mappingOverrides: MappingOverrides;
  plainTextOverrides: PlainTextOverrides;
  plainTextAssetIds: ReadonlySet<string>;
  structuredSuggestions: Record<string, SuggestedAsset>;
  typeOverrides: AssetTypeOverrides;
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
  const projection = useMemo(
    () =>
      projectImporterWorkspace(
        session,
        workspace,
        decisions,
        mappingOverrides,
        plainTextOverrides,
        plainTextAssetIds,
        typeOverrides,
      ),
    [
      session,
      workspace,
      decisions,
      mappingOverrides,
      plainTextOverrides,
      plainTextAssetIds,
      typeOverrides,
    ],
  );
  const context: ImporterWorkspaceContext = {
    session,
    workspace,
    projection,
    mappingOverrides,
    plainTextOverrides,
    plainTextAssetIds,
    structuredSuggestions,
    typeOverrides,
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
    onReviewChange,
  );
  return {
    ...projection,
    ...reviewActions,
    ...mappingActions,
    ...createPlanActions(context),
    ...sourceActions,
    ...batchActions,
    canUndoReviewBatch,
    reviewAsset: (...args: Parameters<typeof reviewActions.reviewAsset>) => {
      invalidateBatchAsset(args[1].id);
      if (args[0].startsWith('alternate:') || args[0] === 'restore-suggestion') {
        const suggestion = context.byId(args[1].id);
        if (suggestion)
          discardSelectedEntries((_id, entry) => entry.nodeId === suggestion.fromNodeId);
      }
      reviewActions.reviewAsset(...args);
      onReviewChange?.();
    },
    mapAssetField: (...args: Parameters<typeof mappingActions.mapAssetField>) => {
      invalidateBatchAsset(args[0].id, args[1]);
      const suggestion = context.byId(args[0].id);
      if (suggestion && !suggestion.variant)
        discardSelectedEntries(
          (id, entry) => id !== args[0].id && entry.nodeId === suggestion.fromNodeId,
        );
      mappingActions.mapAssetField(...args);
      onReviewChange?.();
    },
    editPlainText: (...args: Parameters<typeof mappingActions.editPlainText>) => {
      invalidateBatchAsset(args[0].id);
      mappingActions.editPlainText(...args);
      onReviewChange?.();
    },
    resetReview: () => {
      lastBatch.current = null;
      clearSelectedSource();
      sourceActions.resetReview();
      onReviewChange?.();
    },
    removeSource: (sourceId: string) => {
      lastBatch.current = null;
      clearSelectedSource(sourceId);
      sourceActions.removeSource(sourceId);
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
      onReviewChange?.();
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
      onReviewChange?.();
    },
    resolveSourceValue: (sourceFieldId: string) => resolveSourceValue(session, sourceFieldId),
  };
}
