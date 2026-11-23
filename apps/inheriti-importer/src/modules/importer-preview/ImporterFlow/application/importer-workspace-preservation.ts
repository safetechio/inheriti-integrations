import type { AssetDraft, WorkspaceState } from '@modules/plans/domain/workspace-model';
import { bindingSourceIds } from '@modules/mapping/application/suggestion-engine';
import { ignoreSourceField, removeAsset } from '@modules/plans/domain/workspace-commands';
import { listPlanDrafts } from '@modules/plans/domain/workspace-selectors';
import type { NoteDestination, ReviewAsset, ReviewBatchResult } from '../../AssetReviewQueue/types';
import { nativeNotes, type PreservationChoices } from './importer-workspace-notes';
import { projectSuggestions } from './importer-workspace-projection';
import { sourceSuggestions, statusKey } from './importer-workspace-suggestions';
import type { FieldOperationChange } from './importer-workspace-field-operations';
import type { ReviewDecisions } from './importer-workspace-types';
import type { ImporterWorkspaceContext } from './use-importer-workspace';

export function createPreservationActions(
  context: ImporterWorkspaceContext,
  decisions: ReviewDecisions,
  setChoices: (choices: PreservationChoices) => void,
  invalidate: (ids: string[]) => void,
  commitExclusion: (
    change: Pick<FieldOperationChange, 'workspace' | 'decisions' | 'result'>,
  ) => void,
) {
  const { preservation, projection, session, setDecisions, updateWorkspace, byId } = context;

  const usesFields = (fields: ReadonlySet<string>) => (asset: Pick<AssetDraft, 'fieldBindings'>) =>
    Object.values(asset.fieldBindings).some((binding) =>
      bindingSourceIds(binding).some((id) => fields.has(id)),
    );

  function invalidateAffected(fieldIds: string[], affected: Set<string>, exclude = false) {
    const usesField = usesFields(new Set(fieldIds));
    for (const asset of projection.suggestions) {
      if (usesField(asset)) affected.add(statusKey(asset));
    }
    const reopenDecisions = (current: ReviewDecisions) => {
      const updated = { ...current };
      for (const id of affected) {
        if (updated[id] !== 'excluded') updated[id] = 'needs-review';
      }
      return updated;
    };
    const unassignDrafts = (current: WorkspaceState) => {
      const removedAssetIds = new Set<string>();
      let next = exclude
        ? fieldIds.reduce(
            (state, sourceFieldId) => ignoreSourceField(state, { sourceFieldId }),
            current,
          )
        : current;
      for (const plan of listPlanDrafts(current)) {
        for (const asset of plan.assets) {
          if (!(exclude ? usesField(asset) : affected.has(asset.id) || usesField(asset))) continue;
          removedAssetIds.add(asset.id);
          next = removeAsset(next, { planClientId: plan.clientId, assetId: asset.id });
        }
      }
      return { workspace: next, removedAssetIds: [...removedAssetIds] };
    };
    if (exclude) {
      const { workspace, removedAssetIds } = unassignDrafts(context.workspace);
      commitExclusion({
        workspace,
        decisions: reopenDecisions(decisions),
        result: {
          success: true,
          message: 'Fields excluded.',
          createdAssetIds: [],
          changedAssetIds: [...affected],
          removedAssetIds,
        },
      });
      return;
    }
    setDecisions(reopenDecisions);
    updateWorkspace((current) => unassignDrafts(current).workspace);
    invalidate([...affected]);
  }

  function updateNoteChoices(
    choices: PreservationChoices,
    noteIds: Set<string>,
    fieldIds: string[],
    affected: Set<string>,
  ) {
    if (noteIds.size) {
      const { workspace, mappingOverrides, plainTextOverrides, plainTextAssetIds, typeOverrides } =
        context;
      // A destination change can move notes between the primary and a companion.
      const usesNote = usesFields(noteIds);
      const previous = new Set(projection.suggestions.filter(usesNote).map(statusKey));
      const nextSuggestions = projectSuggestions(
        session,
        context.sourceOriginals ?? sourceSuggestions(session),
        mappingOverrides,
        plainTextOverrides,
        plainTextAssetIds,
        typeOverrides,
        { ...choices, ignored: new Set(workspace.ignoredSourceFieldIds) },
        context.organization,
        workspace,
      );
      const next = new Set(nextSuggestions.filter(usesNote).map(statusKey));
      for (const id of new Set([...previous, ...next])) {
        if (previous.has(id) !== next.has(id)) affected.add(id);
      }
    }
    setChoices(choices);
    invalidateAffected(fieldIds, affected);
  }

  const actualByField = new Map(
    projection.executionCoverage.fields.map((field) => [field.id, field]),
  );
  function hasStaleNote(asset: ReviewAsset, destination: NoteDestination): boolean {
    if (!asset.note) return false;
    const actual = actualByField.get(asset.note.sourceFieldId)?.destinations ?? [];
    const expected = destination === 'asset-notes' ? 'meta.notes' : 'secret.text';
    return actual.length > 1 || actual.some((binding) => binding.fieldId !== expected);
  }

  function setSourceNoteDestination(
    sourceId: string | null,
    destination: NoteDestination,
  ): ReviewBatchResult {
    const sources = projection.noteSources.filter(
      (source) => sourceId === null || sourceId === source.sourceId,
    );
    const changedIds: string[] = [];
    const skippedIds: string[] = [];
    const sourceNotes = { ...preservation.sourceNotes };
    const entryNotes = { ...preservation.entryNotes };
    const publicSkippedEntries = new Set(preservation.publicSkippedEntries);
    const affected = new Set<string>();
    const noteIds = new Set<string>();
    const fieldIds: string[] = [];
    const rescued = new Set(preservation.rescued);
    for (const source of sources) {
      sourceNotes[source.sourceId] = destination;
      for (const asset of projection.assets) {
        if (!asset.note || asset.sourceId !== source.sourceId || !asset.sourceNodeId) continue;
        if (
          preservation.entryNotes?.[asset.sourceNodeId] ||
          (destination === 'asset-notes' && !asset.note.publicAllowed)
        ) {
          if (
            destination === 'asset-notes' &&
            preservation.entryNotes?.[asset.sourceNodeId] === undefined &&
            !publicSkippedEntries.has(asset.sourceNodeId)
          ) {
            publicSkippedEntries.add(asset.sourceNodeId);
            noteIds.add(asset.note.sourceFieldId);
          }
          skippedIds.push(asset.id);
          continue;
        }
        const wasSkipped = publicSkippedEntries.delete(asset.sourceNodeId);
        const stale = hasStaleNote(asset, destination);
        const wasReset = entryNotes[asset.sourceNodeId] === null;
        if (wasReset) delete entryNotes[asset.sourceNodeId];
        if (
          source.destination === destination &&
          asset.note.destination === destination &&
          !wasSkipped &&
          !stale &&
          !wasReset
        )
          continue;
        changedIds.push(asset.id);
        noteIds.add(asset.note.sourceFieldId);
        if (asset.note.destination !== destination || stale) {
          affected.add(asset.id);
          fieldIds.push(asset.note.sourceFieldId);
          if (destination === 'asset-notes') rescued.delete(asset.note.sourceFieldId);
        }
      }
    }
    if (
      noteIds.size ||
      sources.some(
        (source) => sourceNotes[source.sourceId] !== preservation.sourceNotes?.[source.sourceId],
      )
    ) {
      updateNoteChoices(
        { ...preservation, sourceNotes, entryNotes, publicSkippedEntries, rescued },
        noteIds,
        fieldIds,
        affected,
      );
    }
    return { changedIds, skippedIds };
  }

  function setAssetNoteDestination(
    asset: ReviewAsset,
    destination: NoteDestination,
  ): ReviewBatchResult {
    const current = projection.assets.find((candidate) => candidate.id === asset.id);
    const nodeId = byId(asset.id)?.fromNodeId;
    if (!current?.note || !nodeId || (destination === 'asset-notes' && !current.note.publicAllowed))
      return { changedIds: [], skippedIds: [asset.id] };
    const changed = current.note.destination !== destination || hasStaleNote(current, destination);
    if (preservation.entryNotes?.[nodeId] === destination && !changed)
      return { changedIds: [], skippedIds: [] };
    const rescued = new Set(preservation.rescued);
    if (destination === 'asset-notes') rescued.delete(current.note.sourceFieldId);
    const noteId = current.note.sourceFieldId;
    updateNoteChoices(
      {
        ...preservation,
        rescued,
        entryNotes: { ...preservation.entryNotes, [nodeId]: destination },
      },
      new Set([noteId]),
      changed ? [noteId] : [],
      new Set(changed ? [current.id] : []),
    );
    return { changedIds: [asset.id], skippedIds: [] };
  }

  function resolveFields(ids: string[], exclude: boolean): ReviewBatchResult {
    const requested = new Set(ids);
    const fields = projection.coverage.fields.filter(
      (field) =>
        requested.has(field.id) && (field.status === 'pending' || field.status === 'invalid'),
    );
    const changedIds = fields.map((field) => field.id);
    const changed = new Set(changedIds);
    const skippedIds = [...requested].filter((id) => !changed.has(id));
    if (!fields.length) return { changedIds, skippedIds };
    if (exclude) {
      invalidateAffected(changedIds, new Set(), true);
    } else {
      const entryNotes = { ...preservation.entryNotes };
      const grouped = new Map<string, string[]>();
      for (const field of fields) {
        if (nativeNotes(session, field.nodeId)?.id === field.id)
          entryNotes[field.nodeId] = 'protected';
        const group = grouped.get(field.nodeId) ?? [];
        group.push(field.id);
        grouped.set(field.nodeId, group);
      }
      const draftIds = new Set(
        listPlanDrafts(context.workspace).flatMap((plan) => plan.assets.map((draft) => draft.id)),
      );
      const companions = new Map(
        projection.suggestions
          .filter((asset) => asset.variant === 'additional-fields' && asset.type === 'PLAIN-TEXT')
          .map((asset) => [asset.fromNodeId, asset]),
      );
      const rescuedNodes = new Set(
        projection.suggestions
          .filter((asset) => asset.variant === 'rescued-fields')
          .map((asset) => asset.fromNodeId),
      );
      const rescued = new Set(preservation.rescued);
      const rescueIds: string[] = [];
      const affected = new Set<string>();
      for (const [nodeId, fieldIds] of grouped) {
        const companion = companions.get(nodeId);
        const selected = new Set(fieldIds);
        const binding = companion?.fieldBindings['secret.text'];
        const references = binding ? bindingSourceIds(binding) : [];
        if (
          companion &&
          !rescuedNodes.has(nodeId) &&
          !draftIds.has(statusKey(companion)) &&
          Object.keys(companion.fieldBindings).length === 1 &&
          references.length === selected.size &&
          references.every((id) => selected.has(id))
        ) {
          rescueIds.push(statusKey(companion));
          continue;
        }
        fieldIds.forEach((id) => rescued.add(id));
        const id = `${nodeId}:PLAIN-TEXT-RESCUED`;
        rescueIds.push(id);
        affected.add(id);
      }
      setChoices({ ...preservation, entryNotes, rescued });
      updateWorkspace((current) => {
        let next = current;
        for (const plan of listPlanDrafts(current)) {
          for (const asset of plan.assets) {
            if (affected.has(asset.id))
              next = removeAsset(next, { planClientId: plan.clientId, assetId: asset.id });
          }
        }
        return next;
      });
      setDecisions((current) => ({
        ...current,
        ...Object.fromEntries(rescueIds.map((id) => [id, 'accepted'])),
      }));
      invalidate(rescueIds);
    }
    return { changedIds, skippedIds };
  }

  return {
    setSourceNoteDestination,
    setAssetNoteDestination,
    preserveFields: (ids: string[]) => resolveFields(ids, false),
    excludeFields: (ids: string[]) => resolveFields(ids, true),
  };
}
