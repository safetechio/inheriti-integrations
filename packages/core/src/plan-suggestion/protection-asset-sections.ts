import { LocalPlanDraftValue } from '../local-plan-draft.js';
import type { LocalPlanCandidate } from '../local-plan-candidates.js';
import type { LocalPlanDraft, LocalPlanHints, LocalSource } from '../local-plan-assistant.js';
import type { LocalPlanSources } from '../local-plan-source.js';
import { ProtectionAssetMatcher } from './protection-asset-matcher.js';
import { ProtectionPlanProposal } from './protection-plan-proposal.js';

/** Uses explicit blank-line sections as asset names when every line is a labeled value. */
export class ProtectionAssetSections {
  private readonly assetMatcher: ProtectionAssetMatcher;
  constructor(
    private readonly candidates: readonly LocalPlanCandidate[],
    private readonly sources: readonly LocalSource[],
    private readonly inputSources: LocalPlanSources,
    private readonly hints?: LocalPlanHints,
  ) { this.assetMatcher = new ProtectionAssetMatcher(sources); }

  suggest(): LocalPlanDraft | null {
    if (this.sources.length !== 1 || this.sources[0]?.kind !== 'message') return null;
    const source = this.sources[0];
    const sections: { heading: string; members: LocalPlanCandidate[] }[] = [];
    let cursor = 0;
    for (const block of source.text.split(/\r?\n[ \t]*\r?\n/u)) {
      const start = source.text.indexOf(block, cursor);
      if (start < 0) return null;
      cursor = start + block.length;
      const lineSpans = [...block.matchAll(/[^\r\n]+/gu)].filter((line) => line[0].trim());
      const lines = lineSpans.map((line) => line[0].trim());
      const members = this.candidates.filter(({ valueReference }) => 'start' in valueReference
        && valueReference.start >= start && valueReference.end <= cursor);
      if (!members.length) continue;
      const heading = (lines[0] ?? '').replace(/^#{1,6}\s+/u, '').replace(/:$/u, '').trim();
      if (lines.length < 3 || !heading || heading.length > 80 || /[:=]/u.test(heading)
        || members.length !== lines.length - 1 || !lines.slice(1).every((line) =>
          /^[\p{L}\p{N}_][\p{L}\p{N}_ -]{0,80}\s*[:=]\s*\S/u.test(line))
        || !lineSpans.slice(1).every((line) => members.filter(({ valueReference }) => 'start' in valueReference
          && valueReference.start >= start + line.index! && valueReference.end <= start + line.index! + line[0].length).length === 1)) return null;
      sections.push({ heading, members });
    }
    if (sections.length < 2 || sections.some(({ members }) => !members.some((candidate) => this.role(candidate) !== 'unknown'))
      || sections.flatMap(({ members }) => members).length !== this.candidates.length) return null;
    const title = this.inputSources.explicitName('plan') ?? this.hints?.title
      ?? sections.map(({ heading }) => heading).join(' · ').slice(0, 200);
    const mapper = new ProtectionPlanProposal(this.candidates, this.sources, this.inputSources, this.hints);
    const draft = mapper.fromSemanticGroups({ planName: title, groups: sections.map(({ heading, members }) => ({ name: heading,
      fields: members.map((candidate) => ({ role: this.role(candidate), valueId: candidate.id })) })), ignored: [] });
    const assets = (draft.assets ?? [draft.asset]).map((asset) => {
      if (asset.type !== 'PLAIN-TEXT') return asset;
      const candidate = this.candidates.find(({ valueReference }) => JSON.stringify(valueReference) === JSON.stringify(asset.fields.text));
      const section = sections.find(({ members }) => members.includes(candidate!));
      if (!candidate || !section) return asset;
      const path = this.isKeyPath(candidate) ? ' path' : '';
      return { ...asset, name: `${section.heading} ${candidate.label}${path}` };
    });
    return LocalPlanDraftValue.from({ title: draft.title,
      ...(assets.length === 1 ? { asset: assets[0] } : { assets }), questions: [], unassignedSources: [] }, this.sources).draft;
  }

  private role(candidate: LocalPlanCandidate): string {
    return this.assetMatcher.roleForLabel(candidate);
  }

  private isKeyPath(candidate: LocalPlanCandidate): boolean {
    if (!('start' in candidate.valueReference)) return false;
    const source = this.sources.find(({ id }) => id === candidate.valueReference.sourceId);
    return source?.kind === 'message' && /^(?:~[/\\]|[./][\\/]|[A-Za-z]:[\\/])/u.test(
      source.text.slice(candidate.valueReference.start, candidate.valueReference.end));
  }
}
