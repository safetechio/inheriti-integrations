import { VaultFormatError, type VaultEntry } from '@modules/import/domain/vault';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const string = (value: unknown): string => (typeof value === 'string' ? value : '');

class OnePasswordItemMapper {
  private readonly extraFields: VaultEntry['extraFields'] = [];
  private readonly keys = new Set<string>();
  private title = 'Untitled';

  constructor(private readonly warnings: string[]) {}

  map(item: RecordValue, id: string, group: string): Omit<VaultEntry, 'sourceId'> {
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
    if (list(details.passwordHistory).length) {
      this.warnings.push(`Password history in item "${this.title}" was skipped.`);
    }
    return {
      id,
      title: this.title,
      username,
      password,
      url,
      notes: string(details.notesPlain),
      group,
      tags: list(overview.tags).filter((tag): tag is string => typeof tag === 'string'),
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
  }

  private collectLoginFields(details: RecordValue): { username: string; password: string } {
    let username = '';
    let password = '';
    for (const field of list(details.loginFields)) {
      if (!record(field)) throw new VaultFormatError('Invalid 1Password login field.');
      const value = this.valueText(field.value);
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
    for (const candidate of list(overview.urls)) {
      if (!record(candidate) || !string(candidate.url)) continue;
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
    for (const section of list(details.sections)) {
      if (!record(section)) throw new VaultFormatError('Invalid 1Password section.');
      if (section.fields != null && !Array.isArray(section.fields)) {
        throw new VaultFormatError('Invalid 1Password section fields.');
      }
      const sectionName = string(section.title) || string(section.name) || 'Details';
      for (const field of list(section.fields)) {
        if (!record(field)) throw new VaultFormatError('Invalid 1Password section field.');
        const value = this.valueText(field.value);
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
): Omit<VaultEntry, 'sourceId'> {
  return new OnePasswordItemMapper(warnings).map(item, id, group);
}

export function isFileOnly(item: RecordValue): boolean {
  const details = record(item.details) ? item.details : {};
  const hasFile = item.file != null || details.documentAttributes != null;
  return (
    hasFile &&
    !list(details.loginFields).length &&
    !list(details.sections).length &&
    !string(details.notesPlain)
  );
}
