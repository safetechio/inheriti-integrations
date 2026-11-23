import type { ImportDiagnostic } from '@modules/import/domain/import-diagnostic';
import {
  assertWithinStructureLimits,
  DEFAULT_IMPORT_LIMITS,
} from '@modules/import/domain/import-guards';
import {
  VaultFormatError,
  type SourceFieldMetadata,
  type VaultEntry,
} from '@modules/import/domain/vault';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const string = (value: unknown): string => (typeof value === 'string' ? value : '');

const ITEM_METADATA = ['createdAt', 'updatedAt', 'state', 'trashed', 'favorite', 'favIndex'];
const ITEM_KEYS = ['uuid', 'categoryUuid', 'overview', 'details', 'file', ...ITEM_METADATA];
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

type UnsupportedContent = 'binary' | 'attachment' | 'passkey';

function unsupportedContent(key: string, value: unknown): UnsupportedContent | undefined {
  if (key === 'binary' || (record(value) && value.type === 'Buffer' && Array.isArray(value.data)))
    return 'binary';
  if (['file', 'files', 'attachment', 'attachments', 'documentAttributes'].includes(key)) {
    if (typeof value === 'string' && /^data:[^,]*;base64,/i.test(value)) return 'attachment';
    if (record(value)) {
      const attrs = record(value.attrs) ? value.attrs : value;
      if (
        'documentId' in attrs ||
        'attachmentId' in attrs ||
        (('fileName' in attrs || 'filename' in attrs) &&
          ('size' in attrs || 'decryptedSize' in attrs || 'id' in attrs))
      )
        return 'attachment';
    }
  }
  if (['passkey', 'passkeys'].includes(key) && record(value)) {
    if (
      'credentialId' in value ||
      'credentialID' in value ||
      'privateKey' in value ||
      'relyingPartyId' in value
    )
      return 'passkey';
  }
  return undefined;
}

class RecoveryBudgetExceeded extends Error {}

function readableContent(
  value: unknown,
  key: string,
  excluded: Map<UnsupportedContent, number>,
  budget: { remaining: number },
  depth = 0,
): unknown {
  if (--budget.remaining < 0) throw new RecoveryBudgetExceeded();
  if (depth > DEFAULT_IMPORT_LIMITS.maxGroupDepth) {
    assertWithinStructureLimits({ entryCount: 0, maxDepth: depth, maxFieldsPerEntry: 0 });
  }
  const unsupported = value == null ? undefined : unsupportedContent(key, value);
  if (unsupported) {
    excluded.set(unsupported, (excluded.get(unsupported) ?? 0) + 1);
    return undefined;
  }
  if (Array.isArray(value)) {
    if (value.length > budget.remaining) throw new RecoveryBudgetExceeded();
    const parts = value.map((part) => readableContent(part, key, excluded, budget, depth + 1));
    return parts.some((part) => part !== undefined) || !value.length ? parts : undefined;
  }
  if (!record(value)) return value;
  const parts: Record<string, unknown> = {};
  let hadChildren = false;
  let retained = false;
  for (const name in value) {
    if (!Object.hasOwn(value, name)) continue;
    hadChildren = true;
    const part = readableContent(value[name], name, excluded, budget, depth + 1);
    if (part !== undefined) {
      Object.defineProperty(parts, name, { value: part, enumerable: true, configurable: true });
      retained = true;
    }
  }
  return retained || !hadChildren ? parts : undefined;
}

function scalarText(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return undefined;
}

type ReadableField = { value: string; sourceFieldType?: string };

class OnePasswordItemMapper {
  private readonly extraFields: VaultEntry['extraFields'] = [];
  private readonly fieldMetadata: NonNullable<VaultEntry['fieldMetadata']> = {};
  private readonly keys = new Set<string>();
  private readonly recoveryBudget = { remaining: 2048 };
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
    const historyPath = ['details', 'passwordHistory'];
    const history = this.readContent(details.passwordHistory, 'passwordHistory', historyPath);
    if (hasReadableContent(history)) {
      this.addField('Password history', scalarText(history) ?? JSON.stringify(history), {
        sourceKey: 'passwordHistory',
        sourceAutoMapping: 'manual-only',
        ...(typeof history === 'object' ? { sourceFieldType: 'json' } : {}),
      });
      this.report(
        'onepassword-password-history',
        'transformed',
        'Password history was preserved for manual review.',
        historyPath,
        list(details.passwordHistory).length || 1,
      );
    }
    this.collectUnknown(item, ITEM_KEYS, ['item']);
    const metadataCount = ITEM_METADATA.filter((key) => item[key] != null).length;
    if (metadataCount)
      this.report(
        'onepassword-item-metadata',
        'skipped',
        'Item timestamps and status metadata were omitted.',
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
      this.addField('Source tags', JSON.stringify(tags), {
        sourceKey: 'tags',
        sourceFieldType: 'json',
        sourceAutoMapping: 'manual-only',
      });
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
      sourceHints: {
        sourceKind: 'onepassword',
        ...(string(item.categoryUuid) ? { category: string(item.categoryUuid) } : {}),
      },
      fieldMetadata: {
        ...this.fieldMetadata,
        ...(string(details.notesPlain)
          ? { notes: { sourceKey: 'notesPlain', sourceRole: 'notes' } }
          : {}),
      },
      team: '',
    };
  }

  private addField(key: string, value: string, metadata?: SourceFieldMetadata): void {
    let unique = key;
    for (let suffix = 2; this.keys.has(unique); suffix++) unique = `${key} (${suffix})`;
    this.keys.add(unique);
    this.extraFields.push({ key: unique, value, ...(metadata ? { metadata } : {}) });
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
      const readable = this.readFieldValue(field.value, path);
      if (!readable) {
        if (field.value != null) {
          this.warnSkippedField('login', string(field.name) || 'Login field');
        }
        continue;
      }
      const { value, sourceFieldType } = readable;
      if (!value) continue;
      const designation = string(field.designation);
      const name = string(field.name) || string(field.id) || designation || 'Login field';
      const metadata: SourceFieldMetadata = {
        sourceKey: name,
        sourceFieldType:
          sourceFieldType ||
          [field.fieldType, field.type].map(string).find((type) => type && type !== 'json') ||
          'string',
        ...(designation ? { sourceDesignation: designation } : {}),
        ...(designation === 'username' || designation === 'password'
          ? { sourceRole: designation }
          : {}),
      };
      if (designation === 'username' && !username && sourceFieldType !== 'json') {
        username = value;
        this.fieldMetadata.username = metadata;
        continue;
      }
      if (designation === 'password' && !password && sourceFieldType !== 'json') {
        password = value;
        this.fieldMetadata.password = metadata;
        continue;
      }
      this.addField(name, value, metadata);
    }
    return { username, password };
  }

  private collectUrls(overview: RecordValue): string {
    let url = string(overview.url);
    if (url)
      this.fieldMetadata.url = { sourceKey: 'url', sourceRole: 'url', sourceFieldType: 'url' };
    const primaryLabels = new Set<string>();
    for (const [index, candidate] of list(overview.urls).entries()) {
      const path = ['overview', 'urls', String(index)];
      if (!record(candidate) || !string(candidate.url)) {
        this.collectUnknown({ entry: candidate }, [], path);
        continue;
      }
      this.collectUnknown(
        candidate,
        ['url', 'mode', ...(typeof candidate.label === 'string' ? ['label'] : [])],
        path,
      );
      if (candidate.mode != null && candidate.mode !== '')
        this.report(
          'onepassword-url-metadata',
          'skipped',
          'Website matching settings were omitted.',
          path,
        );
      if (!url) {
        url = string(candidate.url);
        this.fieldMetadata.url = { sourceKey: 'urls', sourceRole: 'url', sourceFieldType: 'url' };
      }
      const label = string(candidate.label);
      if (url !== candidate.url) {
        this.addField(`URL: ${label || 'website'}`, string(candidate.url), {
          sourceKey: 'urls',
          sourceFieldType: 'url',
        });
      } else if (label && !primaryLabels.has(label)) {
        primaryLabels.add(label);
        this.addField('Primary URL label', label, {
          sourceKey: 'label',
          sourceAutoMapping: 'manual-only',
        });
      }
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
        const readable = this.readFieldValue(field.value, path);
        if (!readable) {
          if (field.value != null) {
            this.warnSkippedField(sectionName, string(field.title) || 'Field');
          }
          continue;
        }
        const { value, sourceFieldType } = readable;
        if (!value) continue;
        const title = string(field.title) || 'Field';
        this.addField(
          sourceFieldType === 'creditCardNumber' && !this.keys.has(sourceFieldType)
            ? sourceFieldType
            : `${sectionName}: ${title}`,
          value,
          {
            sourceKey: string(field.id) || title,
            sourceSection: sectionName,
            sourceSectionIdentity: String(sectionIndex),
            sourceFieldType: sourceFieldType || 'string',
          },
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
    let partial = 0;
    const excluded = new Map<UnsupportedContent, number>();
    for (const [key, raw] of Object.entries(owner)) {
      if (consumed.includes(key) || raw == null || raw === '') continue;
      const omitted = new Map<UnsupportedContent, number>();
      const value = this.recoverContent(raw, key, omitted, [...path, key]);
      for (const [type, count] of omitted) {
        excluded.set(type, (excluded.get(type) ?? 0) + count);
      }
      if (value === undefined) continue;
      if (omitted.size) {
        if (!hasReadableContent(value)) continue;
        partial++;
      }
      const label = [...path, key]
        .map((segment) => segment.replace(/~/g, '~0').replace(/\//g, '~1'))
        .join('/');
      this.addField(label, scalarText(value) ?? JSON.stringify(value), {
        sourceKey: key,
        sourcePath: JSON.stringify([...path, key]),
        sourceRecordPath: JSON.stringify(path),
        ...(typeof value === 'object' ? { sourceFieldType: 'json' } : {}),
      });
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
    this.reportRecovery('onepassword-unreadable-properties', excluded, partial, path);
  }

  private reportRecovery(
    code: string,
    excluded: Map<UnsupportedContent, number>,
    partial: number,
    path: string[],
  ): void {
    for (const [type, count] of excluded) {
      this.report(code, 'unsupported', `Unsupported ${type} content was omitted.`, path, count);
    }
    if (partial) {
      this.report(
        'onepassword-partial-recovery',
        'transformed',
        'Readable parts were preserved separately from unsupported content.',
        path,
        partial,
      );
    }
  }

  private recoverContent(
    value: unknown,
    key: string,
    excluded: Map<UnsupportedContent, number>,
    path: string[],
  ): unknown {
    try {
      let scalar = value === null || typeof value !== 'object';
      if (record(value)) {
        let count = 0;
        let wrapper = '';
        for (const name in value) {
          if (!Object.hasOwn(value, name)) continue;
          wrapper = name;
          if (++count > 1) break;
        }
        scalar =
          count === 1 &&
          READABLE_VALUE_TYPES.has(wrapper) &&
          (value[wrapper] === null || typeof value[wrapper] !== 'object');
      }
      return readableContent(value, key, excluded, scalar ? { remaining: 2 } : this.recoveryBudget);
    } catch (error) {
      if (!(error instanceof RecoveryBudgetExceeded)) throw error;
      this.report(
        'onepassword-recovery-limit',
        'unsupported',
        'A field exceeded the bounded recovery limit and was not imported. Keep the source file to recover it manually.',
        path,
      );
      return undefined;
    }
  }

  private readContent(value: unknown, key: string, path: string[]): unknown {
    const excluded = new Map<UnsupportedContent, number>();
    const recovered = this.recoverContent(value, key, excluded, path);
    if (!excluded.size) return recovered;
    const readable = hasReadableContent(recovered);
    this.reportRecovery('onepassword-unreadable-field', excluded, readable ? 1 : 0, path);
    return readable ? recovered : undefined;
  }

  private readFieldValue(raw: unknown, path: string[]): ReadableField | undefined {
    if (raw == null) return undefined;
    const fieldPath = [...path, 'value'];
    const value = this.readContent(raw, '', fieldPath);
    if (value === undefined) return undefined;
    const keys = record(value) ? Object.keys(value) : [];
    const key = keys[0];
    const wrappedType =
      record(raw) &&
      Object.keys(raw).length === 1 &&
      keys.length === 1 &&
      READABLE_VALUE_TYPES.has(key)
        ? key
        : undefined;
    const text = scalarText(wrappedType && record(value) ? value[wrappedType] : value);
    if (text !== undefined) {
      if (typeof raw !== 'string')
        this.report(
          'onepassword-field-text',
          'transformed',
          'A typed field was converted to text.',
          fieldPath,
        );
      return {
        value: text,
        sourceFieldType: wrappedType ?? (typeof raw === 'string' ? undefined : typeof raw),
      };
    }
    if (!hasReadableContent(value)) {
      this.report(
        'onepassword-unreadable-field',
        'unsupported',
        'An unreadable field was skipped.',
        fieldPath,
      );
      return undefined;
    }
    this.report(
      'onepassword-field-json',
      'transformed',
      'A structured field was preserved as JSON.',
      fieldPath,
    );
    return { value: JSON.stringify(value), sourceFieldType: 'json' };
  }
}

function hasReadableContent(value: unknown): boolean {
  const pending = [value];
  while (pending.length) {
    const part = pending.pop();
    if (Array.isArray(part)) {
      for (const child of part) pending.push(child);
    } else if (record(part)) {
      for (const child of Object.values(part)) pending.push(child);
    } else if (part != null && part !== '') {
      return true;
    }
  }
  return false;
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
