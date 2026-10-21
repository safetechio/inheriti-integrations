import { collectEntryNodes, fieldsOf } from '@modules/mapping/application/suggestion-engine';
import type {
  SuggestedAsset,
  SuggestionContext,
  SuggestionResult,
  SuggestionStrategy,
} from '@modules/mapping/domain/suggestion';
import { getAssetTypeDisplayName } from '@modules/_shared/domain/asset-type-display-name';
import type { ImportedField, ImportedNode } from '@modules/import/domain/import-model';
import { isValidUserPasswordEmail } from '@modules/plans/domain/asset-metadata';

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
  {
    type: 'PAYMENT-CREDIT-CARD',
    fields: {
      'secret.cardNumber': ['cardnumber', 'creditcardnumber'],
      'secret.expiryDate': ['expirydate', 'expirationdate', 'expiry'],
      'secret.cardHolderName': ['cardholdername', 'cardholder'],
      'secret.bank': ['bank'],
      'secret.code': ['code', 'cvv', 'cvc'],
      'secret.pinCode': ['pincode', 'pin'],
      'secret.accountNumber': ['accountnumber'],
      'secret.clientId': ['clientid'],
    },
    required: ['secret.cardNumber'],
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

  /** Finds the strongest supported asset match for each entry. */
  suggest(context: SuggestionContext): SuggestionResult {
    const assets: SuggestedAsset[] = [];
    for (const node of collectEntryNodes(context.session, context.nodeIds)) {
      const fields = fieldsOf(context.session, node);
      if (fields.length === 0) continue;
      const best = this.bestMatch(context, node, fields);
      if (best) assets.push(best);
    }
    return { strategyId: this.id, assets };
  }

  /** Compares eligible rules by the share of fields they match. */
  private bestMatch(
    context: SuggestionContext,
    node: ImportedNode,
    fields: ImportedField[],
  ): SuggestedAsset | null {
    let best: SuggestedAsset | null = null;
    for (const rule of RULES) {
      if (!this.isEligible(rule, context, fields)) continue;
      const bindings = this.matchFields(rule, fields);
      if (!rule.required.every((field) => bindings[field])) continue;
      this.bindEmailUsername(rule, fields, bindings);
      const candidate = this.createSuggestion(rule, node, bindings);
      this.bindNativeNotes(context, node, fields, candidate);
      if (!best || candidate.confidence > best.confidence) best = candidate;
    }
    return best;
  }

  /** Keeps ambiguous field combinations from matching unrelated asset types. */
  private isEligible(
    rule: AliasRule,
    context: SuggestionContext,
    fields: ImportedField[],
  ): boolean {
    if (!context.knownAssetTypes.has(rule.type)) return false;
    if (rule.type !== 'API-KEY') return true;
    return !(
      fields.some((field) => fieldNames(field.name).includes('accesskeyid')) &&
      fields.some((field) => fieldNames(field.name).includes('secretaccesskey'))
    );
  }

  /** Binds the first nonempty source field for each alias. */
  private matchFields(
    rule: AliasRule,
    fields: ImportedField[],
  ): Record<string, { kind: 'source'; sourceFieldId: string }> {
    const bindings: Record<string, { kind: 'source'; sourceFieldId: string }> = {};
    for (const [assetField, aliases] of Object.entries(rule.fields)) {
      const match = aliases
        .map(normalise)
        .map((alias) =>
          fields.find(
            (field) => fieldNames(field.name).includes(alias) && field.value.reveal().length > 0,
          ),
        )
        .find(Boolean);
      if (match) bindings[assetField] = { kind: 'source', sourceFieldId: match.id };
    }
    return bindings;
  }

  /** Put an email-shaped username in the email field when no email was supplied. */
  private bindEmailUsername(
    rule: AliasRule,
    fields: ImportedField[],
    bindings: Record<string, { kind: 'source'; sourceFieldId: string }>,
  ): void {
    if (rule.type !== 'USER-PSWD' || bindings['secret.email']) return;
    const username = bindings['secret.username'];
    if (!username) return;
    const field = fields.find((candidate) => candidate.id === username.sourceFieldId);
    if (!field || !isValidUserPasswordEmail(field.value.reveal())) return;
    bindings['secret.email'] = username;
    delete bindings['secret.username'];
  }

  /** Only formats with dedicated note fields may populate readable asset metadata. */
  private bindNativeNotes(
    context: SuggestionContext,
    node: ImportedNode,
    fields: ImportedField[],
    candidate: SuggestedAsset,
  ): void {
    const source = context.session.sources.find((item) => item.id === node.sourceId);
    if (!source || !['onepassword', 'keepass', 'passbolt'].includes(source.kind)) return;
    const notes = fields.find((field) => field.name === 'notes' && !field.value.isEmpty);
    if (!notes) return;
    candidate.fieldBindings['meta.notes'] = { kind: 'source', sourceFieldId: notes.id };
  }

  /** Records the match score and a short explanation for review. */
  private createSuggestion(
    rule: AliasRule,
    node: ImportedNode,
    bindings: Record<string, { kind: 'source'; sourceFieldId: string }>,
  ): SuggestedAsset {
    const matched = Object.keys(bindings).length;
    const total = Object.keys(rule.fields).length;
    return {
      type: rule.type,
      name: node.name,
      fieldBindings: bindings,
      fromNodeId: node.id,
      confidence: 0.4 + 0.5 * (matched / total),
      rationale: `Field names matched ${getAssetTypeDisplayName(rule.type)} (${matched}/${total} fields).`,
    };
  }
}
