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
  const invalidateBatchAsset = (id: string) => {
    if (lastBatch.current) delete lastBatch.current[id];
  };
  return {
    ...projection,
    ...reviewActions,
    ...mappingActions,
    ...createPlanActions(context),
    ...sourceActions,
    reviewAsset: (...args: Parameters<typeof reviewActions.reviewAsset>) => {
      invalidateBatchAsset(args[1].id);
      reviewActions.reviewAsset(...args);
      onReviewChange?.();
    },
    mapAssetField: (...args: Parameters<typeof mappingActions.mapAssetField>) => {
      invalidateBatchAsset(args[0].id);
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
      sourceActions.resetReview();
      onReviewChange?.();
    },
    removeSource: (sourceId: string) => {
      lastBatch.current = null;
      sourceActions.removeSource(sourceId);
    },
    acceptAllEligible: () => {
      const eligible = projection.assets.filter(
        (asset) =>
          !['accepted', 'excluded'].includes(asset.status) && hasIncludedSchemaField(asset),
      );
      if (!eligible.length) return 0;
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
