import type {
  ImportSession,
  ImportedField,
  ImportedNode,
} from '@modules/import/domain/import-model';
import { SensitiveValue } from '@modules/import/domain/import-model';
import { getPlanAssetFormFields } from '@modules/plans/domain/asset-metadata';
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
  return strategies
    .flatMap((strategy) => strategy.suggest(context).assets)
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

function schemaBoundSuggestion(suggestion: SuggestedAsset): SuggestedAsset {
  const allowed = allowedAssetFieldSources(suggestion.type);
  const fieldBindings = Object.fromEntries(
    Object.entries(suggestion.fieldBindings).filter(([source]) => allowed.has(source)),
  );
  return { ...suggestion, fieldBindings };
}

export function suggestWithFallback(
  strategies: readonly SuggestionStrategy[],
  context: SuggestionContext,
): SuggestedAsset[] {
  return new FallbackSuggestionEngine(strategies, context).suggest();
}

class FallbackSuggestionEngine {
  constructor(
    private readonly strategies: readonly SuggestionStrategy[],
    private readonly context: SuggestionContext,
  ) {}

  /** Suggest one or more assets for each selected entry. */
  suggest(): SuggestedAsset[] {
    const bestByNode = this.bestSuggestions();
    return collectEntryNodes(this.context.session, this.context.nodeIds).flatMap((node) =>
      this.suggestForNode(node, bestByNode.get(node.id)),
    );
  }

  /** Keep the highest confidence result for each entry. */
  private bestSuggestions(): Map<string, SuggestedAsset> {
    const bestByNode = new Map<string, SuggestedAsset>();
    for (const suggestion of runSuggestionStrategies(this.strategies, this.context)) {
      if (!bestByNode.has(suggestion.fromNodeId)) bestByNode.set(suggestion.fromNodeId, suggestion);
    }
    return bestByNode;
  }

  /** Keep unmatched notes in a protected asset beside the structured asset. */
  private suggestForNode(node: ImportedNode, candidate?: SuggestedAsset): SuggestedAsset[] {
    const fields = fieldsOf(this.context.session, node).filter((field) => !field.value.isEmpty);
    if (!fields.length) return [];
    if (!candidate || fields.length === 1)
      return [allFieldsAsPlainText(this.context.session, node, fields)];

    const structured = schemaBoundSuggestion(candidate);
    delete structured.fieldBindings['meta.notes'];
    const covered = new Set(Object.values(structured.fieldBindings).flatMap(bindingSourceIds));
    const leftover = fields.filter((field) => !covered.has(field.id));
    return leftover.length
      ? [structured, additionalFieldsAsset(this.context.session, node, leftover)]
      : [structured];
  }
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
  const visit = (id: string) => {
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
