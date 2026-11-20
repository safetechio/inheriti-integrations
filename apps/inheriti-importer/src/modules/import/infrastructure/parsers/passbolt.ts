import { asString, isRecord, type LooseRecord } from './utils/secret-fields';
import type { ImportDiagnostic } from '@modules/import/domain/import-diagnostic';
import Papa from 'papaparse';
import { VaultFormatError, type ParseResult, type VaultEntry } from '@modules/import/domain/vault';

const METADATA_FIELDS = new Set([
  'id',
  'uuid',
  'folder_parent_id',
  'deleted',
  'created',
  'modified',
  'created_by',
  'modified_by',
  'resource_type_id',
  'personal',
]);

function valueText(value: unknown): string {
  return value != null && typeof value === 'object' ? JSON.stringify(value) : asString(value);
}

export function parsePassbolt(data: ArrayBuffer, fileName = 'Passbolt export'): ParseResult {
  return new PassboltParser(data, fileName).parse();
}

class PassboltParser {
  private readonly text: string;
  private readonly diagnostics: ImportDiagnostic[] = [];

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

    const candidates = this.extractResources(parsed);
    const resources = candidates.filter(
      (value): value is LooseRecord => isRecord(value) && this.looksLikeResource(value),
    );
    const skipped = candidates.length - resources.length;
    if (skipped)
      this.diagnostics.push({
        code: 'passbolt-unrecognized-rows',
        kind: 'skipped',
        message: 'Unrecognized Passbolt resource records were skipped.',
        count: skipped,
      });
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
      diagnostics: this.diagnostics,
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
      skipEmptyLines: true,
      transformHeader: (header) => header.trim(),
    });

    const headers = new Set((result.meta.fields ?? []).map((header) => header.toLowerCase()));
    if (
      !headers.has('name') ||
      !['username', 'password', 'secret', 'uri'].some((header) => headers.has(header))
    ) {
      throw new VaultFormatError(
        'Unsupported CSV headers. Import a Passbolt CSV export with Name and credential columns, or a 1Password CSV export.',
      );
    }

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
      diagnostics: this.diagnostics,
    };
  }

  private extractResources(parsed: unknown): unknown[] {
    // Passbolt exports use several envelope shapes across versions.
    if (Array.isArray(parsed)) {
      return parsed;
    }

    if (!isRecord(parsed)) return [];

    const nestedKeys = ['resources', 'passwords', 'export', 'body', 'data'];
    for (const key of nestedKeys) {
      const value = parsed[key];
      if (Array.isArray(value)) return value;
      if (isRecord(value) && Array.isArray(value.resources)) {
        return value.resources;
      }
    }

    if (this.looksLikeResource(parsed)) return [parsed];
    return [];
  }

  private mapPassboltResource(resource: LooseRecord, index: number): Omit<VaultEntry, 'sourceId'> {
    const used = new Set<string>();
    const usedSecret = new Set<string>();
    const pick = (keys: string[]) => this.pick(resource, keys, used);
    const outerPassword = pick(['secret', 'password', 'Secret', 'Password']);
    const secretObject = isRecord(resource.secret) ? resource.secret : null;
    const password =
      outerPassword ||
      (secretObject ? this.pick(secretObject, ['password', 'secret'], usedSecret) : '');
    if (secretObject) used.add('secret');
    const folder =
      pick(['folder', 'Folder', 'folder_parent', 'group', 'Group']) || this.folderPath(resource);
    const tags = this.collectTags(resource);
    const id = asString(resource.id) || asString(resource.uuid) || `passbolt-${index + 1}`;
    const title = pick(['name', 'Name', 'title', 'Title']) || `Untitled ${index + 1}`;
    const username = pick(['username', 'Username', 'user', 'User']);
    const url = pick(['uri', 'URI', 'url', 'URL']);
    const notes = pick(['description', 'Description', 'notes', 'Notes']);
    const extraFields: VaultEntry['extraFields'] = [];
    let transformed =
      [...used].filter((key) => key !== 'secret' && typeof resource[key] !== 'string').length +
      [...usedSecret].filter((key) => typeof secretObject?.[key] !== 'string').length;
    const metadataCount = Object.keys(resource).filter(
      (key) => METADATA_FIELDS.has(key) && key !== 'id' && key !== 'uuid',
    ).length;
    if (metadataCount)
      this.diagnostics.push({
        code: 'passbolt-resource-metadata',
        kind: 'skipped',
        message: 'Passbolt administrative metadata was omitted.',
        count: metadataCount,
        entryId: id,
      });
    for (const key of METADATA_FIELDS) used.add(key);
    for (const [record, consumed, prefix] of [
      [resource, used, ''],
      [secretObject ?? {}, usedSecret, 'secret.'],
    ] as const) {
      for (const [key, value] of Object.entries(record)) {
        if (consumed.has(key)) continue;
        // A zero-length value has no content. A whitespace-only value still does.
        const text = valueText(value);
        if (!text) continue;
        if (typeof value !== 'string') transformed++;
        extraFields.push({ key: prefix + key, value: text });
      }
    }
    if (transformed)
      this.diagnostics.push({
        code: 'passbolt-value-text',
        kind: 'transformed',
        message: 'Passbolt non-text fields were preserved as text or JSON.',
        count: transformed,
        entryId: id,
      });

    return {
      id,
      title,
      username,
      password,
      url,
      notes,
      group: folder,
      tags,
      extraFields,
      category: '',
      team: '',
    };
  }

  private collectTags(resource: LooseRecord): string[] {
    const raw = resource.tags ?? resource.Tags;
    if (Array.isArray(raw)) {
      return raw.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0);
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
    if (isRecord(parent) && typeof parent.name === 'string') return parent.name;
    return '';
  }

  private pick(record: LooseRecord, keys: string[], used: Set<string>): string {
    for (const key of keys) {
      const value = asString(record[key]);
      if (value) {
        used.add(key);
        return value;
      }
    }
    return '';
  }

  private looksLikeResource(record: LooseRecord): boolean {
    return (
      ['name', 'Name', 'title', 'Title'].some((key) => typeof record[key] === 'string') &&
      [
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
      ].some((key) => Object.hasOwn(record, key))
    );
  }

  private looksLikeCsv(text: string): boolean {
    const header = text.split(/\r?\n/, 1)[0]?.toLowerCase() ?? '';
    return header.includes(',') && (header.includes('name') || header.includes('secret'));
  }

  private hasAnyValue(row: LooseRecord): boolean {
    return Object.values(row).some((value) => valueText(value).length > 0);
  }

  private stripExtension(fileName: string): string {
    return fileName.replace(/\.[^.]+$/, '');
  }
}
