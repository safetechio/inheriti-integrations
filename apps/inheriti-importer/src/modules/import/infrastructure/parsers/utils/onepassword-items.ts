import type { ImportDiagnostic } from '@modules/import/domain/import-diagnostic';
import {
  assertWithinStructureLimits,
  DEFAULT_IMPORT_LIMITS,
} from '@modules/import/domain/import-guards';
import { VaultFormatError, type VaultEntry } from '@modules/import/domain/vault';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const string = (value: unknown): string => (typeof value === 'string' ? value : '');

const ITEM_METADATA = [
  'categoryUuid',
  'createdAt',
  'updatedAt',
  'state',
  'trashed',
  'favorite',
  'favIndex',
];
const ITEM_KEYS = ['uuid', 'overview', 'details', 'file', ...ITEM_METADATA];
const LOGIN_SETTINGS = ['type', 'fieldType', 'id'];
const SECTION_SETTINGS = [
  'id',
  'indexAtSource',
  'inputTraits',
  'guarded',
  'multiline',
  'dontGenerate',
  'placeholder',
];
const OVERVIEW_KEYS = ['title', 'url', 'urls', 'tags'];
const DETAIL_KEYS = [
  'notesPlain',
  'loginFields',
  'sections',
  'passwordHistory',
  'documentAttributes',
];
const UNSUPPORTED_KEYS = new Set([
  'binary',
  'file',
  'files',
  'attachment',
  'attachments',
  'documentAttributes',
  'passkey',
  'passkeys',
]);
const READABLE_VALUE_TYPES = new Set([
  'string',
  'concealed',
  'creditCardNumber',
  'creditCardType',
  'date',
  'email',
  'gender',
  'menu',
  'monthYear',
  'otp',
  'phone',
  'reference',
  'url',
  'address',
  'sshKey',
]);

class OnePasswordItemMapper {
  private readonly extraFields: VaultEntry['extraFields'] = [];
  private readonly keys = new Set<string>();
  private title = 'Untitled';

  constructor(
    private readonly id: string,
    private readonly warnings: string[],
    private readonly diagnostics: ImportDiagnostic[],
  ) {}

  map(item: RecordValue, group: string): Omit<VaultEntry, 'sourceId'> {
    if (!record(item.overview)) throw new VaultFormatError('Invalid 1Password item.');
    const overview = item.overview;
    this.title = string(overview.title) || 'Untitled';
    const details = record(item.details) ? item.details : {};
    for (const [owner, key] of [
      [overview, 'urls'],
      [overview, 'tags'],
      [details, 'loginFields'],
      [details, 'sections'],
    ] as const) {
      if (owner[key] != null && !Array.isArray(owner[key])) {
        throw new VaultFormatError(`Invalid 1Password ${key}.`);
      }
    }
    const { username, password } = this.collectLoginFields(details);
    const url = this.collectUrls(overview);
    this.collectSections(details);
    if (
      details.passwordHistory != null &&
      (!Array.isArray(details.passwordHistory) || details.passwordHistory.length)
    ) {
      this.warnings.push(`Password history in item "${this.title}" was skipped.`);
      this.report(
        'onepassword-password-history',
        'skipped',
        'Password history was skipped.',
        ['details', 'passwordHistory'],
        list(details.passwordHistory).length || 1,
      );
    }
    this.collectUnknown(item, ITEM_KEYS, ['item']);
    const metadataCount = ITEM_METADATA.filter((key) => item[key] != null).length;
    if (metadataCount)
      this.report(
        'onepassword-item-metadata',
        'skipped',
        'Item categories, timestamps, and status metadata were omitted.',
        ['item'],
        metadataCount,
      );
    this.collectUnknown(overview, OVERVIEW_KEYS, ['overview']);
    for (const key of ['title', 'url'] as const) {
      if (overview[key] != null && typeof overview[key] !== 'string') {
        this.collectUnknown({ [key]: overview[key] }, [], ['overview']);
      }
    }
    const tags = list(overview.tags);
    if (tags.some((tag) => typeof tag !== 'string')) {
      this.collectUnknown({ tags }, [], ['overview']);
    } else if (tags.length) {
      this.addField('Source tags', JSON.stringify(tags));
    }
    this.collectUnknown(details, DETAIL_KEYS, ['details']);
    if (details.notesPlain != null && typeof details.notesPlain !== 'string') {
      this.collectUnknown({ notesPlain: details.notesPlain }, [], ['details']);
    }
    return {
      id: this.id,
      title: this.title,
      username,
      password,
      url,
      notes: string(details.notesPlain),
      group,
      tags: tags.filter((tag): tag is string => typeof tag === 'string'),
      extraFields: this.extraFields,
      category: string(item.categoryUuid),
      team: '',
    };
  }

  private addField(key: string, value: string): void {
    let unique = key;
    for (let suffix = 2; this.keys.has(unique); suffix++) unique = `${key} (${suffix})`;
    this.keys.add(unique);
    this.extraFields.push({ key: unique, value });
    if (this.extraFields.length + 5 > DEFAULT_IMPORT_LIMITS.maxFieldsPerEntry) {
      assertWithinStructureLimits({
        entryCount: 0,
        maxDepth: 0,
        maxFieldsPerEntry: this.extraFields.length + 5,
      });
    }
  }

  private collectLoginFields(details: RecordValue): { username: string; password: string } {
    let username = '';
    let password = '';
    for (const [index, field] of list(details.loginFields).entries()) {
      if (!record(field)) throw new VaultFormatError('Invalid 1Password login field.');
      const path = ['details', 'loginFields', String(index)];
      this.collectUnknown(field, ['value', 'name', 'designation', ...LOGIN_SETTINGS], path);
      if (LOGIN_SETTINGS.some((key) => field[key] != null)) {
        this.report(
          'onepassword-login-settings',
          'skipped',
          'Browser form settings were omitted.',
          path,
        );
      }
      const value = this.readFieldValue(field.value, path);
      if (value === undefined) {
        if (field.value != null) {
          this.warnSkippedField('login', string(field.name) || 'Login field');
        }
        continue;
      }
      if (!value) continue;
      if (field.designation === 'username' && !username) {
        username = value;
        continue;
      }
      if (field.designation === 'password' && !password) {
        password = value;
        continue;
      }
      this.addField(string(field.name) || 'Login field', value);
    }
    return { username, password };
  }

  private collectUrls(overview: RecordValue): string {
    let url = string(overview.url);
    for (const [index, candidate] of list(overview.urls).entries()) {
      const path = ['overview', 'urls', String(index)];
      if (!record(candidate) || !string(candidate.url)) {
        this.collectUnknown({ entry: candidate }, [], path);
        continue;
      }
      this.collectUnknown(candidate, ['url', 'label', 'mode'], path);
      if ([candidate.label, candidate.mode].some((value) => value != null && value !== ''))
        this.report(
          'onepassword-url-metadata',
          'skipped',
          'Website labels or matching settings were omitted from normalized website fields.',
          path,
        );
      if (!url) {
        url = string(candidate.url);
        continue;
      }
      if (url !== candidate.url)
        this.addField(`URL: ${string(candidate.label) || 'website'}`, string(candidate.url));
    }
    return url;
  }

  private collectSections(details: RecordValue): void {
    for (const [sectionIndex, section] of list(details.sections).entries()) {
      if (!record(section)) throw new VaultFormatError('Invalid 1Password section.');
      if (section.fields != null && !Array.isArray(section.fields)) {
        throw new VaultFormatError('Invalid 1Password section fields.');
      }
      const sectionName = string(section.title) || string(section.name) || 'Details';
      const sectionPath = ['details', 'sections', String(sectionIndex)];
      this.collectUnknown(section, ['title', 'name', 'fields'], sectionPath);
      for (const [index, field] of list(section.fields).entries()) {
        if (!record(field)) throw new VaultFormatError('Invalid 1Password section field.');
        const path = [...sectionPath, 'fields', String(index)];
        this.collectUnknown(field, ['title', 'value', ...SECTION_SETTINGS], path);
        if (SECTION_SETTINGS.some((key) => field[key] != null)) {
          this.report(
            'onepassword-field-settings',
            'skipped',
            'Field presentation settings were omitted.',
            path,
          );
        }
        const value = this.readFieldValue(field.value, path);
        if (value === undefined) {
          if (field.value != null) {
            this.warnSkippedField(sectionName, string(field.title) || 'Field');
          }
          continue;
        }
        if (!value) continue;
        const title = string(field.title) || 'Field';
        const sourceType =
          record(field.value) && 'creditCardNumber' in field.value ? 'creditCardNumber' : undefined;
        this.addField(
          sourceType && !this.keys.has(sourceType) ? sourceType : `${sectionName}: ${title}`,
          value,
        );
      }
    }
  }

  private warnSkippedField(section: string, field: string): void {
    this.warnings.push(`Item "${this.title}", ${section} field "${field}" was skipped.`);
  }

  private report(
    code: string,
    kind: ImportDiagnostic['kind'],
    message: string,
    sourcePath: string[],
    count = 1,
  ): void {
    this.diagnostics.push({ code, kind, message, count, entryId: this.id, sourcePath });
  }

  private collectUnknown(owner: RecordValue, consumed: string[], path: string[]): void {
    let preserved = 0;
    let skipped = 0;
    for (const [key, value] of Object.entries(owner)) {
      if (consumed.includes(key) || value == null || value === '') continue;
      if (UNSUPPORTED_KEYS.has(key)) {
        skipped++;
        continue;
      }
      const label = [...path, key]
        .map((segment) => segment.replace(/~/g, '~0').replace(/\//g, '~1'))
        .join('/');
      const text =
        typeof value === 'string'
          ? value
          : JSON.stringify(value, (name, item) => {
              if (!UNSUPPORTED_KEYS.has(name)) return item;
              skipped++;
              return undefined;
            });
      this.addField(label, text);
      preserved++;
    }
    if (preserved)
      this.report(
        'onepassword-extra-properties',
        'transformed',
        'Additional properties were preserved as protected text or JSON.',
        path,
        preserved,
      );
    if (skipped)
      this.report(
        'onepassword-unreadable-properties',
        'unsupported',
        'Properties containing unsupported content were skipped.',
        path,
        skipped,
      );
  }

  private containsUnsupportedValue(value: unknown): boolean {
    const pending = [value];
    while (pending.length) {
      const current = pending.pop();
      if (Array.isArray(current)) {
        for (const part of current) pending.push(part);
      } else if (record(current)) {
        for (const [key, part] of Object.entries(current)) {
          if (UNSUPPORTED_KEYS.has(key)) return true;
          pending.push(part);
        }
      }
    }
    return false;
  }

  private readFieldValue(value: unknown, path: string[]): string | undefined {
    if (value == null) return undefined;
    const structured = typeof value === 'object';
    const fieldPath = [...path, 'value'];
    if (structured && this.containsUnsupportedValue(value)) {
      this.report(
        'onepassword-unreadable-field',
        'unsupported',
        'A field with unsupported content was skipped.',
        fieldPath,
      );
      return undefined;
    }
    if (
      Array.isArray(value) ||
      (record(value) && Object.keys(value).some((key) => !READABLE_VALUE_TYPES.has(key)))
    ) {
      this.report(
        'onepassword-field-json',
        'transformed',
        'A structured field was preserved as JSON.',
        fieldPath,
      );
      return JSON.stringify(value);
    }
    const text = this.valueText(value);
    if (text === undefined) {
      this.report(
        'onepassword-unreadable-field',
        'unsupported',
        'An unreadable field was skipped.',
        fieldPath,
      );
    } else if (typeof value !== 'string') {
      this.report(
        'onepassword-field-text',
        'transformed',
        'A typed field was converted to text with source type and structure omitted.',
        fieldPath,
      );
    }
    return text;
  }

  /** Retains readable nested values while rejecting unsupported shapes. */
  private valueText(value: unknown): string | undefined {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      return String(value);
    if (Array.isArray(value)) {
      const parts = value.map((part) => this.valueText(part));
      return parts.every(Boolean) ? parts.join(', ') : undefined;
    }
    if (!record(value)) return undefined;
    const values = Object.entries(value)
      .filter(([, item]) => item != null)
      .map(([key, item]) => ({ key, text: this.valueText(item) }));
    if (values.some(({ text }) => text === undefined)) return undefined;
    if (values.length === 1) return values[0].text;
    return values.map(({ key, text }) => `${key}: ${text}`).join('\n') || undefined;
  }
}

export function mapItem(
  item: RecordValue,
  id: string,
  group: string,
  warnings: string[],
  diagnostics: ImportDiagnostic[],
): Omit<VaultEntry, 'sourceId'> {
  return new OnePasswordItemMapper(id, warnings, diagnostics).map(item, group);
}
