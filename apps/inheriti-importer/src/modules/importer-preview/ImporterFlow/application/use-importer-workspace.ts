import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
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
  type WorkspaceReplacer,
  type WorkspaceSetter,
} from './importer-workspace-types';
import { projectImporterWorkspace } from './importer-workspace-projection';
import { statusKey } from './importer-workspace-suggestions';
import { createReviewActions } from './importer-workspace-review';
import { createMappingActions } from './importer-workspace-mapping';
import { createPlanActions } from './importer-workspace-plans';
import { createSourceActions } from './importer-workspace-source';

export interface ImporterWorkspaceContext {
  session: ImportSession;
  workspace: WorkspaceState;
  projection: ImporterWorkspaceProjection;
  mappingOverrides: MappingOverrides;
  plainTextOverrides: PlainTextOverrides;
  structuredSuggestions: Record<string, SuggestedAsset>;
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
  const context: ImporterWorkspaceContext = {
    session,
    workspace,
    projection,
    mappingOverrides,
    plainTextOverrides,
    structuredSuggestions,
    setDecisions,
    setMappingOverrides,
    setPlainTextOverrides,
    setPlainTextAssetIds,
    setStructuredSuggestions,
    updateWorkspace: (update) => setWorkspace(update),
    replaceWorkspace,
    byId: (id) => projection.suggestions.find((suggestion) => statusKey(suggestion) === id),
  };

  return {
    ...projection,
    ...createReviewActions(context),
    ...createMappingActions(context),
    ...createPlanActions(context),
    ...createSourceActions(context),
    resolveSourceValue: (sourceFieldId: string) => resolveSourceValue(session, sourceFieldId),
  };
}
