import * as kdbxweb from 'kdbxweb';
import { setupKdbxCrypto } from '@shared/infrastructure/crypto/crypto-engine';
import { VaultUnlockError, type ParseResult, type VaultEntry } from '@modules/import/domain/vault';

const KEEPASS_STANDARD_FIELDS = new Set(['Title', 'UserName', 'Password', 'URL', 'Notes', 'Tags']);

type KeepassOptions = { password?: string; keyFile?: ArrayBuffer; fileName?: string };

class KeepassParser {
  private readonly entries: Omit<VaultEntry, 'sourceId'>[] = [];
  private readonly warnings: string[] = [];

  constructor(
    private readonly data: ArrayBuffer,
    private readonly options: KeepassOptions,
  ) {}

  async parse(): Promise<ParseResult> {
    await setupKdbxCrypto();
    const db = await this.open();
    this.visit(db.getDefaultGroup(), [], db.meta.recycleBinUuid, db.getDefaultGroup());
    if (this.entries.length === 0) {
      this.warnings.push('The KeePass database opened, but it does not contain any entries.');
    }
    return {
      kind: 'keepass',
      name:
        (db.meta.name || '').trim() ||
        this.stripExtension(this.options.fileName ?? 'KeePass database'),
      entries: this.entries,
      warnings: this.warnings,
    };
  }

  private async open(): Promise<kdbxweb.Kdbx> {
    const { options } = this;
    const password =
      options.password && options.password.length > 0
        ? kdbxweb.ProtectedValue.fromString(options.password)
        : null;
    const credentials = new kdbxweb.Credentials(password, options.keyFile ?? null);

    try {
      return await kdbxweb.Kdbx.load(this.data.slice(0), credentials);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/invalid key|invalid credentials|hmac|hash|keyfile|password/i.test(message)) {
        throw new VaultUnlockError(
          'Could not open this KeePass database. Check the master password or key file.',
          { needsPassword: true, needsKeyFile: Boolean(options.keyFile) },
        );
      }
      throw new VaultUnlockError(
        'This KeePass database is protected. Enter the master password to unlock it.',
      );
    }
  }

  private visit(
    group: kdbxweb.KdbxGroup,
    path: string[],
    recycleBinUuid: kdbxweb.KdbxUuid | undefined,
    defaultGroup: kdbxweb.KdbxGroup,
  ): void {
    if (recycleBinUuid && group.uuid && group.uuid.equals(recycleBinUuid)) return;
    const isRoot = Boolean(defaultGroup?.uuid && group.uuid?.equals(defaultGroup.uuid));
    const groupName = String(group.name ?? '').trim();
    const nextPath = isRoot || !groupName ? path : [...path, groupName];
    for (const entry of group.entries ?? []) {
      this.entries.push(this.mapEntry(entry, nextPath.join(' / ')));
    }
    for (const child of group.groups ?? []) {
      this.visit(child, nextPath, recycleBinUuid, defaultGroup);
    }
  }
  private mapEntry(entry: kdbxweb.KdbxEntry, group: string): Omit<VaultEntry, 'sourceId'> {
    const extraFields: VaultEntry['extraFields'] = [];

    for (const [key, value] of this.readEntries(entry.fields)) {
      if (KEEPASS_STANDARD_FIELDS.has(key)) continue;
      const text = this.readField(value);
      if (text) extraFields.push({ key, value: text });
    }

    const tags = Array.isArray(entry.tags)
      ? entry.tags.map((tag) => String(tag).trim()).filter(Boolean)
      : this.splitTags(this.readField(this.fieldValue(entry.fields, 'Tags')));

    return {
      id: this.uuidOf(entry.uuid),
      title: this.readField(this.fieldValue(entry.fields, 'Title')),
      username: this.readField(this.fieldValue(entry.fields, 'UserName')),
      password: this.readField(this.fieldValue(entry.fields, 'Password')),
      url: this.readField(this.fieldValue(entry.fields, 'URL')),
      notes: this.readField(this.fieldValue(entry.fields, 'Notes')),
      group,
      tags,
      extraFields,
      category: '',
      team: '',
    };
  }

  private fieldValue(fields: kdbxweb.KdbxEntry['fields'] | undefined, key: string): unknown {
    if (!fields) return undefined;
    if (fields instanceof Map) return fields.get(key);
    return (fields as Record<string, unknown>)[key];
  }

  private readEntries(fields: kdbxweb.KdbxEntry['fields'] | undefined): Array<[string, unknown]> {
    if (!fields) return [];
    if (fields instanceof Map) return [...fields.entries()];
    return Object.entries(fields as Record<string, unknown>);
  }

  private uuidOf(uuid: kdbxweb.KdbxUuid | undefined): string {
    if (!uuid) return crypto.randomUUID();
    if (typeof uuid.id === 'string' && uuid.id) return uuid.id;
    return uuid.toString();
  }

  private readField(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && 'getText' in value && typeof value.getText === 'function') {
      try {
        return String(value.getText() ?? '');
      } catch {
        return '';
      }
    }
    return String(value);
  }

  private splitTags(value: string): string[] {
    return value
      .split(/[;,]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  private stripExtension(fileName: string): string {
    return fileName.replace(/\.[^.]+$/, '');
  }
}

export async function parseKeepass(
  data: ArrayBuffer,
  options: KeepassOptions = {},
): Promise<ParseResult> {
  return new KeepassParser(data, options).parse();
}
