import type { PageFieldTarget, PageFirstFieldCandidate, ProtectedFieldRef } from '../shared/access-contract.js';

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
    .filter((protectedField) => protectedField.fieldName === pageTarget.semantic)
    .map((protectedField): PageFirstFieldCandidate => ({
      planName,
      suggestion: {
        mapping: { protectedField, pageTarget, source: 'MANUAL' },
        confidence: protectedField.matchesOrigin ? 'HIGH' : 'MEDIUM',
        reason: protectedField.matchesOrigin ? 'exact-origin' : 'inferred-semantic',
      },
    }))));
  return candidates.sort((left, right) => Number(right.suggestion.mapping.protectedField.matchesOrigin)
    - Number(left.suggestion.mapping.protectedField.matchesOrigin)
    || left.planName.localeCompare(right.planName)
    || left.suggestion.mapping.protectedField.selector.localeCompare(right.suggestion.mapping.protectedField.selector));
}
