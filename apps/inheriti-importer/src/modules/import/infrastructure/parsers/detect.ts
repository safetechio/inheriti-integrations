import { parseAllDocuments } from 'yaml';
import { decodeText, isRecord, tryParseJson } from './secret-fields';
import { VaultFormatError, type VaultSourceKind } from '@modules/import/domain/vault';

const KDBX_SIGNATURE = [0x03, 0xd9, 0xa2, 0x9a];

export function detectVaultKind(fileName: string, data: ArrayBuffer): VaultSourceKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.kdbx') || hasKdbxSignature(data)) {
    return 'keepass';
  }

  const text = decodeText(data);
  const json = tryParseJson(text);

  if (looksLikeKubernetes(text, json)) return 'kubernetes';
  if (looksLikeVault(text, json)) return 'vault';
  if (looksLikeCloud(json)) return 'cloud';
  if (looksLikeDotenv(text, lower)) return 'dotenv';

  if (lower.endsWith('.json') || lower.endsWith('.csv')) {
    return 'passbolt';
  }

  if (looksLikeJson(text) || looksLikeCsv(text)) {
    return 'passbolt';
  }

  throw new VaultFormatError(
    `Could not recognise “${fileName}”. Import a KeePass .kdbx file, a Passbolt JSON/CSV export, a Kubernetes Secret, a HashiCorp Vault dump, a .env file, or an AWS/Azure/GCP secret JSON export.`,
  );
}

function hasKdbxSignature(data: ArrayBuffer): boolean {
  if (data.byteLength < 4) return false;
  const bytes = new Uint8Array(data, 0, 4);
  return KDBX_SIGNATURE.every((value, index) => bytes[index] === value);
}

function looksLikeKubernetes(text: string, json: unknown): boolean {
  if (json != null) return jsonContainsKind(json, ['Secret', 'ConfigMap']);
  try {
    if (parseAllDocuments(text).some((document) => document.errors.length > 0)) return false;
  } catch {
    return false;
  }
  return /\bkind:\s*['"]?(Secret|ConfigMap)\b/.test(text);
}

function looksLikeVault(text: string, json: unknown): boolean {
  if (json != null) return vaultShape(json);
  try {
    const documents = parseAllDocuments(text);
    if (documents.some((document) => document.errors.length > 0)) return false;
    return documents.some((document) => vaultShape(document.toJSON()));
  } catch {
    return false;
  }
}

function looksLikeCloud(json: unknown): boolean {
  return json != null && cloudShape(json);
}

function looksLikeDotenv(text: string, fileName: string): boolean {
  const base = fileName.split(/[/\\]/).at(-1) ?? fileName;
  if (base === '.env' || base.startsWith('.env.') || base.endsWith('.env')) return true;

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (lines.length === 0) return false;
  const envLines = lines.filter((line) => /^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line));
  return envLines.length > 0 && envLines.length / lines.length >= 0.7 && !looksLikeCsv(text);
}

function jsonContainsKind(value: unknown, kinds: string[]): boolean {
  if (Array.isArray(value)) return value.some((item) => jsonContainsKind(item, kinds));
  if (!isRecord(value)) return false;
  if (kinds.includes(String(value.kind ?? ''))) return true;
  return Array.isArray(value.items) && value.items.some((item) => jsonContainsKind(item, kinds));
}

function vaultShape(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(vaultShape);
  if (!isRecord(value)) return false;
  if (value.request_id != null || value.lease_id != null) return true;
  if (isRecord(value.data) && (isRecord(value.data.data) || isRecord(value.data.metadata)))
    return true;
  if (Array.isArray(value.secrets) && value.secrets.some(vaultShape)) return true;
  return Object.entries(value).some(([key, item]) => {
    if (!isRecord(item)) return false;
    if (vaultShape(item)) return true;
    return key.includes('/') && hasSerializableValues(item);
  });
}

function cloudShape(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(cloudShape);
  if (!isRecord(value)) return false;
  if (typeof value.SecretString === 'string' || typeof value.SecretBinary === 'string') return true;
  if (typeof value.ARN === 'string' && String(value.ARN).includes('secretsmanager')) return true;
  if (typeof value.id === 'string' && String(value.id).includes('vault.azure.net')) return true;
  if (
    isRecord(value.payload) &&
    value.payload.data != null &&
    String(value.name ?? '').includes('secret')
  ) {
    return true;
  }
  return ['SecretValues', 'SecretList', 'value', 'secrets'].some(
    (key) => Array.isArray(value[key]) && value[key].some(cloudShape),
  );
}

function hasSerializableValues(value: unknown): boolean {
  if (
    value == null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value != null;
  }
  if (Array.isArray(value)) return value.some(hasSerializableValues);
  if (!isRecord(value)) return false;
  return Object.values(value).some(hasSerializableValues);
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function looksLikeCsv(text: string): boolean {
  const header = text.split(/\r?\n/, 1)[0]?.toLowerCase() ?? '';
  return (
    header.includes('name') &&
    (header.includes('secret') || header.includes('password')) &&
    header.includes(',')
  );
}
