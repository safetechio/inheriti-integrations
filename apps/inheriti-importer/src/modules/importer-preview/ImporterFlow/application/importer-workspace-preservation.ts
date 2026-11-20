import type { AssetDraft } from '@modules/plans/domain/workspace-model';
import { bindingSourceIds } from '@modules/mapping/application/suggestion-engine';
import { ignoreSourceField, removeAsset } from '@modules/plans/domain/workspace-commands';
import { listPlanDrafts } from '@modules/plans/domain/workspace-selectors';
import type { NoteDestination, ReviewAsset, ReviewBatchResult } from '../../AssetReviewQueue/types';
import { nativeNotes, type PreservationChoices } from './importer-workspace-notes';
import { statusKey } from './importer-workspace-suggestions';
import type { ImporterWorkspaceContext } from './use-importer-workspace';

export function createPreservationActions(
  context: ImporterWorkspaceContext,
  setChoices: (choices: PreservationChoices) => void,
  invalidate: (ids: string[]) => void,
) {
  const { preservation, projection, session, setDecisions, updateWorkspace, byId } = context;

  function invalidateAffected(fieldIds: string[], nodeIds: Set<string>, exclude = false) {
    const fields = new Set(fieldIds);
    const usesField = (asset: Pick<AssetDraft, 'fieldBindings'>) =>
      Object.values(asset.fieldBindings).some((binding) =>
        bindingSourceIds(binding).some((id) => fields.has(id)),
      );
    const assetIds = projection.suggestions
      .filter((asset) => nodeIds.has(asset.fromNodeId) || (exclude && usesField(asset)))
      .map(statusKey);
    const affected = new Set(assetIds);
    setDecisions((current) => {
      const updated = { ...current };
      for (const id of affected) {
        if (updated[id] !== 'excluded') updated[id] = 'needs-review';
      }
      return updated;
    });
    updateWorkspace((current) => {
      let next = exclude
        ? fieldIds.reduce(
            (state, sourceFieldId) => ignoreSourceField(state, { sourceFieldId }),
            current,
          )
        : current;
      for (const plan of listPlanDrafts(current)) {
        for (const asset of plan.assets) {
          if (!(exclude ? usesField(asset) : affected.has(asset.id) || usesField(asset))) continue;
          next = removeAsset(next, { planClientId: plan.clientId, assetId: asset.id });
        }
      }
      return next;
    });
    invalidate(assetIds);
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
    const publicSkippedEntries = new Set(preservation.publicSkippedEntries);
    const nodeIds = new Set<string>();
    const fieldIds: string[] = [];
    for (const source of sources) {
      sourceNotes[source.sourceId] = destination;
      for (const asset of projection.assets) {
        if (!asset.note || asset.sourceId !== source.sourceId || !asset.sourceNodeId) continue;
        if (
          preservation.entryNotes?.[asset.sourceNodeId] ||
          (destination === 'asset-notes' && !asset.note.publicAllowed)
        ) {
          if (destination === 'asset-notes' && !preservation.entryNotes?.[asset.sourceNodeId])
            publicSkippedEntries.add(asset.sourceNodeId);
          skippedIds.push(asset.id);
          continue;
        }
        const wasSkipped = publicSkippedEntries.delete(asset.sourceNodeId);
        const stale = hasStaleNote(asset, destination);
        if (source.destination === destination && !wasSkipped && !stale) continue;
        changedIds.push(asset.id);
        if (asset.note.destination !== destination || stale) {
          nodeIds.add(asset.sourceNodeId);
          fieldIds.push(asset.note.sourceFieldId);
        }
      }
    }
    if (changedIds.length || sources.some((source) => source.destination !== destination)) {
      setChoices({ ...preservation, sourceNotes, publicSkippedEntries });
      invalidateAffected(fieldIds, nodeIds);
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
    setChoices({
      ...preservation,
      rescued,
      entryNotes: { ...preservation.entryNotes, [nodeId]: destination },
    });
    invalidateAffected(
      changed ? [current.note.sourceFieldId] : [],
      changed ? new Set([nodeId]) : new Set(),
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
