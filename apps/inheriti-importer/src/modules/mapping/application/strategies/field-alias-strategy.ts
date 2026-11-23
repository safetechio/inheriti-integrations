import { isAutomaticallyMappable } from '@modules/import/domain/structured-extra-fields';
import {
  bestValidatedSuggestion,
  matchingContextWeight,
  collectEntryNodes,
  readableEntryFields,
  type AnchoredSuggestion,
} from '@modules/mapping/application/suggestion-engine';
import type {
  SuggestedAsset,
  SuggestionContext,
  SuggestionEvidence,
  SuggestionResult,
  SuggestionStrategy,
} from '@modules/mapping/domain/suggestion';
import { getAssetTypeDisplayName } from '@modules/_shared/domain/asset-type-display-name';
import type { ImportedField, ImportedNode } from '@modules/import/domain/import-model';
import { escapeSourceIdPart } from '@modules/import/domain/vault';
import { isValidUserPasswordEmail } from '@modules/plans/domain/asset-metadata';

interface AliasRule {
  type: string;
  fields: Record<string, string[]>;
  required: string;
  isRecognizable?: (value: string) => boolean;
}
const RULES: AliasRule[] = [
  {
    type: 'USER-PSWD',
    fields: {
      'secret.appOrWebsite': ['url', 'website', 'app', 'appname', 'domain', 'host'],
      'secret.ipSource': ['ipsource', 'ip/source', 'ipaddress', 'sourceip'],
      'secret.email': ['email', 'mail'],
      'secret.username': ['username', 'user', 'login', 'account'],
      'secret.password': ['password', 'pass', 'pwd'],
    },
    required: 'secret.password',
  },
  {
    type: 'API-KEY',
    fields: {
      'secret.app': ['app', 'service', 'provider', 'name'],
      'secret.apiKey': [
        'apikey',
        'apitoken',
        'token',
        'accesskey',
        'accesskeyid',
        'secretkey',
        'key',
      ],
    },
    required: 'secret.apiKey',
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
    required: 'secret.cardNumber',
  },
];

const EXPLICIT_RULES: AliasRule[] = [
  {
    type: 'RECOVERY-CODE',
    fields: { 'secret.code': ['recoverycode'] },
    required: 'secret.code',
  },
  {
    type: 'PIN-CODE',
    fields: { 'secret.code': ['pincode'] },
    required: 'secret.code',
  },
  {
    type: 'PRIVATE-KEY',
    fields: {
      'secret.privateKey': ['privatekey'],
      'secret.publicAddress': ['publicaddress'],
    },
    required: 'secret.privateKey',
    isRecognizable: (value) => /^(?:0x)?[0-9a-f]{64}$/i.test(value.trim()),
  },
  {
    type: 'SEED-PHRASE',
    fields: { 'secret.words': ['seedphrase', 'mnemonicphrase'] },
    required: 'secret.words',
    isRecognizable: (value) => {
      const words = value.trim().split(/\s+/);
      return (
        [12, 15, 18, 21, 24].includes(words.length) &&
        words.every((word) => /^\p{L}[\p{L}\p{M}]*$/u.test(word))
      );
    },
  },
];

const explicitApiKeyAliases = ['apikey', 'apitoken'];
const nativeLoginRoles: Record<string, string> = {
  'secret.appOrWebsite': 'url',
  'secret.username': 'username',
  'secret.password': 'password',
};

function aliasPrefix(name: string, aliases: readonly string[]): string | undefined {
  const parts = name
    .replace(/^extra:/i, '')
    .trim()
    .toLowerCase()
    .split(/[\s_\-.]+/);
  const maxAliasLength = Math.max(...aliases.map((alias) => alias.length));
  let alias = '';
  let suffix = -1;
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index].length + alias.length > maxAliasLength) break;
    alias = parts[index] + alias;
    if ((alias !== 'key' || parts.length === 1) && aliases.includes(alias)) suffix = index;
  }
  return suffix < 0 ? undefined : parts.slice(0, suffix).join('.');
}

function sourcePrefix(field: ImportedField, aliases: readonly string[]): string | undefined {
  const sourceKey = field.metadata.sourceKey;
  if (field.metadata.sourceRecordPath !== undefined)
    return sourceKey === undefined ? undefined : aliasPrefix(sourceKey, aliases);
  return (sourceKey ? aliasPrefix(sourceKey, aliases) : undefined) ?? aliasPrefix(field.name, aliases);
}

function fieldGroup(
  field: ImportedField,
  aliases: readonly string[],
  nativeRole?: string,
): string | undefined {
  if (!isAutomaticallyMappable(field)) return;
  const role = field.metadata.sourceRole;
  if (role && role !== nativeRole) return;
  const prefix = role ? '' : sourcePrefix(field, aliases);
  if (prefix === undefined) return;
  const { sourceSectionIdentity, sourceSection } = field.metadata;
  const section =
    sourceSectionIdentity === undefined
      ? ['name', sourceSection ?? '']
      : ['identity', sourceSectionIdentity];
  const { sourceStructuredFieldIndex, sourceRecordPath } = field.metadata;
  return JSON.stringify([section, sourceStructuredFieldIndex, sourceRecordPath, prefix]);
}

function encodedAnchorId(id: string): string {
  // Imported labels can contain isolated UTF-16 surrogates.
  return /[\uD800-\uDFFF]/u.test(id) ? escapeSourceIdPart(id) : encodeURIComponent(id);
}

export class FieldAliasSuggestionStrategy implements SuggestionStrategy {
  id = 'field-alias';

  /** Finds the strongest supported asset match for each entry. */
  suggest(context: SuggestionContext): SuggestionResult {
    const assets: SuggestedAsset[] = [];
    for (const node of collectEntryNodes(context.session, context.nodeIds)) {
      const fields = readableEntryFields(context.session, node);
      const best = bestValidatedSuggestion(
        this.suggestPrimary(context, node, fields, fields),
        context,
        node,
        new Set(fields.map((field) => field.id)),
      );
      if (best) assets.push(best);
    }
    return { strategyId: this.id, assets };
  }

  suggestPrimary(
    context: SuggestionContext,
    node: ImportedNode,
    fields: ImportedField[],
    entryFields: ImportedField[],
  ): AnchoredSuggestion[] {
    return this.candidates(context, node, fields, entryFields, false);
  }

  suggestAdditional(
    context: SuggestionContext,
    node: ImportedNode,
    fields: ImportedField[],
    entryFields: ImportedField[],
  ): AnchoredSuggestion[] {
    return this.candidates(context, node, fields, entryFields, true);
  }

  private candidates(
    context: SuggestionContext,
    node: ImportedNode,
    fields: ImportedField[],
    entryFields: ImportedField[],
    additional: boolean,
  ): AnchoredSuggestion[] {
    const candidates: AnchoredSuggestion[] = [];
    const available = new Set(fields.map((field) => field.id));
    const awsIdGroups = new Set(entryFields.map((field) => fieldGroup(field, ['accesskeyid'])));
    const awsSecretGroups = new Set(
      entryFields.map((field) => fieldGroup(field, ['secretaccesskey'])),
    );
    for (const rule of additional ? [...RULES, ...EXPLICIT_RULES] : RULES) {
      if (!context.knownAssetTypes.has(rule.type)) continue;
      const isApiKey = rule.type === 'API-KEY';
      const roles = rule.type === 'USER-PSWD' ? nativeLoginRoles : {};
      const aliases = isApiKey && additional ? explicitApiKeyAliases : rule.fields[rule.required];
      const anchorsByGroup = new Map<string, ImportedField[]>();
      for (const field of entryFields) {
        const group = fieldGroup(field, aliases, roles[rule.required]);
        if (group === undefined) continue;
        const accessIdGroup = fieldGroup(field, ['accesskeyid']);
        const accessSecretGroup = fieldGroup(field, ['secretaccesskey']);
        if (
          isApiKey &&
          ((accessIdGroup !== undefined && awsSecretGroups.has(accessIdGroup)) ||
            (accessSecretGroup !== undefined && awsIdGroups.has(accessSecretGroup)))
        )
          continue;
        const anchors = anchorsByGroup.get(group) ?? [];
        anchors.push(field);
        anchorsByGroup.set(group, anchors);
      }
      for (const [group, anchors] of anchorsByGroup) {
        if (
          rule.type === 'PRIVATE-KEY' &&
          entryFields.some((field) => fieldGroup(field, ['publickey']) === group)
        )
          continue;
        const nativeAnchors = anchors.filter(
          (anchor) => roles[rule.required] && anchor.metadata.sourceRole === roles[rule.required],
        );
        const explicitKeys = isApiKey
          ? anchors.filter((anchor) => fieldGroup(anchor, explicitApiKeyAliases) === group)
          : [];
        const preferred = nativeAnchors.length
          ? nativeAnchors
          : explicitKeys.length
            ? explicitKeys
            : anchors;
        if (preferred.length > 1 && !explicitKeys.length) continue;
        for (const anchor of preferred) {
          if (
            !available.has(anchor.id) ||
            (rule.isRecognizable && !rule.isRecognizable(anchor.value.reveal()))
          )
            continue;
          const bindings: Record<string, { kind: 'source'; sourceFieldId: string }> = {};
          let ambiguous = preferred.length > 1;
          let ambiguousEmail = false;
          for (const [target, names] of Object.entries(rule.fields)) {
            if (target === rule.required) {
              bindings[target] = { kind: 'source', sourceFieldId: anchor.id };
              continue;
            }
            if (preferred.length > 1) continue;
            const matches = entryFields.filter(
              (field) =>
                field.id !== anchor.id && fieldGroup(field, names, roles[target]) === group,
            );
            const native = matches.filter(
              (field) => roles[target] && field.metadata.sourceRole === roles[target],
            );
            const options = native.length ? native : matches;
            if (options.length > 1) {
              ambiguous = true;
              if (target === 'secret.email') ambiguousEmail = true;
            }
            if (options.length === 1 && available.has(options[0].id)) {
              bindings[target] = { kind: 'source', sourceFieldId: options[0].id };
            }
          }
          if (!ambiguousEmail) this.bindEmailUsername(rule, fields, bindings);
          const specific = !isApiKey || explicitKeys.length > 0;
          const recognized = Boolean(rule.isRecognizable) || rule.type === 'PAYMENT-CREDIT-CARD';
          const evidence: SuggestionEvidence[] = [];
          if (nativeAnchors.length) evidence.push('native-role');
          if (specific) evidence.push('specific-anchor');
          if (recognized) evidence.push('recognized-format');
          if (Object.keys(bindings).length > 1) evidence.push('matching-context');
          if (ambiguous) evidence.push('ambiguous-fields');
          const confidence =
            (specific ? (isApiKey ? 0.8 : 0.74) : 0.48) +
            (nativeAnchors.length ? 0.13 : 0) +
            (recognized ? 0.07 : 0) +
            matchingContextWeight(Object.keys(bindings).length) -
            (ambiguous ? 0.12 : 0);
          candidates.push({
            required: rule.required,
            suggestion: {
              type: rule.type,
              name: node.name,
              fieldBindings: bindings,
              fromNodeId: node.id,
              ...(additional && {
                id: `${node.id}:DETECTED-${rule.type}-${encodedAnchorId(anchor.id)}`,
              }),
              confidence: Math.min(0.99, confidence),
              rationale: `Imported fields matched ${getAssetTypeDisplayName(rule.type)}.`,
              evidence,
            },
          });
        }
      }
    }
    return candidates;
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
}
