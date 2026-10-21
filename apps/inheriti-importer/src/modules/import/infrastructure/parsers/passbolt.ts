import Papa from 'papaparse';
import { VaultFormatError, type ParseResult, type VaultEntry } from '@modules/import/domain/vault';

type LooseRecord = Record<string, unknown>;

const RESOURCE_FIELDS = new Set([
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

export function parsePassbolt(data: ArrayBuffer, fileName = 'Passbolt export'): ParseResult {
  return new PassboltParser(data, fileName).parse();
}

class PassboltParser {
  private readonly text: string;

  constructor(
    data: ArrayBuffer,
    private readonly fileName: string,
  ) {
    this.text = new TextDecoder('utf-8').decode(data).replace(/^\uFEFF/, '');
  }

  parse(): ParseResult {
    const lower = this.fileName.toLowerCase();
    const trimmed = this.text.trimStart();
    const looksLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[');

    if (lower.endsWith('.json') || (looksLikeJson && !lower.endsWith('.csv'))) {
      return this.parseJson();
    }
    if (lower.endsWith('.csv') || this.looksLikeCsv(this.text)) {
      return this.parseCsv();
    }
    return this.parseJson();
  }

  private parseJson(): ParseResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.text);
    } catch {
      throw new VaultFormatError('This Passbolt file is not valid JSON.');
    }

    const resources = this.extractResources(parsed);
    if (resources.length === 0) {
      throw new VaultFormatError(
        'No Passbolt resources were found. Export passwords as JSON or CSV from Passbolt, then import that file.',
      );
    }

    const entries = resources.map((resource, index) => this.mapPassboltResource(resource, index));
    return {
      kind: 'passbolt',
      name: this.stripExtension(this.fileName),
      entries,
      warnings: this.missingSecretWarnings(entries),
    };
  }

  private missingSecretWarnings(entries: Omit<VaultEntry, 'sourceId'>[]): string[] {
    const count = entries.filter((entry) => !entry.password).length;
    if (count === 0) return [];
    return [
      `${count} Passbolt ${count === 1 ? 'entry has' : 'entries have'} no secret. The export may have omitted passwords.`,
    ];
  }

  private parseCsv(): ParseResult {
    const result = Papa.parse<LooseRecord>(this.text, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (header) => header.trim(),
    });

    if (result.errors.length > 0 && (result.data?.length ?? 0) === 0) {
      throw new VaultFormatError('Could not parse this Passbolt CSV export.');
    }

    const rows = (result.data ?? []).filter((row) => this.hasAnyValue(row));
    if (rows.length === 0) {
      throw new VaultFormatError('The Passbolt CSV export does not contain any rows.');
    }

    const entries = rows.map((row, index) => this.mapPassboltResource(row, index));
    return {
      kind: 'passbolt',
      name: this.stripExtension(this.fileName),
      entries,
      warnings: result.errors.slice(0, 3).map((error) => error.message),
    };
  }

  private extractResources(parsed: unknown): LooseRecord[] {
    // Passbolt exports use several envelope shapes across versions.
    if (Array.isArray(parsed)) {
      return parsed.filter((value) => this.isRecord(value));
    }

    if (!this.isRecord(parsed)) return [];

    const nestedKeys = ['resources', 'passwords', 'export', 'body', 'data'];
    for (const key of nestedKeys) {
      const value = parsed[key];
      if (Array.isArray(value)) return value.filter((value) => this.isRecord(value));
      if (this.isRecord(value) && Array.isArray(value.resources)) {
        return value.resources.filter((value) => this.isRecord(value));
      }
    }

    if (this.looksLikeResource(parsed)) return [parsed];
    return [];
  }

  private mapPassboltResource(resource: LooseRecord, index: number): Omit<VaultEntry, 'sourceId'> {
    const secretObject = this.isRecord(resource.secret) ? resource.secret : null;
    const password =
      this.pick(resource, ['secret', 'password', 'Secret', 'Password']) ||
      this.pick(secretObject ?? {}, ['password', 'secret']);

    const folder =
      this.pick(resource, ['folder', 'Folder', 'folder_parent', 'group', 'Group']) ||
      this.folderPath(resource);

    const tags = this.collectTags(resource);

    return {
      id: String(resource.id ?? resource.uuid ?? `passbolt-${index + 1}`),
      title: this.pick(resource, ['name', 'Name', 'title', 'Title']) || `Untitled ${index + 1}`,
      username: this.pick(resource, ['username', 'Username', 'user', 'User']),
      password,
      url: this.pick(resource, ['uri', 'URI', 'url', 'URL']),
      notes: this.pick(resource, ['description', 'Description', 'notes', 'Notes']),
      group: folder,
      tags,
      extraFields: this.extraFieldsFrom(resource).concat(this.secretExtraFields(secretObject)),
      category: '',
      team: '',
    };
  }

  private secretExtraFields(secret: LooseRecord | null): VaultEntry['extraFields'] {
    // Preserve text alongside the password in structured secret objects.
    if (!secret) return [];
    return Object.entries(secret).flatMap(([key, value]) => {
      if (['password', 'secret'].includes(key.toLowerCase())) return [];
      if (typeof value !== 'string' && typeof value !== 'number') return [];
      const text = String(value).trim();
      return text ? [{ key: `secret.${key}`, value: text }] : [];
    });
  }

  private extraFieldsFrom(resource: LooseRecord): VaultEntry['extraFields'] {
    const fields: VaultEntry['extraFields'] = [];
    for (const [key, value] of Object.entries(resource)) {
      if (RESOURCE_FIELDS.has(key) || value == null || typeof value === 'object') continue;
      const text = String(value).trim();
      if (text) fields.push({ key, value: text });
    }
    return fields;
  }

  private collectTags(resource: LooseRecord): string[] {
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

  private folderPath(resource: LooseRecord): string {
    const parent = resource.folder_parent;
    if (typeof parent === 'string') return parent;
    if (this.isRecord(parent) && typeof parent.name === 'string') return parent.name;
    return '';
  }

  private pick(record: LooseRecord, keys: string[]): string {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number') return String(value);
    }
    return '';
  }

  private looksLikeResource(record: LooseRecord): boolean {
    return Boolean(
      record.name ||
      record.Name ||
      record.title ||
      record.username ||
      record.secret ||
      record.password,
    );
  }

  private looksLikeCsv(text: string): boolean {
    const header = text.split(/\r?\n/, 1)[0]?.toLowerCase() ?? '';
    return header.includes(',') && (header.includes('name') || header.includes('secret'));
  }

  private isRecord(value: unknown): value is LooseRecord {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  private hasAnyValue(row: LooseRecord): boolean {
    return Object.values(row).some((value) => String(value ?? '').trim().length > 0);
  }

  private stripExtension(fileName: string): string {
    return fileName.replace(/\.[^.]+$/, '');
  }
}
