import type {
  AccessFieldSuggestion,
  AccessSuggestionConfidence,
  AccessSuggestionReason,
  FieldMapping,
  PageFieldTarget,
  ProtectedFieldRef,
  ProtectedFieldSemantic,
} from '../shared/access-contract.js';

export type {
  AccessFieldSuggestion,
  AccessSuggestionConfidence,
  AccessSuggestionReason,
} from '../shared/access-contract.js';

export interface SuggestionPageField {
  readonly target: PageFieldTarget;
  readonly autocomplete?: string;
  readonly inputType?: string;
  readonly accessibleLabel?: string;
  readonly name?: string;
  readonly elementId?: string;
}

export type SuggestionRejection =
  | 'mixed-plan'
  | 'duplicate-protected-field'
  | 'duplicate-page-target';

export type FieldSuggestionResult =
  | {
      readonly accepted: true;
      readonly mappings: readonly FieldMapping[];
      readonly suggestions: readonly AccessFieldSuggestion[];
    }
  | { readonly accepted: false; readonly reason: SuggestionRejection };

export interface SuggestFieldMappingsInput {
  readonly planId: string;
  readonly protectedFields: readonly ProtectedFieldRef[];
  readonly pageFields: readonly SuggestionPageField[];
  readonly existingMappings?: readonly FieldMapping[];
}

interface RankedPair {
  readonly protectedField: ProtectedFieldRef;
  readonly pageField: SuggestionPageField;
  readonly score: number;
  readonly confidence: AccessSuggestionConfidence;
  readonly reason: AccessSuggestionReason;
}

/** Refreshes suggestions without replacing mappings explicitly chosen by the operator. */
export function suggestFieldMappings(input: SuggestFieldMappingsInput): FieldSuggestionResult {
  const protectedSelectors = new Set<string>();
  for (const field of input.protectedFields) {
    if (field.planId !== input.planId) return { accepted: false, reason: 'mixed-plan' };
    if (protectedSelectors.has(field.selector)) {
      return { accepted: false, reason: 'duplicate-protected-field' };
    }
    protectedSelectors.add(field.selector);
  }

  const targetIds = new Set<string>();
  for (const field of input.pageFields) {
    if (targetIds.has(field.target.targetId)) {
      return { accepted: false, reason: 'duplicate-page-target' };
    }
    targetIds.add(field.target.targetId);
  }

  const explicitMappings = (input.existingMappings ?? []).filter(
    (mapping) => mapping.source !== 'SUGGESTED',
  );
  for (const mapping of explicitMappings) {
    if (mapping.protectedField.planId !== input.planId) return { accepted: false, reason: 'mixed-plan' };
    if (protectedSelectors.has(mapping.protectedField.selector)) continue;
    protectedSelectors.add(mapping.protectedField.selector);
  }
  const explicitSelectorCounts = countBy(explicitMappings, (mapping) => mapping.protectedField.selector);
  if ([...explicitSelectorCounts.values()].some((count) => count > 1)) {
    return { accepted: false, reason: 'duplicate-protected-field' };
  }
  const explicitTargetCounts = countBy(explicitMappings, (mapping) => mapping.pageTarget.targetId);
  if ([...explicitTargetCounts.values()].some((count) => count > 1)) {
    return { accepted: false, reason: 'duplicate-page-target' };
  }

  const occupiedSelectors = new Set(explicitMappings.map((mapping) => mapping.protectedField.selector));
  const occupiedTargets = new Set(explicitMappings.map((mapping) => mapping.pageTarget.targetId));
  const pairs: RankedPair[] = [];

  for (const protectedField of input.protectedFields) {
    if (occupiedSelectors.has(protectedField.selector)) continue;
    for (const pageField of input.pageFields) {
      if (occupiedTargets.has(pageField.target.targetId)) continue;
      const rank = rankPair(protectedField, pageField);
      if (rank) pairs.push({ protectedField, pageField, ...rank });
    }
  }

  pairs.sort((left, right) =>
    right.score - left.score
    || left.protectedField.selector.localeCompare(right.protectedField.selector)
    || left.pageField.target.targetId.localeCompare(right.pageField.target.targetId));

  const suggestions: AccessFieldSuggestion[] = [];
  for (const pair of pairs) {
    if (occupiedSelectors.has(pair.protectedField.selector)
      || occupiedTargets.has(pair.pageField.target.targetId)) continue;
    occupiedSelectors.add(pair.protectedField.selector);
    occupiedTargets.add(pair.pageField.target.targetId);
    suggestions.push({
      mapping: {
        protectedField: pair.protectedField,
        pageTarget: pair.pageField.target,
        source: 'SUGGESTED',
      },
      confidence: pair.confidence,
      reason: pair.reason,
    });
  }

  return {
    accepted: true,
    mappings: [...explicitMappings, ...suggestions.map(({ mapping }) => mapping)],
    suggestions,
  };
}

function rankPair(
  protectedField: ProtectedFieldRef,
  pageField: SuggestionPageField,
): Omit<RankedPair, 'protectedField' | 'pageField'> | undefined {
  const semantic = protectedField.fieldName;
  if (pageField.target.semantic !== semantic) return undefined;

  const autocomplete = normalize(pageField.autocomplete);
  const exactAutocomplete = autocompleteTokens(semantic).includes(autocomplete);
  const inputType = normalize(pageField.inputType);
  const exactType = inputTypeMatches(semantic, inputType);
  const heuristic = heuristicReason(semantic, pageField);
  const originBonus = protectedField.matchesOrigin ? 1_000 : 0;

  if (exactAutocomplete) {
    return { score: originBonus + 400, confidence: 'HIGH', reason: 'autocomplete' };
  }
  if (exactType) {
    return { score: originBonus + 300, confidence: 'HIGH', reason: 'input-type' };
  }
  if (heuristic) {
    return { score: originBonus + 200 - heuristic.penalty, confidence: 'MEDIUM', reason: heuristic.reason };
  }
  return { score: originBonus + 100, confidence: 'LOW', reason: 'inferred-semantic' };
}

function autocompleteTokens(semantic: ProtectedFieldSemantic): readonly string[] {
  if (semantic === 'password') return ['current-password', 'new-password'];
  return [semantic];
}

function inputTypeMatches(semantic: ProtectedFieldSemantic, inputType: string): boolean {
  if (semantic === 'password') return inputType === 'password';
  if (semantic === 'email') return inputType === 'email';
  return inputType === 'text';
}

function heuristicReason(
  semantic: ProtectedFieldSemantic,
  field: SuggestionPageField,
): { readonly reason: AccessSuggestionReason; readonly penalty: number } | undefined {
  const aliases = semantic === 'username' ? ['username', 'user', 'login'] : [semantic];
  const sources = [
    ['accessible-label', field.accessibleLabel, 0],
    ['name', field.name, 1],
    ['id', field.elementId, 2],
  ] as const;
  for (const [reason, value, penalty] of sources) {
    const tokens = normalize(value).split(/[^a-z0-9]+/u);
    if (aliases.some((alias) => tokens.includes(alias))) return { reason, penalty };
  }
  return undefined;
}

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}
