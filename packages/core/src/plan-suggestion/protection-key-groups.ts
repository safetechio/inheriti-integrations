import { quickPlanAssetCatalog } from '../quick-plan.js';
import type { LocalPlanCandidate } from '../local-plan-candidates.js';
import type { LocalPlanDraft, LocalPlanHints, LocalSource } from '../local-plan-assistant.js';
import type { LocalPlanSources } from '../local-plan-source.js';
import { ProtectionPlanProposal } from './protection-plan-proposal.js';

/** Groups assignment keys only when their structure proves one account. */
export class ProtectionKeyGroups {
  constructor(
    private readonly candidates: readonly LocalPlanCandidate[],
    private readonly sources: readonly LocalSource[],
    private readonly inputSources: LocalPlanSources,
    private readonly hints?: LocalPlanHints,
  ) {}

  suggest(): LocalPlanDraft | null {
    if (this.sources.length !== 1) return null;
    const source = this.sources[0]!;
    const accountFields = quickPlanAssetCatalog.find(({ id }) => id === 'USER-PSWD')?.fields ?? [];
    const roles = ['email', 'username', 'password'].filter((role) => accountFields.includes(role));
    if (roles.length < 3) return null;
    const groups = new Map<string, { role: string; candidate: LocalPlanCandidate }[]>();
    for (const candidate of this.candidates) {
      if (source.kind === 'message') {
        const reference = candidate.reference;
        if (!('start' in reference) || !('start' in candidate.valueReference)) continue;
        const lineStart = source.text.lastIndexOf('\n', reference.start - 1) + 1;
        const lineEnd = source.text.indexOf('\n', reference.end);
        const line = source.text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).trim();
        const assignment = /^(?:export\s+)?([\p{L}_][\p{L}\p{N}_]*)\s*=\s*\S[^\r\n]*$/u.exec(line);
        if (assignment?.[1] !== candidate.label || candidate.valueReference.start < lineStart
          || candidate.valueReference.end > (lineEnd < 0 ? source.text.length : lineEnd)) continue;
      }
      const key = candidate.label.toLowerCase();
      for (const role of roles) {
        const suffix = role.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);
        if (!key.endsWith(`_${suffix}`)) continue;
        const prefix = key.slice(0, -suffix.length - 1);
        if (!prefix || !/^[\p{L}\p{N}]+(?:_[\p{L}\p{N}]+)*$/u.test(prefix)) break;
        const group = groups.get(prefix) ?? [];
        group.push({ role, candidate });
        groups.set(prefix, group);
        break;
      }
    }
    const safe = [...groups].filter(([, fields]) => fields.some(({ role }) => role === 'password')
      && fields.some(({ role }) => role === 'email' || role === 'username')
      && new Set(fields.map(({ role }) => role)).size === fields.length);
    if (!safe.length) return null;
    const named = safe.map(([prefix, fields]) => ({ name: prefix.replace(/_/gu, ' '),
      fields: fields.map(({ role, candidate }) => ({ role, valueId: candidate.id })) }));
    const title = this.inputSources.explicitName('plan') ?? this.hints?.title ?? 'Protected entries';
    return new ProtectionPlanProposal(this.candidates, this.sources, this.inputSources, this.hints)
      .fromSemanticGroups({ planName: title, groups: named, ignored: [] });
  }
}
