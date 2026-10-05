import type { QuickPlanInput } from '@safetech/inheriti-client-sdk/node';

import { quickPlanAssetCatalog } from './quick-plan.js';
import { LocalPlanSource, LocalPlanSources } from './local-plan-source.js';
import { LocalPlanDraftValue, localPlanQuestions } from './local-plan-draft.js';
import { localPlanAssetLimit } from './asset-metadata.js';
import { ProtectionValueDetector, type LocalPlanCandidate } from './plan-suggestion/protection-value-detector.js';
import { ProtectionPlanProposal } from './plan-suggestion/protection-plan-proposal.js';
import { ProtectionAssetSections } from './plan-suggestion/protection-asset-sections.js';
import { ProtectionKeyGroups } from './plan-suggestion/protection-key-groups.js';
import { LabeledProtectionValues } from './plan-suggestion/labeled-protection-values.js';
import { ProtectionAssetNames } from './plan-suggestion/protection-asset-names.js';

export const localPlanSuggestionTimeoutMs = 90_000;

export type LocalSource = Readonly<
  { id: string; kind: 'message'; text: string } |
  { id: string; kind: 'fields'; fields: Readonly<Record<string, string>> }
>;
export type SourceReference = Readonly<
  { sourceId: string; start: number; end: number } |
  { sourceId: string; key: string }
>;
export type LocalPlanDraft = Readonly<{
  title: string;
  asset: Readonly<{ type: string; name: string; fields: Readonly<Record<string, SourceReference>> }>;
  assets?: readonly Readonly<{ type: string; name: string; fields: Readonly<Record<string, SourceReference>> }>[];
  questions: readonly string[];
  unassignedSources: readonly string[];
}>;
export type LocalPlanClarification = Readonly<{ questions: readonly string[]; unassignedSources: readonly string[] }>;
export type LocalPlanHints = Readonly<{ title?: string; description?: string; assetTypes?: readonly string[] }>;
export type LocalPlanModelRequest = Readonly<{
  sources: readonly LocalSource[];
  allowedAssets: typeof quickPlanAssetCatalog;
  currentDraft: LocalPlanDraft | null;
  hints?: LocalPlanHints;
  entryLabels?: readonly string[];
  candidates?: readonly Pick<LocalPlanCandidate, 'id' | 'label'>[];
}>;
export interface LocalPlanModel {
  infer(request: LocalPlanModelRequest, signal: AbortSignal): Promise<unknown>;
}

/** Suggests assets locally; source values enter the SDK only after confirm(). */
export class ProtectionPlanAssistant {
  private readonly assetNames = new ProtectionAssetNames();
  constructor(private readonly model: LocalPlanModel) {}

  async suggest(
    sources: readonly LocalSource[],
    currentDraft: LocalPlanDraft | null,
    signal: AbortSignal,
    selectedAssetType?: string,
    hints?: LocalPlanHints,
  ): Promise<LocalPlanDraft | LocalPlanClarification> {
    const inputSources = new LocalPlanSources(sources);
    inputSources.assertScope(currentDraft !== null || sources.length > 1);
    const candidateBatch = selectedAssetType ? undefined : new ProtectionValueDetector().detect(sources);
    const detectedEntries = selectedAssetType ? [] : sources.flatMap((source) => new LocalPlanSource(source).entries());
    const entries = detectedEntries.length > 1 ? detectedEntries : [];
    const trailingProse = entries.some((entry) => {
      const source = sources.find(({ id }) => id === entry.reference.sourceId);
      return source?.kind === 'message' && 'end' in entry.reference && source.text.slice(entry.reference.end).split(/\r?\n/u)
        .some((line) => line.trim() && !/^\s*#/u.test(line) && !/^\s*(?:export\s+)?[\p{L}_][\p{L}\p{N}_ -]*\s*=/u.test(line));
    });

    const candidates = inputSources.assetCandidates();
    if (selectedAssetType && !quickPlanAssetCatalog.some(({ id }) => id === selectedAssetType)) {
      throw new Error('Invalid asset selection');
    }

    const labeled = new LabeledProtectionValues(sources, inputSources, hints).suggest(selectedAssetType);
    if (labeled) return labeled;

    if (detectedEntries.length === 1 && !selectedAssetType && !candidates.length && sources.every((source) => source.kind === 'fields')) {
      const entry = detectedEntries[0]!;
      const name = this.assetNames.readableEntry(entry.label, 0);
      return LocalPlanDraftValue.from({ title: hints?.title ?? name,
        asset: { type: 'PLAIN-TEXT', name, fields: { text: entry.valueReference } },
        questions: [], unassignedSources: [] }, sources).draft;
    }

    if (candidateBatch && candidateBatch.candidates.length) {
      const sectionDraft = new ProtectionAssetSections(candidateBatch.candidates, sources, inputSources, hints).suggest();
      if (sectionDraft) return sectionDraft;
      const keyDraft = new ProtectionKeyGroups(candidateBatch.candidates, sources, inputSources, hints).suggest();
      if (keyDraft) return keyDraft;
    }

    let candidateOutput: unknown;
    let inferredCandidates = false;
    if (!selectedAssetType) {
      const batch = candidateBatch!;
      if (batch.candidates.length) {
        candidateOutput = await this.model.infer({ sources: batch.modelSources, allowedAssets: quickPlanAssetCatalog,
          currentDraft, ...(hints ? { hints } : {}), ...(entries.length ? { entryLabels: entries.map(({ label }) => label) } : {}),
          candidates: batch.candidates.map(({ id, label }) => ({ id, label })) }, signal);
        inferredCandidates = true;
        if (candidateOutput && typeof candidateOutput === 'object' && ('groups' in candidateOutput || 'assignments' in candidateOutput)) {
          try {
            return new ProtectionPlanProposal(batch.candidates, sources, inputSources, hints).fromSemanticGroups(candidateOutput);
          } catch (error) {
            if (error instanceof Error && error.message === 'No protectable value')
              return { questions: [localPlanQuestions[4]], unassignedSources: sources.map(({ id }) => id) };
            throw error;
          }
        }
      }
    }

    const allowedAssets = selectedAssetType
      ? quickPlanAssetCatalog.filter(({ id }) => id === selectedAssetType)
      : entries.length > 1 ? quickPlanAssetCatalog
      : candidates.length ? quickPlanAssetCatalog.filter(({ id }) => candidates.includes(id) || id === 'PLAIN-TEXT') : quickPlanAssetCatalog;
    // The model schema needs original offsets; LlamaPlanModel masks values before serializing its prompt.
    const output = inferredCandidates ? candidateOutput : await this.model.infer({ sources, allowedAssets, currentDraft, ...(hints ? { hints } : {}),
      ...(entries.length ? { entryLabels: entries.map(({ label }) => label) } : {}) }, signal);
    if (entries.length && output && typeof output === 'object' && 'entryTypes' in output) {
      if ('useEntries' in output && output.useEntries === false) return { questions: [localPlanQuestions[3]], unassignedSources: sources.map(({ id }) => id) };
      const choices = (output as { entryTypes: unknown }).entryTypes;
      if (!Array.isArray(choices) || choices.length !== entries.length) return trailingProse
        ? { questions: [localPlanQuestions[3]], unassignedSources: sources.map(({ id }) => id) }
        : this.includeUnassignedValues(null, entries, sources, inputSources, hints);
      const entryValues = entries.map(({ valueReference }) => {
        const source = sources.find(({ id }) => id === valueReference.sourceId);
        return source?.kind === 'message' && 'start' in valueReference ? source.text.slice(valueReference.start, valueReference.end)
          : source?.kind === 'fields' && 'key' in valueReference ? source.fields[valueReference.key] : undefined;
      }).filter((value): value is string => !!value && value.length >= 4);
      const explicitAssetNames = inputSources.explicitAssetNames();
      const assets = entries.map((entry, index) => {
        const choice = choices[index] as { type?: unknown; field?: unknown; name?: unknown } | null;
        const definition = quickPlanAssetCatalog.find(({ id }) => id === choice?.type);
        const normalized = entry.label.replace(/[^a-z0-9]/giu, '').toLowerCase();
        const field = definition?.fields.find((item) => item === choice?.field);
        const matchesField = field && normalized.endsWith(field.toLowerCase());
        const specialized = definition && definition.id !== 'PLAIN-TEXT' && field && matchesField;
        const fallbackName = this.assetNames.readableEntry(entry.label, index);
        const proposedName = typeof choice?.name === 'string' ? choice.name.trim().replace(/_/gu, ' ') : '';
        const labelWords = entry.label.split(/[^\p{L}\p{N}]+/u).map((word) => this.assetNames.normalized(word)).filter((word) => word.length >= 3);
        const relatedName = !this.assetNames.isGeneric(proposedName) && labelWords.some((word) => this.assetNames.normalized(proposedName).includes(word));
        const preferredName = explicitAssetNames?.length === entries.length ? explicitAssetNames[index]! : relatedName ? proposedName : '';
        const name = preferredName && preferredName.length <= 200 && !entryValues.some((value) => preferredName.includes(value))
          ? preferredName : fallbackName;
        return specialized ? { type: definition.id, name, fields: { [field]: entry.valueReference } }
          : { type: 'PLAIN-TEXT', name, fields: { text: entry.valueReference } };
      });
      const proposedTitle = 'title' in output && typeof output.title === 'string' ? output.title.trim() : '';
      const safeTitle = proposedTitle && proposedTitle.length <= 200 && !/[\r\n]/u.test(proposedTitle)
        && !entryValues.some((value) => proposedTitle.includes(value)) ? proposedTitle : undefined;
      const title = inputSources.explicitName('plan') ?? safeTitle ?? hints?.title ?? 'Protected entries';
      return LocalPlanDraftValue.from({ title, assets, questions: [], unassignedSources: [] }, sources).draft;
    }

    let response: LocalPlanDraftValue | LocalPlanClarification;
    try {
      response = LocalPlanDraftValue.response(output, sources);
    } catch (error) {
      if (entries.length && !trailingProse) return this.includeUnassignedValues(null, entries, sources, inputSources, hints);
      if (error instanceof Error && error.message === 'Duplicate source reference') {
        const plainText = this.suggestPlainTextValue(sources, inputSources, selectedAssetType);
        if (plainText) return plainText;
        return { questions: [localPlanQuestions[3]], unassignedSources: [] };
      }
      throw error;
    }
    if (!(response instanceof LocalPlanDraftValue)) {
      if (entries.length && !trailingProse) return this.includeUnassignedValues(null, entries, sources, inputSources, hints);
      const plainText = response.questions.includes(localPlanQuestions[3])
        ? this.suggestPlainTextValue(sources, inputSources, selectedAssetType) : null;
      if (plainText) return plainText;
      const answered = new Set<string>();
      if (inputSources.explicitName('plan')) answered.add(localPlanQuestions[0]);
      if (inputSources.explicitName('asset')) answered.add(localPlanQuestions[2]);
      const questions = response.questions.filter((question) => !answered.has(question));
      return { ...response, questions: questions.length ? questions : [localPlanQuestions[4]] };
    }

    const suggestion = entries.length ? this.includeUnassignedValues(response.draft, entries, sources, inputSources, hints) : response.draft;
    if (selectedAssetType && suggestion.asset.type !== selectedAssetType) {
      return { questions: [localPlanQuestions[4]], unassignedSources: sources.map(({ id }) => id) };
    }
    const explicitTitle = inputSources.explicitName('plan');
    const genericTitle = /^(?:generic plan|inheriti protection plan|new plan|protected value)$/iu.test(suggestion.title);
    const hintedTitle = explicitTitle ?? (genericTitle ? hints?.title : undefined);
    if (suggestion.assets && suggestion.assets.length > 1) return hintedTitle
      ? LocalPlanDraftValue.from({ ...suggestion, title: hintedTitle }, sources).draft : suggestion;
    const accountName = suggestion.asset.type === 'USER-PSWD' ? inputSources.accountContextName() : undefined;
    const title = explicitTitle ?? accountName ?? hintedTitle ?? suggestion.title;
    const explicitAssetName = inputSources.explicitName('asset');
    const singleEntry = detectedEntries.length === 1 ? detectedEntries[0] : undefined;
    const name = explicitAssetName ?? accountName ?? (singleEntry && this.assetNames.isGeneric(suggestion.asset.name)
      ? this.assetNames.readableEntry(singleEntry.label, 0) : suggestion.asset.name);
    if (title === suggestion.title && name === suggestion.asset.name) return suggestion;
    return LocalPlanDraftValue.from({ ...suggestion, title, asset: { ...suggestion.asset, name } }, sources).draft;
  }

  private includeUnassignedValues(
    draft: LocalPlanDraft | null,
    entries: ReturnType<LocalPlanSource['entries']>,
    sources: readonly LocalSource[],
    inputSources: LocalPlanSources,
    hints?: LocalPlanHints,
  ): LocalPlanDraft {
    const existing = draft?.assets ?? (draft ? [draft.asset] : []);
    const explicitAssetNames = inputSources.explicitAssetNames();
    const entryValues = entries.map(({ valueReference }) => {
      const source = sources.find(({ id }) => id === valueReference.sourceId);
      return source?.kind === 'message' && 'start' in valueReference ? source.text.slice(valueReference.start, valueReference.end)
        : source?.kind === 'fields' && 'key' in valueReference ? source.fields[valueReference.key] : undefined;
    }).filter((value): value is string => !!value && value.length >= 4);
    const used = existing.flatMap((asset) => Object.values(asset.fields));
    const missing = entries.filter((entry) => !used.some((reference) => reference.sourceId === entry.reference.sourceId && (
      'key' in entry.reference ? 'key' in reference && reference.key === entry.reference.key
        : 'start' in reference && reference.start < entry.reference.end && entry.reference.start < reference.end
    )));
    const assets = [...existing, ...missing.map((entry, index) => {
      const explicitName = explicitAssetNames?.length === entries.length ? explicitAssetNames[entries.indexOf(entry)] : undefined;
      const fallbackName = this.assetNames.readableEntry(entry.label, index);
      return { type: 'PLAIN-TEXT', name: explicitName && !entryValues.some((value) => explicitName.includes(value)) ? explicitName : fallbackName,
        fields: { text: entry.valueReference } };
    })];
    if (!assets.length || assets.length > localPlanAssetLimit) throw new Error('Too many asset entries');
    const title = inputSources.explicitName('plan') ?? hints?.title ?? draft?.title ?? 'Protected entries';
    return LocalPlanDraftValue.from({ title, ...(assets.length === 1 ? { asset: assets[0] } : { assets }),
      questions: draft?.questions.filter((question) => question !== localPlanQuestions[3]) ?? [], unassignedSources: [] }, sources).draft;
  }

  private suggestPlainTextValue(sources: readonly LocalSource[], inputSources: LocalPlanSources, selectedAssetType?: string): LocalPlanDraft | null {
    if (sources.length !== 1 || selectedAssetType) return null;
    const source = sources[0]!;
    if (source.kind !== 'message' || !inputSources.secretValues().length
      && !/^(?:export[ \t]+)?[A-Za-z_][A-Za-z0-9_]*[ \t]*=[ \t]*\S[^\r\n]*$/u.test(source.text.trim())) return null;
    const spans = new LocalPlanSource(source).quotedSpans();
    const entry = new LocalPlanSource(source).entries()[0];
    const value = spans.length === 1 ? spans[0]! : entry?.valueReference ?? { sourceId: source.id, start: 0, end: source.text.length };
    const title = inputSources.explicitName('plan') ?? 'Protected value';
    return LocalPlanDraftValue.from({ title, asset: { type: 'PLAIN-TEXT', name: inputSources.explicitName('asset') ?? title,
      fields: { text: value } }, questions: [], unassignedSources: [] }, sources).draft;
  }

  /** Revalidates references and materializes values only after user confirmation. */
  confirm(draft: LocalPlanDraft, sources: readonly LocalSource[]): { title: string; asset: QuickPlanInput['asset']; assets: [QuickPlanInput['asset'], ...QuickPlanInput['asset'][]] } {
    return LocalPlanDraftValue.from(draft, sources).confirm();
  }
}

export { ProtectionPlanAssistant as LocalPlanAssistant };
