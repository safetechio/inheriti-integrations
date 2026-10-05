import { quickPlanAssetCatalog } from '../quick-plan.js';
import { candidateSemanticRoles } from '../llama-plan-model-support.js';
import type { LocalPlanCandidate } from '../local-plan-candidates.js';
import type { LocalSource, SourceReference } from '../local-plan-assistant.js';

export type ProtectionValue = { candidate: LocalPlanCandidate; role: string };

// The SDK catalog defines valid fields. These are the minimum semantic facts
// needed before one of its types is a safe suggestion.
const evidence: Readonly<Record<string, readonly string[]>> = {
  'USER-PSWD': ['password'],
  'API-KEY': ['apiKey'],
  'PRIVATE-KEY': ['privateKey'],
  'SEED-PHRASE': ['words'],
  'RECOVERY-CODE': ['code', 'appOrWebsite'],
  'PIN-CODE': ['code', 'deviceOrApp'],
};

export class ProtectionAssetMatcher {
  readonly roles = new Set<string>([...candidateSemanticRoles, ...quickPlanAssetCatalog.flatMap(({ fields }) => fields)]);
  private readonly labeledRoles = [...this.roles].filter((role) => role !== 'unknown')
    .sort((a, b) => b.length - a.length);

  constructor(private readonly sources: readonly LocalSource[]) {}

  roleForLabel(candidate: LocalPlanCandidate): string {
    const label = candidate.label.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
    const direct = this.labeledRoles.find((known) => label.endsWith(known.toLowerCase()));
    const catalogMatches = [...new Set(quickPlanAssetCatalog.flatMap(({ fields }) => fields))]
      .filter((field) => field.toLowerCase().endsWith(label));
    const role = direct ?? (catalogMatches.length === 1 ? catalogMatches[0] : undefined) ?? 'unknown';
    return role === 'privateKey' && this.isLocalPath(candidate) ? 'unknown' : role;
  }

  needsSeparateAssets(values: readonly ProtectionValue[]): boolean {
    return !quickPlanAssetCatalog.some(({ fields }) => fields.includes('host'))
      && values.some(({ candidate, role }) => this.roleForLabel(candidate) === 'host' || role === 'host');
  }

  match(values: readonly ProtectionValue[]):
    { type: string; fields: Record<string, SourceReference>; ids: Set<string> } | null {
    if (this.needsSeparateAssets(values)) return null;
    const assigned = new Map<string, LocalPlanCandidate>();
    for (const { candidate, role } of values) {
      const fromLabel = this.roleForLabel(candidate);
      if (role === 'privateKey' && this.isLocalPath(candidate)) continue;
      const semanticRole = role === 'unknown' ? role : fromLabel !== 'unknown' ? fromLabel : role;
      const field = semanticRole === 'url' ? 'appOrWebsite' : semanticRole;
      if (field !== 'unknown' && !assigned.has(field)) assigned.set(field, candidate);
    }
    const matches = quickPlanAssetCatalog.filter(({ id, fields }) =>
      evidence[id]?.every((field) => assigned.has(field)) && fields.some((field) => assigned.has(field)))
      .map(({ id, fields }) => ({ type: id, fields: fields.filter((field) => assigned.has(field)) }))
      .sort((a, b) => b.fields.length - a.fields.length);
    const best = matches[0];
    if (!best) return null;
    return { type: best.type,
      fields: Object.fromEntries(best.fields.map((field) => [field, assigned.get(field)!.valueReference])),
      ids: new Set(best.fields.map((field) => assigned.get(field)!.id)) };
  }

  private isLocalPath(candidate: LocalPlanCandidate): boolean {
    const reference = candidate.valueReference;
    const source = this.sources.find(({ id }) => id === reference.sourceId);
    const value = source?.kind === 'message' && 'start' in reference ? source.text.slice(reference.start, reference.end)
      : source?.kind === 'fields' && 'key' in reference ? source.fields[reference.key] : '';
    return /^(?:[/\\]|~[/\\]|[.][\\/]|[A-Za-z]:[\\/])/u.test(value ?? '');
  }
}
