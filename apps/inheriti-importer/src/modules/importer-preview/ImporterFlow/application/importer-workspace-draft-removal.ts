import {
  failedFieldOperation,
  type FieldOperationChange,
} from './importer-workspace-field-operations';
import { nativeNotes } from './importer-workspace-notes';
import { projectImporterWorkspace } from './importer-workspace-projection';
import { mappedFieldIds } from './importer-workspace-suggestions';
import type { ReviewDecisions } from './importer-workspace-types';
import type { ImporterWorkspaceContext } from './use-importer-workspace';

export function planDraftRemoval(
  context: ImporterWorkspaceContext,
  decisions: ReviewDecisions,
  assetIds: string[],
) {
  const { session, projection, workspace } = context;
  const currentAssets = new Map(projection.assets.map((asset) => [asset.id, asset]));
  if (new Set(assetIds).size !== assetIds.length || assetIds.some((id) => !currentAssets.has(id)))
    return { result: failedFieldOperation('The selection changed. Select the drafts again.') };

  const removedAssetIds = assetIds.filter((id) => currentAssets.get(id)?.canRemoveDraft);
  if (!removedAssetIds.length)
    return { result: failedFieldOperation('Select a draft created from source fields.') };

  const removed = new Set(removedAssetIds);
  const organization = {
    assets: { ...context.organization.assets },
    owners: { ...context.organization.owners },
    names: { ...context.organization.names },
    generatedAssetIds: new Set(context.organization.generatedAssetIds),
    releasedFieldIds: new Set(context.organization.releasedFieldIds),
  };
  const preservation = {
    ...context.preservation,
    rescued: new Set(context.preservation.rescued),
    entryNotes: { ...context.preservation.entryNotes },
  };
  const mappings = { ...context.mappingOverrides };
  const nextDecisions = { ...decisions };
  const plainTextOverrides = { ...context.plainTextOverrides };
  const plainTextAssetIds = new Set(context.plainTextAssetIds);
  const typeOverrides = { ...context.typeOverrides };
  const affectedNodes = new Set<string>();
  const releasedFields = new Set<string>();
  const otherDestinations = new Set(
    projection.coverage.fields
      .filter(
        ({ status, destinations }) =>
          (status === 'protected' || status === 'mapped') &&
          destinations.some(({ assetId, valid }) => valid && !removed.has(assetId)),
      )
      .map(({ id }) => id),
  );
  for (const [fieldId, ownerId] of Object.entries(organization.owners)) {
    if (!removed.has(ownerId)) continue;
    delete organization.owners[fieldId];
    releasedFields.add(fieldId);
    if (!otherDestinations.has(fieldId)) preservation.rescued.delete(fieldId);
  }
  for (const id of removedAssetIds) {
    const draft = organization.assets[id];
    affectedNodes.add(draft.fromNodeId);
    const mapped = mappedFieldIds(context.byId(id) ?? draft);
    for (const fieldId of mapped) releasedFields.add(fieldId);
    const note = nativeNotes(session, draft.fromNodeId);
    if (
      note &&
      !otherDestinations.has(note.id) &&
      (context.organization.owners[note.id] === id || mapped.has(note.id))
    ) {
      preservation.entryNotes[draft.fromNodeId] = null;
      preservation.rescued.delete(note.id);
      releasedFields.add(note.id);
    }
    delete organization.assets[id];
    delete organization.names[id];
    organization.generatedAssetIds.delete(id);
    delete mappings[id];
    delete nextDecisions[id];
    delete plainTextOverrides[id];
    plainTextAssetIds.delete(id);
    delete typeOverrides[id];
  }

  for (const id of releasedFields) {
    const field = session.fieldsById[id];
    if (field && !otherDestinations.has(id) && nativeNotes(session, field.parentNodeId)?.id !== id)
      organization.releasedFieldIds.add(id);
  }

  const plansByClientId = { ...workspace.plansByClientId };
  for (const [id, plan] of Object.entries(plansByClientId)) {
    const assets = plan.assets.filter((asset) => !removed.has(asset.id));
    if (assets.length !== plan.assets.length) plansByClientId[id] = { ...plan, assets };
  }
  const nextWorkspace = { ...workspace, plansByClientId, revision: workspace.revision + 1 };
  const nextProjection = projectImporterWorkspace(
    session,
    nextWorkspace,
    nextDecisions,
    mappings,
    plainTextOverrides,
    plainTextAssetIds,
    typeOverrides,
    preservation,
    organization,
  );
  const returned = nextProjection.coverage.fields.filter(
    ({ id, status }) => releasedFields.has(id) && status === 'pending',
  ).length;
  const skipped = assetIds.length - removedAssetIds.length;
  const changedAssetIds = nextProjection.assets
    .filter(({ sourceNodeId }) => sourceNodeId && affectedNodes.has(sourceNodeId))
    .filter(({ ownsSourceDiagnostics }) => ownsSourceDiagnostics)
    .map(({ id }) => id);
  const result = {
    success: true,
    message: `${removed.size} draft${removed.size === 1 ? '' : 's'} removed · ${returned} field${returned === 1 ? '' : 's'} returned to Unassigned.${
      skipped ? ` ${skipped} selected asset${skipped === 1 ? '' : 's'} skipped.` : ''
    }`,
    createdAssetIds: [],
    changedAssetIds,
    removedAssetIds,
  };
  const change: FieldOperationChange = {
    organization,
    preservation,
    mappings,
    decisions: nextDecisions,
    workspace: nextWorkspace,
    result,
  };
  return { result, change, edits: { plainTextOverrides, plainTextAssetIds, typeOverrides } };
}

type DraftLiteralState = Pick<
  ImporterWorkspaceContext,
  'organization' | 'plainTextOverrides' | 'workspace'
>;

function draftLiterals(state: DraftLiteralState, ids?: ReadonlySet<string>) {
  const assets = [
    ...Object.entries(state.organization.assets),
    ...Object.values(state.workspace.plansByClientId).flatMap(({ assets }) =>
      assets.map((asset) => [asset.id, asset] as const),
    ),
  ];
  return [
    ...Object.entries(state.plainTextOverrides)
      .filter(([id]) => !ids || ids.has(id))
      .map(([, value]) => value),
    ...assets
      .filter(([id]) => !ids || ids.has(id))
      .flatMap(([, { fieldBindings }]) =>
        Object.values(fieldBindings).flatMap((binding) =>
          binding.kind === 'literal' ? [binding.value] : [],
        ),
      ),
  ];
}

export function clearRemovedDraftLiterals(
  removedIds: string[],
  beforeRemoval: DraftLiteralState,
  live: ImporterWorkspaceContext,
  nextUndo?: DraftLiteralState,
) {
  const discarded = new Set(draftLiterals(beforeRemoval, new Set(removedIds)));
  if (!discarded.size) return;
  const retained = new Set([
    ...draftLiterals(live),
    ...Object.values(live.session.fieldsById).map(({ value }) => value),
    ...(nextUndo ? draftLiterals(nextUndo) : []),
  ]);
  for (const value of discarded) {
    if (!retained.has(value)) value.clear();
  }
}
