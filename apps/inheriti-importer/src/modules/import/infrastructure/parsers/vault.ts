import { parseAllDocuments } from 'yaml';
import { VaultFormatError, type ParseResult } from '@modules/import/domain/vault';
import {
  asString,
  decodeText,
  entryFromSecrets,
  flattenStringMap,
  isRecord,
  stripExtension,
  tryParseJson,
  type LooseRecord,
} from './utils/secret-fields';

export function parseVault(data: ArrayBuffer, fileName = 'Vault export'): ParseResult {
  return new VaultParser(data, fileName).parse();
}

type VaultBundle = {
  id?: string;
  title: string;
  group: string;
  notes: string;
  secrets: Record<string, string>;
};

class VaultParser {
  constructor(
    private readonly data: ArrayBuffer,
    private readonly fileName: string,
  ) {}

  parse(): ParseResult {
    const documents = this.collectDocuments(decodeText(this.data));
    const bundles = documents.flatMap((item) => this.extractBundles(item));

    if (bundles.length === 0) {
      throw new VaultFormatError(
        'No HashiCorp Vault secrets were found. Export with vault kv get -format=json, or a JSON dump of KV pairs.',
      );
    }

    const entries = bundles.map((bundle, index) =>
      entryFromSecrets(bundle.secrets, {
        id: bundle.id || `vault-${index + 1}`,
        title: bundle.title || `Secret ${index + 1}`,
        group: bundle.group,
        notes: bundle.notes,
      }),
    );

    return {
      kind: 'vault',
      name: stripExtension(this.fileName),
      entries,
      warnings: [],
    };
  }

  private collectDocuments(text: string): unknown[] {
    const json = tryParseJson(text);
    if (json != null) return Array.isArray(json) ? json : [json];

    try {
      const documents = parseAllDocuments(text);
      if (documents.some((document) => document.errors.length > 0)) {
        throw new VaultFormatError('This Vault file is not valid JSON or YAML.');
      }
      return documents.map((document) => document.toJSON()).filter((value) => value != null);
    } catch {
      throw new VaultFormatError('This Vault file is not valid JSON or YAML.');
    }
  }

  private extractBundles(value: unknown): VaultBundle[] {
    if (Array.isArray(value)) return value.flatMap((item) => this.extractBundles(item));
    if (!isRecord(value)) return [];
    if (Array.isArray(value.secrets))
      return value.secrets.flatMap((item) => this.extractBundles(item));

    const wrapped = this.unwrapPayload(value);
    if (wrapped) return [wrapped];

    const named = this.flattenNamedSecrets(value);
    if (named.length > 0) return named;

    const flat = flattenStringMap(value);
    if (!flat || !this.looksLikeSecretMap(flat)) return [];
    return [{ title: 'Vault secrets', group: '', notes: '', secrets: flat }];
  }

  private unwrapPayload(value: LooseRecord): VaultBundle | null {
    if (!this.isVaultEnvelope(value)) return null;

    const inner = isRecord(value.data) ? value.data : {};
    const kv2 = isRecord(inner.data) ? flattenStringMap(inner.data) : null;
    const kv1 = flattenStringMap(inner);
    const secrets = kv2 ?? kv1 ?? {};
    if (Object.keys(secrets).length === 0) return null;

    const metadata = isRecord(inner.metadata) ? inner.metadata : {};
    const path = asString(value.path) || asString(value.Path) || asString(metadata.path);
    const title = path.split('/').filter(Boolean).at(-1) || path || '';

    return {
      id: asString(value.request_id) || undefined,
      title,
      group: path.includes('/') ? path.split('/').slice(0, -1).join('/') : '',
      notes: path,
      secrets,
    };
  }

  private flattenNamedSecrets(value: LooseRecord): VaultBundle[] {
    // Treat each key as a secret path when the document is a KV dump.
    if (this.isVaultEnvelope(value) || value.request_id != null) return [];

    const bundles: VaultBundle[] = [];
    for (const [path, item] of Object.entries(value)) {
      if (!isRecord(item)) continue;
      const wrapped = this.unwrapPayload(item);
      if (wrapped) {
        bundles.push({
          ...wrapped,
          title: wrapped.title || path.split('/').filter(Boolean).at(-1) || path,
          group: wrapped.group || path.split('/').slice(0, -1).join('/'),
          notes: wrapped.notes || path,
        });
        continue;
      }
      const map = isRecord(item.data) ? flattenStringMap(item.data) : flattenStringMap(item);
      if (map) {
        bundles.push({
          title: path.split('/').filter(Boolean).at(-1) || path,
          group: path.includes('/') ? path.split('/').slice(0, -1).join('/') : '',
          notes: path,
          secrets: map,
        });
      }
    }
    return bundles;
  }

  private isVaultEnvelope(value: LooseRecord): boolean {
    return (
      value.request_id != null ||
      value.lease_id != null ||
      (isRecord(value.data) && (isRecord(value.data.data) || isRecord(value.data.metadata)))
    );
  }

  private looksLikeSecretMap(map: Record<string, string>): boolean {
    const keys = Object.keys(map);
    if (keys.length === 0) return false;
    const passboltKeys = ['name', 'username', 'secret', 'password', 'uri'];
    return !passboltKeys.every(
      (key) => keys.includes(key) || keys.includes(key[0].toUpperCase() + key.slice(1)),
    );
  }
}
