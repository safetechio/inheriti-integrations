import { materialiseAsset } from '@modules/plans/domain/asset-materializer';
import { validateAssetEditorValues } from '@modules/plans/domain/asset-metadata';
import { isAutomaticallyMappable } from '@modules/import/domain/structured-extra-fields';
import type { ImportedField, ImportSession } from '@modules/import/domain/import-model';
import {
  allFieldsAsPlainText,
  bindingSourceIds,
  fieldsOf,
} from '@modules/mapping/application/suggestion-engine';
import type { SuggestedAsset } from '@modules/mapping/domain/suggestion';
import type {
  ReviewAssetNote,
  NoteDestination,
  NoteSourceDecision,
} from '../../AssetReviewQueue/types';

export interface PreservationChoices {
  sourceNotes?: Record<string, NoteDestination>;
  /** An explicit null returns this entry to pending, even with a source-level choice. */
  entryNotes?: Record<string, NoteDestination | null>;
  rescued?: ReadonlySet<string>;
  publicSkippedEntries?: ReadonlySet<string>;
  ignored?: ReadonlySet<string>;
}

const defaultNoteDestination = 'asset-notes';
const nativeNotesKinds = new Set(['onepassword', 'keepass', 'passbolt']);

export function nativeNotes(session: ImportSession, nodeId: string): ImportedField | undefined {
  const node = session.nodesById[nodeId];
  if (
    !node ||
    !session.sources.some(
      (source) => source.id === node.sourceId && nativeNotesKinds.has(source.kind),
    )
  )
    return undefined;
  const notes = fieldsOf(session, node).filter(
    (field) => field.name === 'notes' && !field.value.isEmpty && isAutomaticallyMappable(field),
  );
  return notes.length === 1 ? notes[0] : undefined;
}

export function projectNoteSources(
  session: ImportSession,
  choices: PreservationChoices,
): NoteSourceDecision[] {
  const fieldIdsBySource = new Map<string, string[]>();
  for (const node of Object.values(session.nodesById)) {
    const field = nativeNotes(session, node.id);
    if (!field || choices.ignored?.has(field.id)) continue;
    const fieldIds = fieldIdsBySource.get(field.sourceId) ?? [];
    fieldIds.push(field.id);
    fieldIdsBySource.set(field.sourceId, fieldIds);
  }
  return session.sources.flatMap((source) => {
    const fieldIds = fieldIdsBySource.get(source.id);
    return fieldIds
      ? [
          {
            sourceId: source.id,
            sourceName: source.fileName,
            fieldCount: fieldIds.length,
            fieldIds,
            destination: choices.sourceNotes?.[source.id] ?? defaultNoteDestination,
          },
        ]
      : [];
  });
}

export function removeSourceBindings(
  suggestion: SuggestedAsset,
  removedIds: ReadonlySet<string>,
): SuggestedAsset {
  if (!removedIds.size) return suggestion;
  const fieldBindings: SuggestedAsset['fieldBindings'] = {};
  for (const [target, binding] of Object.entries(suggestion.fieldBindings)) {
    if (binding.kind === 'source' && removedIds.has(binding.sourceFieldId)) continue;
    if (binding.kind === 'sources') {
      const sources = binding.sources.filter((source) => !removedIds.has(source.sourceFieldId));
      if (sources.length) fieldBindings[target] = { ...binding, sources };
    } else fieldBindings[target] = binding;
  }
  return { ...suggestion, fieldBindings };
}

function hasProtectedValue(session: ImportSession, suggestion: SuggestedAsset): boolean {
  if (!Object.keys(suggestion.fieldBindings).some((key) => key.startsWith('secret.'))) return false;
  const { asset, errors } = materialiseAsset({ ...suggestion, id: suggestion.id ?? '' }, session);
  const invalid = new Set(errors.map(({ assetFieldSource }) => assetFieldSource));
  const validation = validateAssetEditorValues(asset.type, asset);
  return Object.entries(asset.secret).some(([key, value]) => {
    const path = `secret.${key}`;
    const present =
      typeof value === 'string' ? Boolean(value.trim()) : Array.isArray(value) && value.length > 0;
    return present && !invalid.has(path) && !validation[path];
  });
}

export function noteForAsset(
  session: ImportSession,
  suggestion: SuggestedAsset,
  choices: PreservationChoices,
  legacyProtected = false,
): ReviewAssetNote | undefined {
  if (suggestion.variant) return;
  const field = nativeNotes(session, suggestion.fromNodeId);
  if (!field || choices.ignored?.has(field.id)) return;
  const override = choices.entryNotes?.[suggestion.fromNodeId];
  const sourceChoice = choices.sourceNotes?.[field.sourceId];
  const inherited = override === undefined;
  const skipped = choices.publicSkippedEntries?.has(suggestion.fromNodeId);
  const withoutNote = removeSourceBindings(suggestion, new Set([field.id]));
  const publicAllowed =
    !withoutNote.fieldBindings['meta.notes'] && hasProtectedValue(session, withoutNote);
  const destination =
    override === null || skipped
      ? (override ?? 'protected')
      : (override ?? sourceChoice ?? (legacyProtected ? 'protected' : defaultNoteDestination));
  return {
    sourceFieldId: field.id,
    destination: publicAllowed && destination === 'asset-notes' ? 'asset-notes' : 'protected',
    explicit: override !== null,
    inherited,
    publicAllowed,
    reason: publicAllowed
      ? undefined
      : 'Asset Notes require another protected value and an available Notes field.',
  };
}

export function applyNativeNote(
  session: ImportSession,
  suggestion: SuggestedAsset,
  choices: PreservationChoices,
  legacyProtected = false,
): SuggestedAsset {
  const note = noteForAsset(session, suggestion, choices, legacyProtected);
  if (!note) return suggestion;
  const adjusted = removeSourceBindings(suggestion, new Set([note.sourceFieldId]));
  if (note.destination === 'asset-notes') {
    adjusted.fieldBindings['meta.notes'] = { kind: 'source', sourceFieldId: note.sourceFieldId };
  }
  if (
    choices.entryNotes?.[suggestion.fromNodeId] !== null &&
    suggestion.type === 'PLAIN-TEXT' &&
    adjusted.fieldBindings['secret.text']?.kind !== 'literal'
  ) {
    const current = adjusted.fieldBindings['secret.text'];
    const ids = new Set(current ? bindingSourceIds(current) : []);
    if (note.destination === 'protected') ids.add(note.sourceFieldId);
    const node = session.nodesById[suggestion.fromNodeId];
    const binding = allFieldsAsPlainText(
      session,
      node,
      fieldsOf(session, node).filter((field) => ids.has(field.id)),
    ).fieldBindings['secret.text'];
    if (binding) adjusted.fieldBindings['secret.text'] = binding;
  }
  return adjusted;
}
