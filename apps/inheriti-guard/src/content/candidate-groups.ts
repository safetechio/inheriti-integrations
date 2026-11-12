interface CredentialCandidate {
  readonly suggestion: {
    readonly mapping: {
      readonly protectedField: { readonly planId: string; readonly assetId: string; readonly selector: string;
        readonly fieldName: string };
      readonly pageTarget: { readonly targetId: string };
    };
  };
}

export function groupCredentialCandidates<T extends CredentialCandidate>(candidates: readonly T[]): readonly (readonly T[])[] {
  const groups = new Map<string, T[]>();
  for (const candidate of candidates) {
    const { protectedField, pageTarget } = candidate.suggestion.mapping;
    const key = JSON.stringify([protectedField.planId, protectedField.assetId, pageTarget.targetId]);
    const group = groups.get(key);
    if (group?.some((existing) => existing.suggestion.mapping.protectedField.selector === protectedField.selector)) continue;
    if (group) group.push(candidate);
    else groups.set(key, [candidate]);
  }
  return [...groups.values()];
}

export function preferredCredentialCandidate<T extends CredentialCandidate>(
  candidates: readonly T[], selectedSelector?: string, pendingSelector?: string,
): T | undefined {
  return candidates.find((candidate) => candidate.suggestion.mapping.protectedField.selector === pendingSelector)
    ?? candidates.find((candidate) => candidate.suggestion.mapping.protectedField.selector === selectedSelector)
    ?? candidates[0];
}

export function hasCredentialFieldOverride(candidates: readonly CredentialCandidate[]): boolean {
  const fields = new Set(candidates.map((candidate) => candidate.suggestion.mapping.protectedField.fieldName));
  return fields.has('username') && fields.has('email');
}
