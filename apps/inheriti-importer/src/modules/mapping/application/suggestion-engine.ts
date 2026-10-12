import type {
  ImportSession,
  ImportedField,
  ImportedNode,
} from '@modules/import/domain/import-model';
import { SensitiveValue } from '@modules/import/domain/import-model';
import { getPlanAssetFormFields } from '@modules/plans/domain/asset-metadata';
import type { AssetDraft } from '@modules/plans/domain/workspace-model';
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

export function allFieldsAsPlainText(node: ImportedNode, fields: ImportedField[]): SuggestedAsset {
  const sources = fields
    .filter((field) => !field.value.isEmpty)
    .map((field) => ({
      sourceFieldId: field.id,
      name: field.name.replace(/^extra:/i, ''),
    }));
  const textBinding =
    sources.length === 1
      ? { kind: 'source' as const, sourceFieldId: sources[0].sourceFieldId }
      : { kind: 'sources' as const, sources };
  return {
    type: 'PLAIN-TEXT',
    name: node.name,
    fieldBindings: sources.length ? { 'secret.text': textBinding } : {},
    fromNodeId: node.id,
    confidence: 0,
    rationale: 'No structured Asset type matched. Every non-empty field is included as Plain Text.',
  };
}

function allowedAssetFieldSources(type: string): ReadonlySet<string> {
  return new Set(
    getPlanAssetFormFields(type)
      .map((field) => field.source)
      .filter((source) => source.startsWith('secret.')),
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
  const found = runSuggestionStrategies(strategies, context);
  const bestByNode = new Map<string, SuggestedAsset>();
  for (const suggestion of found) {
    if (!bestByNode.has(suggestion.fromNodeId)) bestByNode.set(suggestion.fromNodeId, suggestion);
  }

  return collectEntryNodes(context.session, context.nodeIds)
    .map((node) => {
      const fields = fieldsOf(context.session, node);
      if (fields.length === 0) return null;
      if (fields.filter((field) => !field.value.isEmpty).length === 1) {
        return allFieldsAsPlainText(node, fields);
      }
      const candidate = bestByNode.get(node.id);
      if (!candidate) return allFieldsAsPlainText(node, fields);

      const coveredIds = new Set(
        Object.values(candidate.fieldBindings)
          .filter(
            (binding): binding is Extract<SuggestedFieldBinding, { kind: 'source' }> =>
              binding.kind === 'source',
          )
          .map((binding) => binding.sourceFieldId),
      );
      const leftover = fields.filter((field) => !coveredIds.has(field.id));
      if (leftover.length === 0) return schemaBoundSuggestion(candidate);
      return schemaBoundSuggestion(candidate);
    })
    .filter((suggestion): suggestion is SuggestedAsset => !!suggestion);
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
        .map(([assetFieldSource, binding]) => [
          assetFieldSource,
          binding.kind === 'literal'
            ? { kind: 'literal' as const, value: new SensitiveValue(binding.value.reveal()) }
            : binding.kind === 'sources'
              ? {
                  kind: 'sources' as const,
                  sources: binding.sources.map((source) => ({
                    sourceFieldId: source.sourceFieldId,
                    name: source.name,
                  })),
                }
              : { kind: 'source' as const, sourceFieldId: binding.sourceFieldId },
        ]),
    ),
  };
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
