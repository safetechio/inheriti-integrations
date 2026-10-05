import { quickPlanAssetCatalog } from './quick-plan.js';
import type { LocalSource } from './local-plan-assistant.js';

export const localPlanInputLimits = { message: 4_000, file: 8_000, fileBytes: 16_384, total: 8_000 } as const;

/** One original message or parsed file, kept as the source of exact values. */
export class LocalPlanSource {
  constructor(readonly value: LocalSource) {}

  static parse(id: string, text: string): LocalPlanSource {
    return new LocalPlanSource(parseLocalTextSource(id, text));
  }

  quotedSpans(): { sourceId: string; start: number; end: number }[] {
    return quotedLocalValueSpans(this.value);
  }

  entries(): LocalPlanEntry[] { return localPlanEntries(this.value); }
}

export type LocalPlanEntry = { label: string; reference: { sourceId: string; start: number; end: number } | { sourceId: string; key: string }; valueReference: { sourceId: string; start: number; end: number } | { sourceId: string; key: string } };

/** A validated group of local inputs and their unambiguous source metadata. */
export class LocalPlanSources {
  constructor(readonly values: readonly LocalSource[]) {
    validateSources(values);
  }

  assetCandidates(): string[] {
    return localPlanAssetCandidates(this.values);
  }

  assertScope(hasContext = false): void {
    assertLocalPlanScope(this.values, hasContext);
  }

  explicitName(subject: 'plan' | 'asset'): string | undefined {
    return explicitName(this.values, subject);
  }

  explicitDescription(): string | undefined {
    return explicitLabel(this.values, /(?:plan description|description|descrition|descripci[oó]n(?: del plan)?)/iu, 1_000);
  }

  explicitAssetNames(): string[] | undefined {
    for (const source of [...this.values].reverse()) {
      if (source.kind !== 'message') continue;
      const line = [...source.text.matchAll(/^\s*(?:assets|activos)\s*:\s*(.+)$/gimu)].at(-1)?.[1];
      if (!line) continue;
      const names = line.split(/[,;]/u).map((name) => name.trim());
      if (names.length > 1 && names.every((name) => name && name.length <= 200)) return names;
    }
  }

  accountContextName(): string | undefined {
    for (const source of [...this.values].reverse()) {
      if (source.kind !== 'message') continue;
      const service = /\b(?:a|an|the|my)\s+([\p{Lu}][\p{L}\p{N}.-]{1,40})\s+account\s+credentials?\b/u.exec(source.text)?.[1];
      if (!service) continue;
      const purpose = /\bcredentials?\s+for\s+(?:(?:a|an|the|my)\s+)?([\p{L}][\p{L}\p{N}-]{1,30})\s+account\b/iu.exec(source.text)?.[1];
      return [service, purpose && purpose.toLowerCase() !== service.toLowerCase() ? purpose : undefined, 'account'].filter(Boolean).join(' ');
    }
  }

  secretValues(): string[] {
    return sourceValues(this.values);
  }
}

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid plan suggestion');
  return value as Record<string, unknown>;
};

const planTerms = /\b(?:plan|asset|activo|secret|secreto|password|passphrase|contrase(?:ña|na)|clave|key|token|api|login|cuenta|account|credencial|credential|recovery|recuperaci[oó]n|c[oó]digo|code|pin|documento|document|imagen|image|video|frase|seed|semilla|guardar|protect|proteger)\b/iu;
const otherQuestion = /^(?:what|why|how|when|where|who|cu[aá]l|qu[eé]|por qu[eé]|c[oó]mo|cu[aá]ndo|d[oó]nde|qui[eé]n|tell me|dime|cu[eé]ntame|write|escribe|translate|traduce|summarize|resume|calculate|calcula|explain|explica)\b/iu;
const suggestionIntent = /\b(?:create|crear|suggest|sugerir|sugiere|save|guardar|protect|proteger|convertir)\b/iu;
const normalizedField = (field: string) => field.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
const metadataLabel = /^(?:title|plan[_ ]?(?:name|title|description)|description|assets?|nombre[_ ]?del[_ ]?plan|descripci[oó]n(?: del plan)?)$/iu;

function localPlanEntries(source: LocalSource): LocalPlanEntry[] {
  if (source.kind === 'fields') return Object.keys(source.fields).filter((key) => !metadataLabel.test(key)).map((label) => ({
    label, reference: { sourceId: source.id, key: label }, valueReference: { sourceId: source.id, key: label },
  }));
  const entries: LocalPlanEntry[] = [];
  for (const match of source.text.matchAll(/(?:^|\b(?:values?|valores?)\s*:\s*)([ \t]*(?:export[ \t]+)?([\p{L}_][\p{L}\p{N}_ -]{0,80})[ \t]*=[ \t]*(\S[^\r\n]*))/gmu)) {
    const label = match[2]!.trim();
    if (metadataLabel.test(label)) continue;
    const value = match[3]!;
    const assignment = match[1]!;
    const start = match.index + match[0].lastIndexOf(assignment);
    const quoted = value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0];
    const valueStart = start + assignment.lastIndexOf(value) + Number(quoted);
    entries.push({ label, reference: { sourceId: source.id, start, end: start + assignment.length },
      valueReference: { sourceId: source.id, start: valueStart, end: valueStart + value.length - 2 * Number(quoted) } });
  }
  return entries;
}
const uniqueAssetByField = new Map<string, string>();
for (const { id, fields } of quickPlanAssetCatalog) for (const field of fields) {
  const key = normalizedField(field);
  if (!uniqueAssetByField.has(key)) uniqueAssetByField.set(key, id);
  else if (uniqueAssetByField.get(key) !== id) uniqueAssetByField.set(key, '');
}
uniqueAssetByField.set('contrasena', 'USER-PSWD');

function sourceAssetType(source: LocalSource): string[] {
  return [...new Set(sourceFieldLabels(source).map((label) => uniqueAssetByField.get(normalizedField(label))).filter((id): id is string => !!id))];
}

function sourceFieldLabels(source: LocalSource): string[] {
  return source.kind === 'fields' ? Object.keys(source.fields) : [...source.text.matchAll(/([\p{L}_][\p{L}\p{N}_-]*)\s*(?::|=|\bis\b|\bes\b)/giu)].map((match) => match[1]!);
}

function explicitName(sources: readonly LocalSource[], subject: 'plan' | 'asset'): string | undefined {
  const noun = subject === 'plan' ? 'plan' : '(?:asset|activo)';
  const leads = [`\\b${noun}\\s+(?:named|called|llamado|con nombre)\\s+`, `\\bnombre\\s+del\\s+${noun}\\s*(?:es|:)\\s*`, `\\bcall\\s+(?:the|my)\\s+${noun}\\s+`];
  for (const source of [...sources].reverse()) {
    if (source.kind !== 'message') continue;
    const labeled = explicitLabel([source], subject === 'plan'
      ? /(?:plan name|plan title|title|nombre del plan|t[ií]tulo del plan)/iu
      : /(?:asset name|nombre del activo)/iu, 200);
    if (labeled) return labeled;
    for (const lead of leads) {
      const quoted = new RegExp(`${lead}["']([^"']{1,200})["']`, 'i').exec(source.text)?.[1];
      const plain = new RegExp(`${lead}(.+?)(?=\\s+(?:para|for)\\b|[.;\\n]|$)`, 'i').exec(source.text)?.[1];
      const name = (quoted ?? plain)?.trim();
      if (name) return name;
    }
  }
}

function explicitLabel(sources: readonly LocalSource[], label: RegExp, maxLength: number): string | undefined {
  const marker = /\b(?:plan name|plan title|title|nombre del plan|t[ií]tulo del plan|plan description|description|descrition|descripci[oó]n(?: del plan)?|asset name|nombre del activo|values?|valores?)\s*:/giu;
  for (const source of [...sources].reverse()) {
    if (source.kind !== 'message') continue;
    const labels = [...source.text.matchAll(marker)];
    for (let index = labels.length - 1; index >= 0; index--) {
      const match = labels[index]!;
      if (!label.test(match[0].slice(0, -1).trim())) continue;
      const lineEnd = source.text.indexOf('\n', match.index + match[0].length);
      const next = labels[index + 1]?.index ?? source.text.length;
      const end = Math.min(lineEnd < 0 ? source.text.length : lineEnd, next);
      const value = source.text.slice(match.index + match[0].length, end).trim().replace(/[.,;]\s*$/u, '').trim();
      if (value && value.length <= maxLength) return value;
    }
  }
}

function localPlanAssetCandidates(sources: readonly LocalSource[]): string[] {
  return [...new Set(sources.flatMap(sourceAssetType))];
}

/** Exact spans after a label and colon/equals work regardless of the label's language. */
function quotedLocalValueSpans(source: LocalSource): { sourceId: string; start: number; end: number }[] {
  if (source.kind !== 'message') return [];
  const spans: { sourceId: string; start: number; end: number }[] = [];
  const quotedValues = [
    ...source.text.matchAll(/([\p{L}\p{N}_-]{1,80})["']?\s*[:=]\s*(["'])([^\r\n]*?)\2/gu),
    ...source.text.matchAll(/\b(?:this is the value|the value is|value|secret is|secret value is)\s*(?::|=)?\s*(["'])([^\r\n]*?)\1/giu),
  ];
  for (const match of quotedValues) {
    const value = match.length === 4 ? match[3]! : match[2]!;
    const remainder = source.text.slice(match.index + match[0].length);
    if (!value || value.includes('\\') || /^[\p{L}\p{N}_"'\\]/u.test(remainder) || (match.length === 4 && /^(?:title|plan|planTitle|planName|asset|activo|assetName|name|titulo|título|nombre|nombreDelPlan|nombreDelActivo)$/iu.test(match[1]!))) continue;
    const start = match.index + match[0].lastIndexOf(value);
    if (!spans.some((span) => span.start === start)) spans.push({ sourceId: source.id, start, end: start + value.length });
  }
  return spans;
}

/** Keep general questions out of the local model, including follow-up turns. */
function assertLocalPlanScope(sources: readonly LocalSource[], hasContext = false): void {
  const latest = sources.at(-1);
  if (!latest) throw new Error('local_plan_out_of_scope');
  if (latest.kind === 'fields') {
    return;
  } else {
    const message = latest.text.trim().replace(/^[¿?¡!\s]+/u, '');
    if (otherQuestion.test(message) && !suggestionIntent.test(message)) throw new Error('local_plan_out_of_scope');
    if (planTerms.test(message)) return;
    if (quotedLocalValueSpans(latest).length) return;
    if (hasContext && !/[?？]\s*$/u.test(message)) return;
    if (message.length >= 10 && !/[?？]\s*$/u.test(message)) return;
  }
  throw new Error('local_plan_out_of_scope');
}

/** Parse only unambiguous, flat text files; retain other text for model interpretation. */
function parseLocalTextSource(id: string, text: string): LocalSource {
  if (!id || id.length > 200 || typeof text !== 'string' || !text.trim() || text.length > localPlanInputLimits.file) throw new Error('Invalid source');
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    let parsed: unknown;
    try { parsed = JSON.parse(trimmed); } catch { throw new Error('Invalid JSON source'); }
    const fields = record(parsed);
    if (!Object.keys(fields).length || Object.keys(fields).length > 100 || Object.entries(fields).some(([key, value]) => !key || key.length > 200 || typeof value !== 'string' || !value || value.length > 1_000_000)) throw new Error('Invalid JSON fields');
    return { id, kind: 'fields', fields: fields as Record<string, string> };
  }
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  if (lines.length && lines.every((line) => /^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line))) {
    if (lines.length > 100) throw new Error('Too many source fields');
    const fields: Record<string, string> = Object.create(null);
    for (const line of lines) {
      const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)!;
      const raw = match[2]!;
      const value = raw.length >= 2 && (raw[0] === '"' || raw[0] === "'") && raw.at(-1) === raw[0] ? raw.slice(1, -1) : raw;
      if (!value || value[0] === '"' || value[0] === "'" || Object.hasOwn(fields, match[1]!)) throw new Error('Invalid env field');
      fields[match[1]!] = value;
    }
    return { id, kind: 'fields', fields };
  }
  return { id, kind: 'message', text };
}

const sourceValues = (sources: readonly LocalSource[]) => sources.flatMap((source) => {
  if (source.kind === 'fields') return Object.values(source.fields);
  const values: string[] = quotedLocalValueSpans(source).map(({ start, end }) => source.text.slice(start, end));
  const pattern = /\b(?:password|passphrase|secret|secreto|contraseña|contrasena|token|api[_ -]?key|recovery[_ -]?code|c[oó]digo de recuperaci[oó]n)\b\s*(?::|=|\bes\b|\bis\b)\s*["']?([^\s,;"']{4,})/giu;
  for (const match of source.text.matchAll(pattern)) values.push(match[1]!);
  return values;
});
const validateSources = (sources: readonly LocalSource[]) => {
  if (sources.length > 100 || new Set(sources.map((source) => source.id)).size !== sources.length || sources.some((source) =>
    !source.id || source.id.length > 200 || (source.kind === 'message' ? !source.text || source.text.length > localPlanInputLimits.file :
      source.kind !== 'fields' || !Object.keys(source.fields).length || Object.keys(source.fields).length > 100 || Object.entries(source.fields).some(([key, value]) => !key || key.length > 200 || !value || value.length > localPlanInputLimits.file)))) throw new Error('Invalid sources');
  const total = sources.reduce((size, source) => size + (source.kind === 'message' ? source.text.length : Object.entries(source.fields).reduce((fieldsSize, [key, value]) => fieldsSize + key.length + value.length, 0)), 0);
  if (total > localPlanInputLimits.total) throw new Error('Input too long');
};
