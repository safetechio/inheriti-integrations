import * as kdbxweb from 'kdbxweb';
import { setupKdbxCrypto } from '@shared/infrastructure/crypto/crypto-engine';
import { VaultUnlockError, type ParseResult, type VaultEntry } from '@modules/import/domain/vault';

const KEEPASS_STANDARD_FIELDS = new Set(['Title', 'UserName', 'Password', 'URL', 'Notes', 'Tags']);

export async function parseKeepass(
  data: ArrayBuffer,
  options: { password?: string; keyFile?: ArrayBuffer; fileName?: string } = {},
): Promise<ParseResult> {
  await setupKdbxCrypto();

  const password =
    options.password && options.password.length > 0
      ? kdbxweb.ProtectedValue.fromString(options.password)
      : null;
  const credentials = new kdbxweb.Credentials(password, options.keyFile ?? null);

  let db: kdbxweb.Kdbx;
  try {
    db = await kdbxweb.Kdbx.load(data.slice(0), credentials);
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

  const warnings: string[] = [];
  const entries: Omit<VaultEntry, 'sourceId'>[] = [];
  const recycleBinUuid = db.meta.recycleBinUuid;
  const defaultGroup = db.getDefaultGroup();

  const visit = (group: kdbxweb.KdbxGroup, path: string[]) => {
    if (recycleBinUuid && group.uuid && group.uuid.equals(recycleBinUuid)) {
      return;
    }

    const isRoot = Boolean(defaultGroup?.uuid && group.uuid?.equals(defaultGroup.uuid));
    const groupName = String(group.name ?? '').trim();
    const nextPath = isRoot || !groupName ? path : [...path, groupName];

    for (const entry of group.entries ?? []) {
      entries.push(mapKeepassEntry(entry, nextPath.join(' / ')));
    }

    for (const child of group.groups ?? []) {
      visit(child, nextPath);
    }
  };

  visit(defaultGroup, []);

  if (entries.length === 0) {
    warnings.push('The KeePass database opened, but it does not contain any entries.');
  }

  const vaultName =
    (db.meta.name || '').trim() || stripExtension(options.fileName ?? 'KeePass database');

  return {
    kind: 'keepass',
    name: vaultName,
    entries,
    warnings,
  };
}

function mapKeepassEntry(entry: kdbxweb.KdbxEntry, group: string): Omit<VaultEntry, 'sourceId'> {
  const extraFields: VaultEntry['extraFields'] = [];

  for (const [key, value] of readEntries(entry.fields)) {
    if (KEEPASS_STANDARD_FIELDS.has(key)) continue;
    const text = readField(value);
    if (text) extraFields.push({ key, value: text });
  }

  const tags = Array.isArray(entry.tags)
    ? entry.tags.map((tag) => String(tag).trim()).filter(Boolean)
    : splitTags(readField(fieldValue(entry.fields, 'Tags')));

  return {
    id: uuidOf(entry.uuid),
    title: readField(fieldValue(entry.fields, 'Title')),
    username: readField(fieldValue(entry.fields, 'UserName')),
    password: readField(fieldValue(entry.fields, 'Password')),
    url: readField(fieldValue(entry.fields, 'URL')),
    notes: readField(fieldValue(entry.fields, 'Notes')),
    group,
    tags,
    extraFields,
    category: '',
    team: '',
  };
}

function fieldValue(fields: kdbxweb.KdbxEntry['fields'] | undefined, key: string): unknown {
  if (!fields) return undefined;
  if (fields instanceof Map) return fields.get(key);
  return (fields as Record<string, unknown>)[key];
}

function readEntries(fields: kdbxweb.KdbxEntry['fields'] | undefined): Array<[string, unknown]> {
  if (!fields) return [];
  if (fields instanceof Map) return [...fields.entries()];
  return Object.entries(fields as Record<string, unknown>);
}

function uuidOf(uuid: kdbxweb.KdbxUuid | undefined): string {
  if (!uuid) return crypto.randomUUID();
  if (typeof uuid.id === 'string' && uuid.id) return uuid.id;
  return uuid.toString();
}

function readField(value: unknown): string {
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

function splitTags(value: string): string[] {
  return value
    .split(/[;,]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}
