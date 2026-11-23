import { isAutomaticallyMappable } from '@modules/import/domain/structured-extra-fields';
import type {
  ImportSession,
  ImportedField,
  ImportedNode,
} from '@modules/import/domain/import-model';
import { SensitiveValue } from '@modules/import/domain/import-model';
import {
  getPlanAssetFormFields,
  validateAssetEditorValues,
} from '@modules/plans/domain/asset-metadata';
import { materialiseAsset } from '@modules/plans/domain/asset-materializer';
import type { AssetDraft, FieldBinding } from '@modules/plans/domain/workspace-model';
import type {
  SuggestedAsset,
  SuggestedFieldBinding,
  SuggestionContext,
  SuggestionStrategy,
} from '@modules/mapping/domain/suggestion';

export function runSuggestionStrategies(
  strategies: readonly SuggestionStrategy[],
  context: SuggestionContext,
): SuggestedAsset[] {
  if (!strategies.length) return [];
  const sources = Object.values(context.session.fieldsById);
  const eligible = sources.filter(isAutomaticallyMappable);
  const filtered = { ...context };
  if (eligible.length !== sources.length) {
    const fieldsById = Object.fromEntries(eligible.map((field) => [field.id, field]));
    filtered.session = {
      ...context.session,
      fieldsById,
      nodesById: Object.fromEntries(
        Object.entries(context.session.nodesById).map(([id, node]) => [
          id,
          { ...node, fieldIds: node.fieldIds.filter((fieldId) => Object.hasOwn(fieldsById, fieldId)) },
        ]),
      ),
    };
  }
  return strategies
    .flatMap((strategy) => strategy.suggest(filtered).assets)
    .sort((a, b) => b.confidence - a.confidence);
}

export function bindingSourceIds(binding: SuggestedFieldBinding): string[] {
  if (binding.kind === 'source') return [binding.sourceFieldId];
  if (binding.kind === 'sources') return binding.sources.map((source) => source.sourceFieldId);
  return [];
}

export function allFieldsAsPlainText(
  _session: ImportSession,
  node: ImportedNode,
  fields: ImportedField[],
  _separateNativeNotes = false,
): SuggestedAsset {
  const textFields = fields.filter((field) => !field.value.isEmpty);
  const sources = textFields.map((field) => ({
    sourceFieldId: field.id,
    name: field.name.replace(/^extra:/i, ''),
  }));
  const textBinding =
    sources.length === 1 && textFields[0].value.reveal().trim().length > 0
      ? { kind: 'source' as const, sourceFieldId: sources[0].sourceFieldId }
      : { kind: 'sources' as const, sources };
  const fieldBindings: Record<string, SuggestedFieldBinding> = {};
  if (sources.length) fieldBindings['secret.text'] = textBinding;
  return {
    type: 'PLAIN-TEXT',
    name: node.name,
    fieldBindings,
    fromNodeId: node.id,
    confidence: 0,
    rationale: 'No structured Asset type matched. Imported values are preserved for review.',
  };
}

function allowedAssetFieldSources(type: string): ReadonlySet<string> {
  return new Set(
    getPlanAssetFormFields(type)
      .map((field) => field.source)
      .filter((source) => source.startsWith('secret.') || source === 'meta.notes'),
  );
}

export interface AnchoredSuggestion {
  required: string;
  suggestion: SuggestedAsset;
}

interface EntrySuggestionStrategy extends SuggestionStrategy {
  suggestPrimary?(
    context: SuggestionContext,
    node: ImportedNode,
    fields: ImportedField[],
    entryFields: ImportedField[],
  ): AnchoredSuggestion[];
  suggestAdditional?(
    context: SuggestionContext,
    node: ImportedNode,
    fields: ImportedField[],
    entryFields: ImportedField[],
  ): AnchoredSuggestion[];
}

export function suggestWithFallback(
  strategies: readonly EntrySuggestionStrategy[],
  context: SuggestionContext,
): SuggestedAsset[] {
  const unscoped = new Map<string, SuggestedAsset[]>();
  for (const suggestion of runSuggestionStrategies(
    strategies.filter((strategy) => !strategy.suggestPrimary),
    context,
  )) {
    const candidates = unscoped.get(suggestion.fromNodeId) ?? [];
    candidates.push(suggestion);
    unscoped.set(suggestion.fromNodeId, candidates);
  }
  return collectEntryNodes(context.session, context.nodeIds).flatMap((node) => {
    const fields = readableEntryFields(context.session, node);
    const eligible = fields.filter(isAutomaticallyMappable);
    if (fields.length && eligible.length <= 1)
      return [allFieldsAsPlainText(context.session, node, eligible)];
    return completeEntrySuggestions(strategies, context, node, eligible, eligible, [
      ...strategies.flatMap(
        (strategy) => strategy.suggestPrimary?.(context, node, eligible, eligible) ?? [],
      ),
      ...(unscoped.get(node.id) ?? []).map((suggestion) => ({ suggestion })),
    ]);
  });
}

export function readableEntryFields(session: ImportSession, node: ImportedNode): ImportedField[] {
  return fieldsOf(session, node).filter(
    (field) =>
      field.sourceId === node.sourceId && field.parentNodeId === node.id && !field.value.isEmpty,
  );
}

/** Detect assets from a selected subset without changing the normalized entry. */
export function suggestEntryFields(
  strategies: readonly EntrySuggestionStrategy[],
  context: SuggestionContext,
  node: ImportedNode,
  fields: readonly ImportedField[],
): SuggestedAsset[] {
  if (node.kind !== 'entry') return [];
  const entryFields = readableEntryFields(context.session, node).filter(isAutomaticallyMappable);
  const selectedIds = new Set(fields.map((field) => field.id));
  const selected = entryFields.filter((field) => selectedIds.has(field.id));
  if (selected.length <= 1)
    return completeEntrySuggestions(strategies, context, node, selected, entryFields, [], true);
  const narrowed = { ...node, childNodeIds: [], fieldIds: selected.map((field) => field.id) };
  const narrowedContext = {
    ...context,
    nodeIds: [node.id],
    session: { ...context.session, nodesById: { [node.id]: narrowed } },
  };
  const candidates = strategies.flatMap((strategy) =>
    strategy.suggestPrimary
      ? strategy.suggestPrimary(context, node, selected, entryFields)
      : runSuggestionStrategies([strategy], narrowedContext).map((suggestion) => ({ suggestion })),
  );
  return completeEntrySuggestions(
    strategies,
    context,
    node,
    selected,
    entryFields,
    candidates,
    true,
  );
}

type SuggestionCandidate = { suggestion: SuggestedAsset; required?: string };

// Matching context supports identification, with a cap so generic anchors cannot win on field count.
export function matchingContextWeight(bindingsCount: number): number {
  return [0, 0.04, 0.09][Math.min(2, Math.max(0, bindingsCount - 1))];
}

export function bestValidatedSuggestion(
  candidates: readonly SuggestionCandidate[],
  context: SuggestionContext,
  node: ImportedNode,
  available: ReadonlySet<string>,
): SuggestedAsset | undefined {
  const [best, ...alternatives] = candidates
    .flatMap((candidate) => validateSuggestion(candidate, context, node, available) ?? [])
    .sort((a, b) => b.confidence - a.confidence);
  if (
    best &&
    alternatives.some(
      (candidate) => candidate.type !== best.type && best.confidence - candidate.confidence < 0.07,
    )
  ) {
    return {
      ...best,
      confidence: Math.max(0, best.confidence - 0.06),
      evidence: [...(best.evidence ?? []), 'competing-types'],
    };
  }
  return best;
}

function completeEntrySuggestions(
  strategies: readonly EntrySuggestionStrategy[],
  context: SuggestionContext,
  node: ImportedNode,
  fields: ImportedField[],
  entryFields: ImportedField[],
  primaryCandidates: SuggestionCandidate[] = [],
  includeUnmatched = false,
): SuggestedAsset[] {
  if (!fields.length) return [];

  const eligible = fields.filter(isAutomaticallyMappable);
  const available = new Set(eligible.map((field) => field.id));
  const primary = bestValidatedSuggestion(primaryCandidates, context, node, available);
  const structured: SuggestedAsset[] = [];
  const claim = (suggestion: SuggestedAsset) => {
    structured.push(suggestion);
    Object.values(suggestion.fieldBindings)
      .flatMap(bindingSourceIds)
      .forEach((id) => available.delete(id));
  };
  if (primary) claim(primary);
  const remaining = eligible.filter((field) => available.has(field.id));
  if (!remaining.length)
    return structured.length ? structured : [allFieldsAsPlainText(context.session, node, [])];
  const candidates = strategies
    .flatMap(
      (strategy) => strategy.suggestAdditional?.(context, node, remaining, entryFields) ?? [],
    )
    .flatMap((candidate, index) => {
      const suggestion = validateSuggestion(candidate, context, node, available);
      return suggestion ? [{ ...candidate, suggestion, index }] : [];
    })
    .sort((a, b) => b.suggestion.confidence - a.suggestion.confidence);
  const accepted: Array<{ suggestion: SuggestedAsset; index: number }> = [];
  for (const candidate of candidates) {
    const suggestion = validateSuggestion(candidate, context, node, available);
    if (!suggestion) continue;
    Object.values(suggestion.fieldBindings)
      .flatMap(bindingSourceIds)
      .forEach((id) => available.delete(id));
    accepted.push({ suggestion, index: candidate.index });
  }
  structured.push(
    ...accepted.sort((a, b) => a.index - b.index).map(({ suggestion }) => suggestion),
  );
  if (!structured.length) return [allFieldsAsPlainText(context.session, node, eligible)];
  if (!primary) delete structured[0].id;
  if (includeUnmatched) {
    const leftover = remaining.filter((field) => available.has(field.id));
    if (leftover.length) structured.push(additionalFieldsAsset(context.session, node, leftover));
  }
  return structured;
}

function validateSuggestion(
  { suggestion: candidate, required }: SuggestionCandidate,
  context: SuggestionContext,
  node: ImportedNode,
  available: ReadonlySet<string>,
): SuggestedAsset | undefined {
  if (candidate.fromNodeId !== node.id || !context.knownAssetTypes.has(candidate.type)) return;
  const suggestion = availableSuggestion(candidate, available, required);
  const anchor = required && suggestion.fieldBindings[required];
  if (
    required &&
    (!anchor ||
      anchor.kind !== 'source' ||
      !context.session.fieldsById[anchor.sourceFieldId]?.value.reveal().trim())
  )
    return;

  const getInvalidFields = () => {
    const { asset, errors } = materialiseAsset(
      { ...suggestion, id: suggestion.id ?? node.id },
      context.session,
    );
    const validValue = (value: unknown) => typeof value !== 'string' || value.trim().length > 0;
    return new Set([
      ...errors.map((error) => error.assetFieldSource),
      ...Object.keys(validateAssetEditorValues(suggestion.type, asset)),
      ...Object.entries(asset.secret).flatMap(([key, value]) =>
        validValue(value) ? [] : [`secret.${key}`],
      ),
    ]);
  };
  const invalid = getInvalidFields();
  if ((!required && invalid.size) || (required && invalid.has(required))) return;
  for (const target of invalid) delete suggestion.fieldBindings[target];
  if (!Object.keys(suggestion.fieldBindings).length || (invalid.size && getInvalidFields().size))
    return;
  const bindingCount = Object.keys(suggestion.fieldBindings).length;
  if (suggestion.evidence?.includes('matching-context')) {
    const contextLost =
      matchingContextWeight(Object.keys(candidate.fieldBindings).length) -
      matchingContextWeight(bindingCount);
    suggestion.confidence = Math.max(0, suggestion.confidence - contextLost);
    if (bindingCount <= 1)
      suggestion.evidence = suggestion.evidence.filter((item) => item !== 'matching-context');
  }
  if (invalid.size) {
    suggestion.confidence = Math.max(0, suggestion.confidence - 0.03);
    suggestion.evidence = [...(suggestion.evidence ?? []), 'invalid-field'];
  }
  return suggestion;
}

function availableSuggestion(
  candidate: SuggestedAsset,
  available: ReadonlySet<string>,
  required?: string,
): SuggestedAsset {
  const allowed = allowedAssetFieldSources(candidate.type);
  const anchor = required && candidate.fieldBindings[required];
  const seen = new Set(anchor ? bindingSourceIds(anchor) : []);
  const fieldBindings: SuggestedAsset['fieldBindings'] = {};
  for (const [target, binding] of Object.entries(candidate.fieldBindings)) {
    if (target === 'meta.notes' || !allowed.has(target)) continue;
    const ids = bindingSourceIds(binding);
    if (
      ids.some((id) => !available.has(id) || (target !== required && seen.has(id))) ||
      new Set(ids).size !== ids.length
    )
      continue;
    fieldBindings[target] = binding;
    ids.forEach((id) => seen.add(id));
  }
  return { ...candidate, fieldBindings };
}

export function additionalFieldsAsset(
  session: ImportSession,
  node: ImportedNode,
  fields: ImportedField[],
): SuggestedAsset {
  return {
    ...allFieldsAsPlainText(session, node, fields),
    variant: 'additional-fields',
    name: `${node.name} — additional fields`,
    rationale: 'Additional imported fields are preserved as Plain Text for review.',
  };
}

export function suggestedAssetToDraft(suggestion: SuggestedAsset, id: string): AssetDraft {
  const allowed = allowedAssetFieldSources(suggestion.type);
  return {
    id,
    type: suggestion.type,
    name: suggestion.name,
    fieldBindings: Object.fromEntries(
      Object.entries(suggestion.fieldBindings)
        .filter(([assetFieldSource]) => allowed.has(assetFieldSource))
        .map(([assetFieldSource, binding]) => [assetFieldSource, cloneBinding(binding)]),
    ),
  };
}

/** Copy bindings so edits to a draft cannot change its suggestion. */
function cloneBinding(binding: SuggestedFieldBinding): FieldBinding {
  switch (binding.kind) {
    case 'literal':
      return { kind: 'literal', value: new SensitiveValue(binding.value.reveal()) };
    case 'sources':
      return {
        kind: 'sources',
        sources: binding.sources.map((source) => ({
          sourceFieldId: source.sourceFieldId,
          name: source.name,
        })),
      };
    case 'source':
      return { kind: 'source', sourceFieldId: binding.sourceFieldId };
  }
}

export function sourceCandidates(
  session: ImportSession,
  node: ImportedNode,
): Array<{ id: string; name: string }> {
  return fieldsOf(session, node).map((field) => ({ id: field.id, name: field.name }));
}

export function resolveSourceValue(
  session: ImportSession,
  sourceFieldId: string,
): SensitiveValue | undefined {
  return session.fieldsById[sourceFieldId]?.value;
}

export function collectEntryNodes(session: ImportSession, nodeIds: string[]): ImportedNode[] {
  const out: ImportedNode[] = [];
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const node = session.nodesById[id];
    if (!node) return;
    if (node.kind === 'entry') out.push(node);
    node.childNodeIds.forEach(visit);
  };
  nodeIds.forEach(visit);
  return out;
}

export function fieldsOf(session: ImportSession, node: ImportedNode): ImportedField[] {
  return node.fieldIds
    .map((id) => session.fieldsById[id])
    .filter((field): field is ImportedField => !!field);
}
