import type { ExtraField, SourceFieldMetadata, VaultEntry } from '@modules/import/domain/vault';

const USERNAME_KEYS = new Set(['username', 'user', 'login', 'user_name', 'userid', 'user_id']);

const PASSWORD_KEYS = new Set(['password', 'passwd', 'pass']);

const URL_KEYS = new Set(['url', 'uri', 'host', 'hostname', 'endpoint', 'website', 'registry']);

const NOTES_KEYS = new Set(['notes', 'note', 'description', 'comment', 'desc']);

export type LooseRecord = Record<string, unknown>;

export function decodeText(data: ArrayBuffer): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(data).replace(/^\uFEFF/, '');
}

export function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '') || fileName;
}

export function isRecord(value: unknown): value is LooseRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function asString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

export function decodeBase64(value: string): { text: string; binary: boolean } {
  try {
    const normalized = value.replace(/\s/g, '');
    if (!normalized) return { text: '', binary: false };
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const control = bytes.filter((byte) => byte < 9 || (byte > 13 && byte < 32)).length;
    const looksBinary = bytes.includes(0) || control / Math.max(bytes.length, 1) > 0.2;
    return looksBinary ? { text: value, binary: true } : { text, binary: false };
  } catch {
    return { text: value, binary: true };
  }
}

export function tryParseJson(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

export function flattenStringMap(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const result: Record<string, string> = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    if (item == null) continue;
    const text = typeof item === 'object' ? JSON.stringify(item) : asString(item);
    if (!text) continue;
    if (text) result[key] = text;
  }
  return Object.keys(result).length > 0 ? result : null;
}

export function structuredFieldMetadata(source: unknown): Map<string, SourceFieldMetadata> {
  const metadata = new Map<string, SourceFieldMetadata>();
  if (isRecord(source)) {
    for (const [key, value] of Object.entries(source)) {
      if (value != null && typeof value === 'object') {
        metadata.set(key, { sourceFieldType: 'json', sourceKey: key });
      }
    }
  }
  return metadata;
}

export function entryFromSecrets(
  secrets: Record<string, string>,
  meta: {
    id?: string;
    title: string;
    group?: string;
    tags?: string[];
    notes?: string;
    sourceHints?: VaultEntry['sourceHints'];
    extraFieldMetadata?: ReadonlyMap<string, SourceFieldMetadata>;
  },
): Omit<VaultEntry, 'sourceId'> {
  const extraFields: ExtraField[] = [];
  let username = '';
  let password = '';
  let url = '';
  let notes = meta.notes ?? '';
  const used = new Set<string>();

  const take = (keys: Set<string>, already: string): { value: string; key?: string } => {
    if (already) return { value: already };
    for (const [key, value] of Object.entries(secrets)) {
      const metadata = meta.extraFieldMetadata?.get(key);
      if (
        keys.has(normalizeKey(key)) &&
        value &&
        metadata?.sourceAutoMapping !== 'manual-only' &&
        metadata?.sourceFieldType !== 'json'
      ) {
        return { value, key };
      }
    }
    return { value: '' };
  };

  const userHit = take(USERNAME_KEYS, '');
  username = userHit.value;
  if (userHit.key) used.add(userHit.key);

  const passHit = take(PASSWORD_KEYS, '');
  password = passHit.value;
  if (passHit.key) used.add(passHit.key);

  const urlHit = take(URL_KEYS, '');
  url = urlHit.value;
  if (urlHit.key) used.add(urlHit.key);

  const notesHit = take(NOTES_KEYS, notes);
  if (!notes) {
    notes = notesHit.value;
    if (notesHit.key) used.add(notesHit.key);
  }

  for (const [key, value] of Object.entries(secrets)) {
    if (used.has(key) || !value) continue;
    const metadata = meta.extraFieldMetadata?.get(key);
    extraFields.push({ key, value, ...(metadata ? { metadata } : {}) });
  }

  return {
    id: meta.id ?? crypto.randomUUID(),
    title: meta.title,
    username,
    password,
    url,
    notes,
    group: meta.group ?? '',
    tags: meta.tags ?? [],
    extraFields,
    sourceHints: meta.sourceHints,
    fieldMetadata: {
      ...(userHit.key ? { username: { sourceKey: userHit.key } } : {}),
      ...(passHit.key ? { password: { sourceKey: passHit.key } } : {}),
      ...(urlHit.key ? { url: { sourceKey: urlHit.key } } : {}),
      ...(notesHit.key ? { notes: { sourceKey: notesHit.key } } : {}),
    },
    category: '',
    team: '',
  };
}

function normalizeKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}
