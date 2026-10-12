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
} from './secret-fields';

export function parseVault(data: ArrayBuffer, fileName = 'Vault export'): ParseResult {
  const text = decodeText(data);
  const documents = collectDocuments(text);
  const bundles = documents.flatMap(extractVaultBundles);

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
    name: stripExtension(fileName),
    entries,
    warnings: [],
  };
}

type VaultBundle = {
  id?: string;
  title: string;
  group: string;
  notes: string;
  secrets: Record<string, string>;
};

function collectDocuments(text: string): unknown[] {
  const json = tryParseJson(text);
  if (json != null) {
    return Array.isArray(json) ? json : [json];
  }

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

function extractVaultBundles(value: unknown): VaultBundle[] {
  if (Array.isArray(value)) {
    return value.flatMap(extractVaultBundles);
  }
  if (!isRecord(value)) return [];

  if (Array.isArray(value.secrets)) {
    return value.secrets.flatMap(extractVaultBundles);
  }

  const wrapped = unwrapVaultPayload(value);
  if (wrapped) return [wrapped];

  const asMap = flattenNamedSecrets(value);
  if (asMap.length > 0) return asMap;

  const flat = flattenStringMap(value);
  if (flat && looksLikeSecretMap(flat)) {
    return [
      {
        title: 'Vault secrets',
        group: '',
        notes: '',
        secrets: flat,
      },
    ];
  }

  return [];
}

function unwrapVaultPayload(value: LooseRecord): VaultBundle | null {
  if (!isVaultEnvelope(value)) return null;

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

function flattenNamedSecrets(value: LooseRecord): VaultBundle[] {
  if (isVaultEnvelope(value) || value.request_id != null) return [];

  const bundles: VaultBundle[] = [];
  for (const [path, item] of Object.entries(value)) {
    if (!isRecord(item)) continue;
    const wrapped = unwrapVaultPayload(item);
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

function isVaultEnvelope(value: LooseRecord): boolean {
  return (
    value.request_id != null ||
    value.lease_id != null ||
    (isRecord(value.data) && (isRecord(value.data.data) || isRecord(value.data.metadata)))
  );
}

function looksLikeSecretMap(map: Record<string, string>): boolean {
  const keys = Object.keys(map);
  if (keys.length === 0) return false;
  const passboltKeys = ['name', 'username', 'secret', 'password', 'uri'];
  return !passboltKeys.every(
    (key) => keys.includes(key) || keys.includes(key[0].toUpperCase() + key.slice(1)),
  );
}
