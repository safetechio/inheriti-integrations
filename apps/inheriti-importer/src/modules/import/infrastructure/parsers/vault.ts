import { parseAllDocuments } from 'yaml';
import {
  VaultFormatError,
  type ParseResult,
  type SourceFieldMetadata,
} from '@modules/import/domain/vault';
import {
  asString,
  decodeText,
  entryFromSecrets,
  flattenStringMap,
  isRecord,
  stripExtension,
  structuredFieldMetadata,
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
  extraFieldMetadata: ReadonlyMap<string, SourceFieldMetadata>;
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
        extraFieldMetadata: bundle.extraFieldMetadata,
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

    const remaining = new Map(Object.entries(value));
    const named = this.flattenNamedSecrets(value, remaining);
    const fields = Object.fromEntries(remaining);
    const flat = flattenStringMap(fields);
    if (flat && this.looksLikeSecretMap(flat)) {
      named.push({
        title: 'Vault secrets',
        group: '',
        notes: '',
        secrets: flat,
        extraFieldMetadata: structuredFieldMetadata(fields),
      });
    }
    return named;
  }

  private unwrapPayload(value: LooseRecord): VaultBundle | null {
    if (!this.isVaultEnvelope(value)) return null;

    const inner = isRecord(value.data) ? value.data : {};
    const fields = isRecord(inner.data) && flattenStringMap(inner.data) ? inner.data : inner;
    const secrets = flattenStringMap(fields) ?? {};
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
      extraFieldMetadata: structuredFieldMetadata(fields),
    };
  }

  private flattenNamedSecrets(value: LooseRecord, remaining: Map<string, unknown>): VaultBundle[] {
    // Treat each key as a secret path when the document is a KV dump.
    if (this.isVaultEnvelope(value) || value.request_id != null) return [];

    const bundles: VaultBundle[] = [];
    const allRecords = Object.values(value).every(isRecord);
    for (const [path, item] of Object.entries(value)) {
      if (!isRecord(item)) continue;
      if (!allRecords && !path.includes('/') && !this.isVaultEnvelope(item)) continue;
      const wrapped = this.unwrapPayload(item);
      if (wrapped) {
        remaining.delete(path);
        bundles.push({
          ...wrapped,
          title: wrapped.title || path.split('/').filter(Boolean).at(-1) || path,
          group: wrapped.group || path.split('/').slice(0, -1).join('/'),
          notes: wrapped.notes || path,
        });
        continue;
      }
      const fields = isRecord(item.data) && Object.keys(item).length === 1 ? item.data : item;
      const map = flattenStringMap(fields);
      if (map) {
        remaining.delete(path);
        bundles.push({
          title: path.split('/').filter(Boolean).at(-1) || path,
          group: path.includes('/') ? path.split('/').slice(0, -1).join('/') : '',
          notes: path,
          secrets: map,
          extraFieldMetadata: structuredFieldMetadata(fields),
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
