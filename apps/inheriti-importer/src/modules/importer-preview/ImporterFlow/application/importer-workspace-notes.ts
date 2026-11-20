import type { ImportedField, ImportSession } from '@modules/import/domain/import-model';
import {
  allFieldsAsPlainText,
  bindingSourceIds,
  fieldsOf,
} from '@modules/mapping/application/suggestion-engine';
import type { SuggestedAsset, SuggestedFieldBinding } from '@modules/mapping/domain/suggestion';
import type {
  ReviewAssetNote,
  NoteDestination,
  NoteSourceDecision,
} from '../../AssetReviewQueue/types';

export interface PreservationChoices {
  sourceNotes?: Record<string, NoteDestination>;
  entryNotes?: Record<string, NoteDestination>;
  rescued?: ReadonlySet<string>;
  publicSkippedEntries?: ReadonlySet<string>;
  ignored?: ReadonlySet<string>;
}

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
    (field) => field.name === 'notes' && !field.value.isEmpty,
  );
  return notes.length === 1 ? notes[0] : undefined;
}

export function projectNoteSources(
  session: ImportSession,
  choices: PreservationChoices,
): NoteSourceDecision[] {
  const counts = new Map<string, number>();
  for (const node of Object.values(session.nodesById)) {
    const field = nativeNotes(session, node.id);
    if (field && !choices.ignored?.has(field.id))
      counts.set(field.sourceId, (counts.get(field.sourceId) ?? 0) + 1);
  }
  return session.sources.flatMap((source) => {
    const fieldCount = counts.get(source.id);
    return fieldCount
      ? [
          {
            sourceId: source.id,
            sourceName: source.fileName,
            fieldCount,
            destination: choices.sourceNotes?.[source.id] ?? null,
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

function hasProtectedValue(session: ImportSession, binding: SuggestedFieldBinding): boolean {
  return binding.kind === 'literal'
    ? Boolean(binding.value.reveal().trim())
    : bindingSourceIds(binding).some(
        (id) => !session.fieldsById[id]?.value.isEmpty && Boolean(session.fieldsById[id]),
      );
}

export function noteForAsset(
  session: ImportSession,
  suggestion: SuggestedAsset,
  choices: PreservationChoices,
): ReviewAssetNote | undefined {
  if (suggestion.variant) return;
  const field = nativeNotes(session, suggestion.fromNodeId);
  if (!field || choices.ignored?.has(field.id)) return;
  const override = choices.entryNotes?.[suggestion.fromNodeId];
  const inherited = choices.sourceNotes?.[field.sourceId];
  const skipped = choices.publicSkippedEntries?.has(suggestion.fromNodeId);
  const withoutNote = removeSourceBindings(suggestion, new Set([field.id]));
  const publicAllowed =
    !withoutNote.fieldBindings['meta.notes'] &&
    Object.entries(withoutNote.fieldBindings).some(
      ([key, binding]) => key.startsWith('secret.') && hasProtectedValue(session, binding),
    );
  return {
    sourceFieldId: field.id,
    destination:
      publicAllowed && (override ?? (skipped ? 'protected' : inherited)) === 'asset-notes'
        ? 'asset-notes'
        : 'protected',
    explicit: Boolean(override || inherited),
    inherited: !override && Boolean(inherited),
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
): SuggestedAsset {
  const note = noteForAsset(session, suggestion, choices);
  if (!note) return suggestion;
  const adjusted = removeSourceBindings(suggestion, new Set([note.sourceFieldId]));
  if (note.destination === 'asset-notes') {
    adjusted.fieldBindings['meta.notes'] = { kind: 'source', sourceFieldId: note.sourceFieldId };
  }
  if (
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
