/**
 * The plan service answers with its engine vocabulary, and the SDK widens anything outside its own
 * canon into `{ kind: 'UNKNOWN', raw }` rather than dropping it. An operator wants the word either
 * way, so every rendered value goes through here instead of each column re-deriving it.
 */
export type Displayable = string | { readonly kind: string; readonly raw?: string } | undefined;

export function label(value: Displayable, fallback = '—'): string {
  if (value === undefined) return fallback;
  if (typeof value === 'string') return value || fallback;
  if (value.kind === 'UNKNOWN') return value.raw ?? fallback;
  return value.kind || fallback;
}

export function labels(values: readonly Displayable[] | undefined, fallback = '—'): string {
  if (values === undefined || values.length === 0) return fallback;
  return values.map((value) => label(value)).join(', ');
}

/** Local time, seconds included: an operator is comparing these against a log, not reading prose. */
export function timestamp(value: string | undefined, fallback = '—'): string {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`
    + ` ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}`;
}

export function count(value: number | undefined): string {
  return value === undefined ? '—' : String(value);
}
