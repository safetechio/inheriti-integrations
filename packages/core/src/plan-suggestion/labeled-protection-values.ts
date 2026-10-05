import { localPlanAssetLimit } from '../asset-metadata.js';
import { LocalPlanDraftValue } from '../local-plan-draft.js';
import type { LocalPlanCandidate } from '../local-plan-candidates.js';
import type { LocalPlanDraft, LocalPlanHints, LocalSource, SourceReference } from '../local-plan-assistant.js';
import type { LocalPlanSources } from '../local-plan-source.js';
import { ProtectionAssetMatcher } from './protection-asset-matcher.js';

/** Proposes assets from an explicitly headed list of labeled values. */
export class LabeledProtectionValues {
  constructor(
    private readonly sources: readonly LocalSource[],
    private readonly inputSources: LocalPlanSources,
    private readonly hints?: LocalPlanHints,
  ) {}

  suggest(selectedType?: string): LocalPlanDraft | null {
    const source = this.sources.length === 1 ? this.sources[0] : undefined;
    if (source?.kind !== 'message') return null;
    const lines = [...source.text.matchAll(/[^\r\n]+/gu)].filter((line) => line[0].trim());
    const firstLine = lines[0]?.[0].trim() ?? '';
    const explicitTitle = this.inputSources.explicitName('plan');
    const titledLine = explicitTitle && /^title:\s*(.+)$/iu.exec(firstLine)?.[1]?.trim() === explicitTitle;
    const heading = selectedType ?? (titledLine ? explicitTitle : firstLine);
    if (titledLine && lines.slice(1).some((line) => /^title:\s*\S/iu.test(line[0].trim()))) return null;
    if (!heading || !selectedType && (heading.length > 80 || !titledLine && /[:=.!?]/u.test(heading) || lines.length < 3
      || this.inputSources.secretValues().some((value) => heading.includes(value)))) return null;

    const candidates: LocalPlanCandidate[] = [];
    for (let index = selectedType ? 0 : 1; index < lines.length; index++) {
      const line = lines[index]!;
      if (/^\s*[a-z][a-z0-9+.-]*:\/\//iu.test(line[0])) return null;
      const labeled = /^\s*([\p{L}\p{N}_][\p{L}\p{N}_ -]{0,80})\s*[:=]\s*(.*?)\s*$/u.exec(line[0]);
      if (!labeled) return null;
      let value = labeled[2]!;
      let valueLine = line;
      if (!value) {
        valueLine = lines[++index]!;
        if (!valueLine || !/:\/\//u.test(valueLine[0])
          && /^\s*[\p{L}\p{N}_][\p{L}\p{N}_ -]{0,80}\s*[:=]/u.test(valueLine[0])) return null;
        value = valueLine[0].trim();
      }
      if (!value) return null;
      const valueStart = valueLine.index! + valueLine[0].indexOf(value);
      const valueReference = { sourceId: source.id, start: valueStart, end: valueStart + value.length };
      const reference = labeled[2] && labeled[0].includes('=')
        ? { sourceId: source.id, start: line.index!, end: line.index! + line[0].length }
        : valueReference;
      candidates.push({ id: `v${candidates.length}`, label: labeled[1]!.trim(), reference, valueReference });
    }
    if (candidates.length < (selectedType ? 1 : 2) || candidates.length > localPlanAssetLimit) return null;

    const matcher = new ProtectionAssetMatcher(this.sources);
    const values = candidates.map((candidate) => ({ candidate, role: matcher.roleForLabel(candidate) }));
    if (matcher.needsSeparateAssets(values) && !selectedType) {
      const title = this.inputSources.explicitName('plan') ?? this.hints?.title ?? heading;
      const assets = candidates.map((candidate) => ({ type: 'PLAIN-TEXT', name: `${heading} ${candidate.label}`,
        fields: { text: candidate.valueReference } }));
      return LocalPlanDraftValue.from({ title, assets, questions: [], unassignedSources: [] }, this.sources).draft;
    }
    const selected = matcher.match(values);
    if (!selected || selectedType && (selected.type !== selectedType || selected.ids.size !== candidates.length)) return null;
    const assets: { type: string; name: string; fields: Record<string, SourceReference> }[] = [
      { type: selected.type, name: heading, fields: selected.fields },
      ...candidates.filter(({ id }) => !selected.ids.has(id)).map((candidate) => ({
        type: 'PLAIN-TEXT', name: `${heading} ${candidate.label}`, fields: { text: candidate.valueReference },
      })),
    ];
    if (assets.length > localPlanAssetLimit) return null;
    const title = this.inputSources.explicitName('plan') ?? this.hints?.title ?? heading;
    return LocalPlanDraftValue.from({ title, ...(assets.length === 1 ? { asset: assets[0] } : { assets }),
      questions: [], unassignedSources: [] }, this.sources).draft;
  }
}
