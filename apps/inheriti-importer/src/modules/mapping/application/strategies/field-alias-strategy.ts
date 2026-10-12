import { collectEntryNodes, fieldsOf } from '@modules/mapping/application/suggestion-engine';
import type {
  SuggestedAsset,
  SuggestionContext,
  SuggestionResult,
  SuggestionStrategy,
} from '@modules/mapping/domain/suggestion';
import { getAssetTypeDisplayName } from '@modules/_shared/domain/asset-type-display-name';

interface AliasRule {
  type: string;
  fields: Record<string, string[]>;
  required: string[];
}
const RULES: AliasRule[] = [
  {
    type: 'USER-PSWD',
    fields: {
      'secret.appOrWebsite': ['url', 'website', 'app', 'appname', 'domain', 'host'],
      'secret.email': ['email', 'mail'],
      'secret.username': ['username', 'user', 'login', 'account'],
      'secret.password': ['password', 'pass', 'pwd'],
    },
    required: ['secret.password'],
  },
  {
    type: 'API-KEY',
    fields: {
      'secret.app': ['app', 'service', 'provider', 'name'],
      'secret.apiKey': [
        'apikey',
        'api_key',
        'token',
        'accesskey',
        'accesskeyid',
        'secretkey',
        'key',
      ],
    },
    required: ['secret.apiKey'],
  },
];

function normalise(name: string): string {
  return name.toLowerCase().replace(/[\s_\-.]/g, '');
}

function fieldNames(name: string): string[] {
  const sourceName = name.replace(/^extra:/i, '');
  const parts = sourceName.split(/[\s_\-.]+/);
  return parts
    .map((_, index) => normalise(parts.slice(index).join('')))
    .filter((candidate) => candidate !== 'key' || parts.length === 1);
}

export class FieldAliasSuggestionStrategy implements SuggestionStrategy {
  id = 'field-alias';

  suggest(context: SuggestionContext): SuggestionResult {
    const assets: SuggestedAsset[] = [];
    for (const node of collectEntryNodes(context.session, context.nodeIds)) {
      const fields = fieldsOf(context.session, node);
      if (fields.length === 0) continue;
      let best: SuggestedAsset | null = null;
      for (const rule of RULES) {
        if (!context.knownAssetTypes.has(rule.type)) continue;
        if (
          rule.type === 'API-KEY' &&
          fields.some((field) => fieldNames(field.name).includes('accesskeyid')) &&
          fields.some((field) => fieldNames(field.name).includes('secretaccesskey'))
        ) {
          continue;
        }
        const bindings: Record<string, { kind: 'source'; sourceFieldId: string }> = {};
        for (const [assetField, aliases] of Object.entries(rule.fields)) {
          const match = aliases
            .map(normalise)
            .map((alias) =>
              fields.find(
                (field) =>
                  fieldNames(field.name).includes(alias) && field.value.reveal().length > 0,
              ),
            )
            .find(Boolean);
          if (match) bindings[assetField] = { kind: 'source', sourceFieldId: match.id };
        }
        if (!rule.required.every((field) => bindings[field])) continue;
        const coverage = Object.keys(bindings).length / Object.keys(rule.fields).length;
        const confidence = 0.4 + 0.5 * coverage;
        if (!best || confidence > best.confidence) {
          best = {
            type: rule.type,
            name: node.name,
            fieldBindings: bindings,
            fromNodeId: node.id,
            confidence,
            rationale: `Field names matched ${getAssetTypeDisplayName(rule.type)} (${Object.keys(bindings).length}/${Object.keys(rule.fields).length} fields).`,
          };
        }
      }
      if (best) assets.push(best);
    }
    return { strategyId: this.id, assets };
  }
}
