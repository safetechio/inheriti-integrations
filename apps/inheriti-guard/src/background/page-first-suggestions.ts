import type { PageFieldTarget, PageFirstFieldCandidate, ProtectedFieldRef } from '../shared/access-contract.js';
import { compatibleFieldSemantics } from './field-suggestions.js';

export interface PageFirstPlanFields {
  readonly planName: string;
  readonly protectedFields: readonly ProtectedFieldRef[];
}

/** Ranks metadata-only protected fields for each selected page target; it never reads page values. */
export function pageFirstSuggestions(
  plans: readonly PageFirstPlanFields[],
  pageTargets: readonly PageFieldTarget[],
): readonly PageFirstFieldCandidate[] {
  const candidates = plans.flatMap(({ planName, protectedFields }) => pageTargets.flatMap((pageTarget) => protectedFields
    .filter((protectedField) => compatibleFieldSemantics(protectedField.fieldName, pageTarget.semantic))
    .map((protectedField): PageFirstFieldCandidate => ({
      planName,
      assetFieldNames: protectedFields
        .filter((field) => field.assetId === protectedField.assetId)
        .map((field) => field.fieldName),
      suggestion: {
        mapping: { protectedField, pageTarget, source: 'MANUAL' },
        confidence: protectedField.matchesOrigin ? 'HIGH' : 'MEDIUM',
        reason: protectedField.matchesOrigin ? 'exact-origin' : 'inferred-semantic',
      },
    }))));
  candidates.sort((left, right) => Number(right.suggestion.mapping.protectedField.matchesOrigin)
    - Number(left.suggestion.mapping.protectedField.matchesOrigin)
    || Number(right.suggestion.mapping.protectedField.fieldName === right.suggestion.mapping.pageTarget.semantic)
      - Number(left.suggestion.mapping.protectedField.fieldName === left.suggestion.mapping.pageTarget.semantic)
    || left.planName.localeCompare(right.planName)
    || left.suggestion.mapping.protectedField.selector.localeCompare(right.suggestion.mapping.protectedField.selector));
  const inferred = new Set<string>();
  return candidates.filter(({ suggestion }) => {
    const { protectedField, pageTarget } = suggestion.mapping;
    if (!protectedField.fieldNamesInferred) return true;
    const key = JSON.stringify([protectedField.planId, protectedField.assetId, pageTarget.targetId]);
    if (inferred.has(key)) return false;
    inferred.add(key);
    return true;
  });
}
