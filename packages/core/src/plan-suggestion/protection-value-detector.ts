import type { LocalSource, SourceReference } from '../local-plan-assistant.js';

export type LocalPlanCandidate = { id: string; label: string; reference: SourceReference; valueReference: SourceReference };

/** Retain exact source references locally and replace values before model inference. */
export class ProtectionValueDetector {
  detect(sources: readonly LocalSource[]): { candidates: LocalPlanCandidate[]; modelSources: readonly LocalSource[] } {
    const candidates: LocalPlanCandidate[] = [];
    const modelSources: LocalSource[] = [];
    for (const source of sources) {
      const identified = this.scan(source).map((candidate, index) => ({ ...candidate, id: `v${candidates.length + index}` }));
      candidates.push(...identified);
      modelSources.push(this.mask(source, identified));
    }
    return { candidates, modelSources };
  }

  private scan(source: LocalSource): Omit<LocalPlanCandidate, 'id'>[] {
    if (source.kind === 'fields') return Object.keys(source.fields).map((label) => ({
      label, reference: { sourceId: source.id, key: label }, valueReference: { sourceId: source.id, key: label },
    }));
    const found = new Map<number, Omit<LocalPlanCandidate, 'id'>>();
    const add = (label: string, start: number, end: number, referenceStart = start, referenceEnd = end, wholeToken = false) => {
      if (start >= end) return;
      const exact = found.get(start);
      if (exact && 'start' in exact.valueReference && exact.valueReference.end === end) {
        if (exact.label === 'Value' || (wholeToken && label !== 'Value')) found.set(start, { label: label.trim(), reference: { sourceId: source.id, start: referenceStart, end: referenceEnd }, valueReference: exact.valueReference });
        return;
      }
      if (wholeToken) for (const [position, candidate] of found) {
        if ('start' in candidate.valueReference && start <= candidate.valueReference.start && candidate.valueReference.end <= end) found.delete(position);
      }
      if ([...found.values()].some((candidate) => 'start' in candidate.valueReference
        && candidate.valueReference.start < end && start < candidate.valueReference.end)) return;
      found.set(start, { label: label.trim(), reference: { sourceId: source.id, start: referenceStart, end: referenceEnd },
        valueReference: { sourceId: source.id, start, end } });
    };
    // Recognize structured values in prose before broad label/value patterns can overlap them.
    for (const match of source.text.matchAll(/(?:[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+|[a-z][a-z0-9+.-]*:[^\s<>"']*[@/][^\s<>"']*|[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}|(?:\d{1,3}\.){3}\d{1,3})/giu)) {
      const value = match[0].replace(/[.,;!?]+$/u, '');
      if (value) add(/^[a-z][a-z0-9+.-]*:/iu.test(value) ? 'url' : value.includes('@') ? 'email' : 'Value',
        match.index, match.index + value.length);
    }
    // Whole-line assignments and colon fields work with labels in any language.
    for (const match of source.text.matchAll(/(?:^|[.;]\s*)(?:export[ \t]+)?([\p{L}\p{N}_][\p{L}\p{N}_ -]{0,80})[ \t]*([:=])[ \t]*(\S[^\r\n]*?)(?=(?:[.;]\s+[\p{L}\p{N}_][\p{L}\p{N}_ -]{0,80}\s*[:=])|\r?\n|$)/gmu)) {
      const raw = match[3]!.trimEnd();
      if (/^[\p{L}\p{N}_][\p{L}\p{N}_ -]{0,80}\s*[:=]\s*["']/u.test(raw)) continue;
      const quote = raw[0] === '"' || raw[0] === "'" ? raw[0] : undefined;
      const close = quote ? raw.indexOf(quote, 1) : -1;
      // An unclosed quoted field is one reviewable value through the line end.
      if (quote && close < 2) {
        if (raw.length > 1) {
          const start = match.index + match[0].lastIndexOf(raw) + 1;
          add(match[1]!, start, start + raw.length - 1);
        }
        continue;
      }
      const value = quote ? raw.slice(1, close) : raw;
      if (!value || value.includes('\\') || (!quote && /["']/u.test(value))) continue;
      const start = match.index + match[0].lastIndexOf(raw) + Number(!!quote);
      const labelStart = match.index + match[0].indexOf(match[1]!);
      add(match[1]!, start, start + value.length,
        match[2] === '=' ? labelStart : start, match[2] === '=' ? match.index + match[0].length : start + value.length,
        !/\s/u.test(value));
    }
    // Quoted fields embedded in prose are still unambiguous without knowing the label's language.
    for (const match of source.text.matchAll(/([\p{L}\p{N}_][\p{L}\p{N}_ -]{0,80})\s*[:=]\s*(["'])([^\r\n"'\\]+)\2/gu)) {
      const value = match[3]!;
      const start = match.index + match[0].lastIndexOf(value);
      add(match[1]!, start, start + value.length);
    }
    for (const match of source.text.matchAll(/(["'])([^\r\n"'\\]{3,})\1/gu)) {
      const start = match.index + 1;
      add('Value', start, start + match[2]!.length);
    }
    // Opaque token shapes are candidates regardless of the surrounding language.
    for (const match of source.text.matchAll(/\b(?:[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)+|(?=[\p{L}\p{N}]{8,}\b)(?=[\p{L}\p{N}]*\p{L})(?=[\p{L}\p{N}]*\p{N})[\p{L}\p{N}]+)\b/gu)) {
      if (match[0].length < 8 || /^\s*[:=]/u.test(source.text.slice(match.index + match[0].length))) continue;
      // A suffix can be part of a secret. Keep the complete token for exact confirmation.
      const suffix = /^[^\s,;]*/u.exec(source.text.slice(match.index + match[0].length))?.[0] ?? '';
      add('Value', match.index, match.index + match[0].length + suffix.length);
    }
    return [...found.values()].sort((a, b) =>
      (a.valueReference as { start: number }).start - (b.valueReference as { start: number }).start);
  }

  private mask(source: LocalSource, identified: LocalPlanCandidate[]): LocalSource {
    if (source.kind === 'fields') return { id: source.id, kind: 'fields',
      fields: Object.fromEntries(identified.map(({ label, id }) => [label, `[${id}]`])) };
    let masked = source.text;
    for (const { id, valueReference } of [...identified].reverse()) {
      if ('start' in valueReference) masked = masked.slice(0, valueReference.start) + `[${id}]` + masked.slice(valueReference.end);
    }
    // Redact remaining delimited values; keep surrounding prose for grouping.
    masked = masked.replace(/(["'])([^\r\n"']+)\1/gu, (whole, _quote: string, value: string) =>
      /^\[v\d+\]$/u.test(value) ? whole : '[redacted]');
    return { id: source.id, kind: 'message', text: masked };
  }
}
