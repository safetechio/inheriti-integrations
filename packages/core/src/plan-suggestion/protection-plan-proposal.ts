import { localPlanAssetLimit } from '../asset-metadata.js';
import { LocalPlanDraftValue } from '../local-plan-draft.js';
import type { LocalPlanCandidate } from '../local-plan-candidates.js';
import type { LocalPlanDraft, LocalPlanHints, LocalSource, SourceReference } from '../local-plan-assistant.js';
import type { LocalPlanSources } from '../local-plan-source.js';
import { ProtectionAssetMatcher, type ProtectionValue } from './protection-asset-matcher.js';

type Asset = { type: string; name: string; fields: Record<string, SourceReference> };
type ModelField = { role?: unknown; valueId?: unknown; id?: unknown };
type ModelGroup = { name?: unknown; service?: unknown; fields?: unknown; members?: unknown };
type Assignment = { group?: unknown; role?: unknown };

/** Resolves untrusted semantic IDs to exact source references and SDK catalog fields. */
export class ProtectionPlanProposal {
  private readonly byId: Map<string, LocalPlanCandidate>;
  private readonly assetMatcher: ProtectionAssetMatcher;

  constructor(
    private readonly candidates: readonly LocalPlanCandidate[],
    private readonly sources: readonly LocalSource[],
    private readonly inputSources: LocalPlanSources,
    private readonly hints?: LocalPlanHints,
  ) {
    this.byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    this.assetMatcher = new ProtectionAssetMatcher(sources);
  }

  fromSemanticGroups(output: unknown): LocalPlanDraft {
    const proposal = output && typeof output === 'object'
      ? output as { planName?: unknown; planNameValueId?: unknown; title?: unknown; groups?: unknown; ignored?: unknown; assignments?: unknown } : {};
    if ('assignments' in proposal) return this.mapAssignments(proposal.assignments, proposal.planName);
    const proposedTitleCandidate = typeof proposal.planNameValueId === 'string' ? this.byId.get(proposal.planNameValueId)
      : typeof proposal.planName === 'string' ? this.byId.get(proposal.planName) : undefined;
    const explicitTitle = this.inputSources.explicitName('plan');
    // An ID chosen by the model is not authority to publish its value as plan metadata.
    const planNameCandidate = proposedTitleCandidate && explicitTitle === this.value(proposedTitleCandidate)
      ? proposedTitleCandidate : undefined;
    const groupedIds = new Set(Array.isArray(proposal.groups) ? proposal.groups.flatMap((group: ModelGroup) => {
      const fields = group?.fields ?? group?.members;
      return Array.isArray(fields) ? fields.map((field: ModelField) => field?.valueId ?? field?.id) : [];
    }) : []);
    const ignored = Array.isArray(proposal.ignored) && proposal.ignored.every((id) => typeof id === 'string' && this.byId.has(id))
      && new Set(proposal.ignored).size === proposal.ignored.length ? proposal.ignored as string[] : [];
    // Model omission is advisory when the source label has a known semantic role.
    // Keep those exact values reviewable even if the model abstains on the whole input.
    const omitted = ignored.filter((id) => !groupedIds.has(id) && id !== planNameCandidate?.id
      && this.assetMatcher.roleForLabel(this.byId.get(id)!) === 'unknown');
    const excluded = new Set([...omitted, ...(planNameCandidate ? [planNameCandidate.id] : [])]);
    const grouped = this.groupedAssets(proposal.groups, excluded);
    const assets = grouped ?? this.candidates.filter(({ id }) => !excluded.has(id)).map((candidate) => this.plainText(candidate));
    if (!assets.length) throw new Error('No protectable value');
    if (assets.length > localPlanAssetLimit) throw new Error('Too many asset entries');

    const title = explicitTitle ?? this.safeName(proposal.planName ?? proposal.title, this.hints?.title ?? assets[0]!.name);
    try {
      const draft = this.draft(assets, title);
      return this.withOmissions(draft, omitted.filter((id) => excluded.has(id)));
    } catch {
      // A model label can be invalid or contain a protected value. Keep exact references and retry with local names.
      const fallback = this.candidates.filter(({ id }) => !excluded.has(id)).map((candidate) => this.plainText(candidate));
      return this.withOmissions(this.draft(fallback, explicitTitle ?? this.hints?.title ?? fallback[0]!.name), omitted);
    }
  }

  private mapAssignments(raw: unknown, planName: unknown): LocalPlanDraft {
    // An invalid model response must not silently discard any source values.
    const valid = Array.isArray(raw) && raw.length === this.candidates.length && raw.every((item: Assignment) =>
      item && typeof item === 'object' && typeof item.group === 'string' && item.group.length <= 200
      && typeof item.role === 'string' && this.assetMatcher.roles.has(item.role));
    if (!valid) return this.fromSemanticGroups({ planName, groups: [] });
    const assignments = raw as Assignment[];
    const ignored = this.candidates.filter((_, index) => assignments[index]!.group === '').map(({ id }) => id);
    const groups = new Map<string, { name: string; fields: { role: string; valueId: string }[] }>();
    for (const [index, candidate] of this.candidates.entries()) {
      const assignment = assignments[index]!;
      const name = assignment.group as string;
      if (!name) continue;
      const group = groups.get(name) ?? { name, fields: [] };
      group.fields.push({ role: assignment.role as string, valueId: candidate.id });
      groups.set(name, group);
    }
    return this.fromSemanticGroups({ planName, groups: [...groups.values()], ignored });
  }

  private withOmissions(draft: LocalPlanDraft, ignored: readonly string[]): LocalPlanDraft {
    const sourceIds = ignored.map((id) => this.byId.get(id)!.reference.sourceId);
    return { ...draft, unassignedSources: [...new Set([...draft.unassignedSources, ...sourceIds])] };
  }

  private groupedAssets(rawGroups: unknown, excluded: ReadonlySet<string>): Asset[] | null {
    if (!Array.isArray(rawGroups) || rawGroups.length > localPlanAssetLimit) return null;
    const used = new Set<string>();
    const assets: Asset[] = [];
    for (const raw of rawGroups) {
      if (!raw || typeof raw !== 'object') return null;
      const group = raw as ModelGroup;
      const rawFields = group.fields ?? group.members;
      if (!Array.isArray(rawFields) || !rawFields.length) return null;
      const members: ProtectionValue[] = [];
      for (const item of rawFields as ModelField[]) {
        const id = item?.valueId ?? item?.id;
        const candidate = typeof id === 'string' ? this.byId.get(id) : undefined;
        if (!candidate || used.has(candidate.id) || excluded.has(candidate.id)
          || typeof item.role !== 'string' || !this.assetMatcher.roles.has(item.role)) return null;
        used.add(candidate.id);
        members.push({ candidate, role: item.role });
      }
      const selected = this.assetMatcher.match(members);
      if (selected) assets.push({ type: selected.type,
        name: this.safeName(group.name ?? group.service, this.readableName(members[0]!.candidate.label)), fields: selected.fields });
      for (const { candidate } of members) if (!selected?.ids.has(candidate.id))
        assets.push(this.plainText(candidate, members.length > 1 || candidate.label === 'Value'
          ? this.safeName(group.name ?? group.service, this.readableName(candidate.label)) : undefined));
    }
    // `ignored` is advisory until review can show omitted candidates; never silently drop an exact input.
    for (const candidate of this.candidates) if (!used.has(candidate.id) && !excluded.has(candidate.id)) assets.push(this.plainText(candidate));
    return assets;
  }

  private plainText(candidate: LocalPlanCandidate, groupName?: string): Asset {
    const label = this.readableName(candidate.label);
    const firstGroupWord = groupName?.split(/[^\p{L}\p{N}]+/u)[0]?.toLowerCase();
    const name = groupName && candidate.label === 'Value' ? groupName
      : groupName && !label.toLowerCase().includes(groupName.toLowerCase())
      && !groupName.toLowerCase().includes(label.toLowerCase())
      && !(firstGroupWord && label.toLowerCase().startsWith(firstGroupWord))
      ? this.safeName(`${groupName} ${label}`, label) : label;
    return { type: 'PLAIN-TEXT', name, fields: { text: candidate.valueReference } };
  }

  private value(candidate: LocalPlanCandidate): string {
    const source = this.sources.find(({ id }) => id === candidate.valueReference.sourceId);
    if (!source) throw new Error('Unknown source');
    const reference = candidate.valueReference;
    return source.kind === 'message' && 'start' in reference ? source.text.slice(reference.start, reference.end)
      : source.kind === 'fields' && 'key' in reference ? source.fields[reference.key]! : '';
  }

  private readableName(label: string): string {
    return label.replace(/_/gu, ' ').toLowerCase().replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
  }

  private safeName(name: unknown, fallback: string): string {
    if (typeof name !== 'string' || !name.trim() || name.length > 200 || this.byId.has(name.trim())) return fallback;
    const proposed = name.trim();
    return this.candidates.some((candidate) => proposed.includes(this.value(candidate))) ? fallback : proposed;
  }

  private draft(assets: Asset[], title: string): LocalPlanDraft {
    return LocalPlanDraftValue.from({ title, ...(assets.length === 1 ? { asset: assets[0] } : { assets }),
      questions: [], unassignedSources: [] }, this.sources).draft;
  }
}
