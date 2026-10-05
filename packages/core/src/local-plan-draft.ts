import type { QuickPlanInput } from '@safetech/inheriti-client-sdk/node';
import { quickPlanAssetCatalog } from './quick-plan.js';
import { fieldMaxLength, localPlanAssetLimit } from './asset-metadata.js';
import { LocalPlanSource, LocalPlanSources } from './local-plan-source.js';
import type { LocalPlanClarification, LocalPlanDraft, LocalSource, SourceReference } from './local-plan-assistant.js';

/** A draft whose field references were checked against the original local inputs. */
export class LocalPlanDraftValue {
  private constructor(readonly draft: LocalPlanDraft, private readonly sources: readonly LocalSource[]) {}

  static from(value: unknown, sources: readonly LocalSource[]): LocalPlanDraftValue {
    return new LocalPlanDraftValue(validateLocalPlanDraft(value, sources), sources);
  }

  static response(value: unknown, sources: readonly LocalSource[]): LocalPlanDraftValue | LocalPlanClarification {
    const result = validateLocalPlanResponse(value, sources);
    return 'asset' in result ? new LocalPlanDraftValue(result, sources) : result;
  }

  confirm(): { title: string; asset: QuickPlanInput['asset']; assets: [QuickPlanInput['asset'], ...QuickPlanInput['asset'][]] } {
    return confirmedLocalPlanInput(this.draft, this.sources);
  }
}

export const localPlanQuestions = [
  'What would you like to name this plan?',
  'Which type of asset do you want to protect?',
  'What would you like to name this asset?',
  "I couldn't tell what you want to protect yet. Add the exact value, or review the asset manually.",
  "I couldn't find an exact value to protect. Add a labeled value or attach a text file.",
  'Please quote the exact value to clarify its final punctuation.',
  'Which one asset should this plan include?',
] as const;

export const localPlanFieldMaxLength = fieldMaxLength;

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid plan suggestion');
  return value as Record<string, unknown>;
};
const keys = (value: Record<string, unknown>, allowed: readonly string[]) => {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error('Unknown plan suggestion field');
};
const label = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error('Invalid plan label');
  return value.trim();
};
const hasKnownSecret = (text: string, values: readonly string[]) => values.some((value) => text.includes(value));
const suggestionDetails = (input: Record<string, unknown>, sources: readonly LocalSource[], knownValues: readonly string[]): LocalPlanClarification => {
  if (!Array.isArray(input.questions) || !input.questions.every((item) => typeof item === 'string' && localPlanQuestions.includes(item as typeof localPlanQuestions[number]))
    || !Array.isArray(input.unassignedSources) || !input.unassignedSources.every((id) => typeof id === 'string' && sources.some((source) => source.id === id))) throw new Error('Invalid suggestion details');
  if (input.questions.some((question: string) => hasKnownSecret(question, knownValues))) throw new Error('Secret in suggestion text');
  return { questions: [...new Set(input.questions as string[])], unassignedSources: [...new Set(input.unassignedSources as string[])] };
};

/** Validate untrusted model output without copying source values into the draft. */
function validateLocalPlanDraft(value: unknown, sources: readonly LocalSource[]): LocalPlanDraft {
  const input = record(value);
  if (Object.hasOwn(input, 'assets')) {
    keys(input, ['title', 'asset', 'assets', 'questions', 'unassignedSources']);
    if (!Array.isArray(input.assets) || input.assets.length < 2 || input.assets.length > localPlanAssetLimit) throw new Error('Invalid asset count');
    const drafts = input.assets.map((asset) => validateLocalPlanDraft({ title: input.title, asset, questions: input.questions, unassignedSources: [] }, sources));
    const unique = drafts.filter((draft, index) => drafts.findIndex((other) => other.asset.type === draft.asset.type
      && Object.keys(other.asset.fields).length === Object.keys(draft.asset.fields).length
      && Object.entries(other.asset.fields).every(([field, ref]) => JSON.stringify(ref) === JSON.stringify(draft.asset.fields[field]))) === index);
    if (unique.length === 1) return validateLocalPlanDraft({ title: input.title, asset: unique[0]!.asset, questions: input.questions, unassignedSources: input.unassignedSources }, sources);
    const used: SourceReference[] = [];
    for (const draft of unique) for (const ref of Object.values(draft.asset.fields)) {
      if (used.some((prior) => prior.sourceId === ref.sourceId && ('key' in prior && 'key' in ref ? prior.key === ref.key
        : 'start' in prior && 'start' in ref && prior.start < ref.end && ref.start < prior.end))) throw new Error('Duplicate source reference');
      used.push(ref);
    }
    const details = suggestionDetails(input, sources, new LocalPlanSources(sources).secretValues());
    const unassignedSources = sources.filter((source) => source.kind === 'fields'
      ? Object.keys(source.fields).some((key) => !used.some((ref) => ref.sourceId === source.id && 'key' in ref && ref.key === key))
      : new LocalPlanSource(source).quotedSpans().some((span) => !used.some((ref) => ref.sourceId === source.id && 'start' in ref && ref.start <= span.start && ref.end >= span.end))).map(({ id }) => id);
    return { title: unique[0]!.title, asset: unique[0]!.asset, assets: unique.map(({ asset }) => asset),
      questions: details.questions.filter((question) => question !== localPlanQuestions[0] && question !== localPlanQuestions[1]
        && question !== localPlanQuestions[2] && question !== localPlanQuestions[6]
        && (question !== localPlanQuestions[3] || unassignedSources.length > 0)),
      unassignedSources: [...new Set([...details.unassignedSources, ...unassignedSources])] };
  }
  keys(input, ['title', 'asset', 'questions', 'unassignedSources']);
  const inputSources = new LocalPlanSources(sources);
  const asset = record(input.asset);
  keys(asset, ['type', 'name', 'fields']);
  const definition = quickPlanAssetCatalog.find(({ id }) => id === asset.type);
  if (!definition) throw new Error('Unknown asset type');
  const fields = record(asset.fields);
  if (!Object.keys(fields).length || Object.keys(fields).some((field) => !definition.fields.includes(field))) throw new Error('Unknown or empty asset fields');
  const resolved: string[] = [];
  const assignedSourceIds = new Set<string>();
  const assignedReferences = new Set<string>();
  const safeFields: Record<string, SourceReference> = {};
  for (const [field, raw] of Object.entries(fields)) {
    const ref = record(raw);
    const source = sources.find((item) => item.id === ref.sourceId);
    if (!source) throw new Error('Unknown source');
    assignedSourceIds.add(source.id);
    let secret: string;
    if (source.kind === 'message') {
      keys(ref, ['sourceId', 'start', 'end']);
      if (!Number.isSafeInteger(ref.start) || !Number.isSafeInteger(ref.end) || (ref.start as number) < 0 || (ref.end as number) > source.text.length || (ref.start as number) >= (ref.end as number)) throw new Error('Invalid source span');
      secret = source.text.slice(ref.start as number, ref.end as number);
      safeFields[field] = { sourceId: source.id, start: ref.start as number, end: ref.end as number };
    } else {
      keys(ref, ['sourceId', 'key']);
      if (typeof ref.key !== 'string' || !Object.hasOwn(source.fields, ref.key)) throw new Error('Invalid source field');
      secret = source.fields[ref.key]!;
      safeFields[field] = { sourceId: source.id, key: ref.key };
    }
    if (!secret || secret.length > 1_000_000 || (localPlanFieldMaxLength(field, definition.id) ?? Infinity) < secret.length) throw new Error('Invalid source value');
    const referenceKey = JSON.stringify(safeFields[field]);
    if (assignedReferences.has(referenceKey)) throw new Error('Duplicate source reference');
    assignedReferences.add(referenceKey);
    resolved.push(secret);
  }
  const title = label(input.title);
  const name = label(asset.name);
  const knownValues = [...inputSources.secretValues(), ...resolved];
  if (hasKnownSecret(title, knownValues) || hasKnownSecret(name, knownValues)) throw new Error('Secret in plan metadata');
  const details = suggestionDetails(input, sources, knownValues);
  const answered = new Set<string>([localPlanQuestions[0], localPlanQuestions[1], localPlanQuestions[2]]);
  const partlyUnused = sources.filter((source) => source.kind === 'fields'
    ? Object.keys(source.fields).some((key) => !Object.values(safeFields).some((ref) => ref.sourceId === source.id && 'key' in ref && ref.key === key))
    : new LocalPlanSource(source).quotedSpans().some((span) => !Object.entries(safeFields).some(([field, ref]) => 'start' in ref && ref.sourceId === source.id && (
      ref.start === span.start && ref.end === span.end
      || (definition.id === 'PLAIN-TEXT' && field === 'text' && ref.start <= span.start && ref.end >= span.end)
    )))).map((source) => source.id);
  const unassignedSources = [...new Set([...details.unassignedSources.filter((id) => !assignedSourceIds.has(id)), ...partlyUnused])];
  return { title, asset: { type: definition.id, name, fields: safeFields }, ...details,
    questions: details.questions.filter((question) => !answered.has(question) && (question !== localPlanQuestions[3] || unassignedSources.length > 0)),
    unassignedSources };
}

/** A model may ask for missing information without proposing a creatable asset. */
function validateLocalPlanResponse(value: unknown, sources: readonly LocalSource[]): LocalPlanDraft | LocalPlanClarification {
  const inputSources = new LocalPlanSources(sources);
  const input = record(value);
  if (Object.hasOwn(input, 'asset') || Object.hasOwn(input, 'assets')) return validateLocalPlanDraft(input, sources);
  keys(input, ['questions', 'unassignedSources']);
  const details = suggestionDetails(input, sources, inputSources.secretValues());
  if (!details.questions.length) throw new Error('Clarification requires a question');
  return details;
}

/** Call only after explicit user confirmation; revalidates refs against the original session sources. */
function confirmedLocalPlanInput(draft: LocalPlanDraft, sources: readonly LocalSource[]): { title: string; asset: QuickPlanInput['asset']; assets: [QuickPlanInput['asset'], ...QuickPlanInput['asset'][]] } {
  const valid = validateLocalPlanDraft(draft, sources);
  const assets = (valid.assets ?? [valid.asset]).map((item) => {
   const secret: Record<string, string> = {};
   for (const [field, ref] of Object.entries(item.fields)) {
    const source = sources.find((item) => item.id === ref.sourceId)!;
    if (source.kind === 'message' && 'start' in ref) {
      secret[field] = source.text.slice(ref.start, ref.end);
      continue;
    }
    if (source.kind !== 'fields' || !('key' in ref)) throw new Error('Invalid source reference');
    secret[field] = source.fields[ref.key]!;
  }
   return {
      type: item.type as QuickPlanInput['asset']['type'],
      meta: { name: item.name },
      secret: secret as QuickPlanInput['asset']['secret'],
   };
  }) as [QuickPlanInput['asset'], ...QuickPlanInput['asset'][]];
  return { title: valid.title, asset: assets[0], assets };
}
