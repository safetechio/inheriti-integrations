import Papa from 'papaparse';
import { VaultFormatError, type ParseResult, type VaultEntry } from '@modules/import/domain/vault';

type LooseRecord = Record<string, unknown>;

export function parsePassbolt(data: ArrayBuffer, fileName = 'Passbolt export'): ParseResult {
  const text = new TextDecoder('utf-8').decode(data).replace(/^\uFEFF/, '');
  const lower = fileName.toLowerCase();

  const trimmed = text.trimStart();
  const looksLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[');

  if (lower.endsWith('.json') || (looksLikeJson && !lower.endsWith('.csv'))) {
    return parsePassboltJson(text, fileName);
  }

  if (lower.endsWith('.csv') || looksLikeCsv(text)) {
    return parsePassboltCsv(text, fileName);
  }

  return parsePassboltJson(text, fileName);
}

function parsePassboltJson(text: string, fileName: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new VaultFormatError('This Passbolt file is not valid JSON.');
  }

  const resources = extractResources(parsed);
  if (resources.length === 0) {
    throw new VaultFormatError(
      'No Passbolt resources were found. Export passwords as JSON or CSV from Passbolt, then import that file.',
    );
  }

  const entries = resources.map((resource, index) => mapPassboltResource(resource, index));
  const warnings: string[] = [];
  const missingSecrets = entries.filter((entry) => !entry.password).length;
  if (missingSecrets > 0) {
    warnings.push(
      `${missingSecrets} Passbolt ${missingSecrets === 1 ? 'entry has' : 'entries have'} no secret. The export may have omitted passwords.`,
    );
  }

  return {
    kind: 'passbolt',
    name: stripExtension(fileName),
    entries,
    warnings,
  };
}

function parsePassboltCsv(text: string, fileName: string): ParseResult {
  const result = Papa.parse<LooseRecord>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  });

  if (result.errors.length > 0 && (result.data?.length ?? 0) === 0) {
    throw new VaultFormatError('Could not parse this Passbolt CSV export.');
  }

  const rows = (result.data ?? []).filter((row) => hasAnyValue(row));
  if (rows.length === 0) {
    throw new VaultFormatError('The Passbolt CSV export does not contain any rows.');
  }

  const entries = rows.map((row, index) => mapPassboltResource(row, index));
  return {
    kind: 'passbolt',
    name: stripExtension(fileName),
    entries,
    warnings: result.errors.slice(0, 3).map((error) => error.message),
  };
}

function extractResources(parsed: unknown): LooseRecord[] {
  if (Array.isArray(parsed)) {
    return parsed.filter(isRecord);
  }

  if (!isRecord(parsed)) return [];

  const nestedKeys = ['resources', 'passwords', 'export', 'body', 'data'];
  for (const key of nestedKeys) {
    const value = parsed[key];
    if (Array.isArray(value)) return value.filter(isRecord);
    if (isRecord(value) && Array.isArray(value.resources)) {
      return value.resources.filter(isRecord);
    }
  }

  if (looksLikeResource(parsed)) return [parsed];
  return [];
}

function mapPassboltResource(resource: LooseRecord, index: number): Omit<VaultEntry, 'sourceId'> {
  const secretObject = isRecord(resource.secret) ? resource.secret : null;
  const password =
    pick(resource, ['secret', 'password', 'Secret', 'Password']) ||
    pick(secretObject ?? {}, ['password', 'secret']);

  const folder =
    pick(resource, ['folder', 'Folder', 'folder_parent', 'group', 'Group']) || folderPath(resource);

  const tags = collectTags(resource);

  return {
    id: String(resource.id ?? resource.uuid ?? `passbolt-${index + 1}`),
    title: pick(resource, ['name', 'Name', 'title', 'Title']) || `Untitled ${index + 1}`,
    username: pick(resource, ['username', 'Username', 'user', 'User']),
    password,
    url: pick(resource, ['uri', 'URI', 'url', 'URL']),
    notes: pick(resource, ['description', 'Description', 'notes', 'Notes']),
    group: folder,
    tags,
    extraFields: extraFieldsFrom(resource).concat(secretExtraFields(secretObject)),
    category: '',
    team: '',
  };
}

function secretExtraFields(secret: LooseRecord | null): VaultEntry['extraFields'] {
  if (!secret) return [];
  return Object.entries(secret).flatMap(([key, value]) => {
    if (['password', 'secret'].includes(key.toLowerCase())) return [];
    if (typeof value !== 'string' && typeof value !== 'number') return [];
    const text = String(value).trim();
    return text ? [{ key: `secret.${key}`, value: text }] : [];
  });
}

function extraFieldsFrom(resource: LooseRecord): VaultEntry['extraFields'] {
  const skip = new Set([
    'id',
    'uuid',
    'name',
    'Name',
    'title',
    'Title',
    'username',
    'Username',
    'user',
    'User',
    'secret',
    'Secret',
    'password',
    'Password',
    'uri',
    'URI',
    'url',
    'URL',
    'description',
    'Description',
    'notes',
    'Notes',
    'folder',
    'Folder',
    'folder_parent',
    'folder_parent_id',
    'group',
    'Group',
    'tags',
    'Tags',
    'deleted',
    'created',
    'modified',
    'created_by',
    'modified_by',
    'resource_type_id',
    'personal',
  ]);

  const fields: VaultEntry['extraFields'] = [];
  for (const [key, value] of Object.entries(resource)) {
    if (skip.has(key) || value == null || typeof value === 'object') continue;
    const text = String(value).trim();
    if (text) fields.push({ key, value: text });
  }
  return fields;
}

function collectTags(resource: LooseRecord): string[] {
  const raw = resource.tags ?? resource.Tags;
  if (Array.isArray(raw)) {
    return raw.map((tag) => String(tag).trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw
      .split(/[;,]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
}

function folderPath(resource: LooseRecord): string {
  const parent = resource.folder_parent;
  if (typeof parent === 'string') return parent;
  if (isRecord(parent) && typeof parent.name === 'string') return parent.name;
  return '';
}

function pick(record: LooseRecord, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
}

function looksLikeResource(record: LooseRecord): boolean {
  return Boolean(
    record.name ||
    record.Name ||
    record.title ||
    record.username ||
    record.secret ||
    record.password,
  );
}

function looksLikeCsv(text: string): boolean {
  const header = text.split(/\r?\n/, 1)[0]?.toLowerCase() ?? '';
  return header.includes(',') && (header.includes('name') || header.includes('secret'));
}

function isRecord(value: unknown): value is LooseRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasAnyValue(row: LooseRecord): boolean {
  return Object.values(row).some((value) => String(value ?? '').trim().length > 0);
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}
