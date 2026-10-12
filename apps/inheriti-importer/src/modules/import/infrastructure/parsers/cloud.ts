import { VaultFormatError, type ParseResult } from '@modules/import/domain/vault';
import {
  asString,
  decodeBase64,
  decodeText,
  entryFromSecrets,
  flattenStringMap,
  isRecord,
  stripExtension,
  tryParseJson,
  type LooseRecord,
} from './secret-fields';

export function parseCloud(data: ArrayBuffer, fileName = 'Cloud secret'): ParseResult {
  const parsed = tryParseJson(decodeText(data));
  if (parsed == null) {
    throw new VaultFormatError('This cloud secret export is not valid JSON.');
  }

  const bundles = extractCloudSecrets(parsed);
  if (bundles.length === 0) {
    throw new VaultFormatError(
      'No AWS, Azure, or Google cloud secrets were found. Import a get-secret-value / secret show JSON export.',
    );
  }

  const entries = bundles.map((bundle, index) =>
    entryFromSecrets(bundle.secrets, {
      id: bundle.id || `cloud-${index + 1}`,
      title: bundle.title || `Secret ${index + 1}`,
      group: bundle.group,
      tags: bundle.tags,
      notes: bundle.notes,
    }),
  );

  return {
    kind: 'cloud',
    name: stripExtension(fileName),
    entries,
    warnings: [],
  };
}

type CloudBundle = {
  id?: string;
  title: string;
  group: string;
  tags: string[];
  notes: string;
  secrets: Record<string, string>;
};

function extractCloudSecrets(value: unknown): CloudBundle[] {
  if (Array.isArray(value)) {
    return value.flatMap(extractCloudSecrets);
  }
  if (!isRecord(value)) return [];

  const listKeys = ['SecretValues', 'SecretList', 'value', 'secrets', 'items'];
  for (const key of listKeys) {
    if (Array.isArray(value[key])) {
      const nested = value[key].flatMap(extractCloudSecrets);
      if (nested.length > 0) return nested;
    }
  }

  const aws = readAwsSecret(value);
  if (aws) return [aws];

  const azure = readAzureSecret(value);
  if (azure) return [azure];

  const gcp = readGcpSecret(value);
  if (gcp) return [gcp];

  return [];
}

function readAwsSecret(value: LooseRecord): CloudBundle | null {
  const secretString = asString(value.SecretString);
  const secretBinary = asString(value.SecretBinary);
  const name = asString(value.Name) || asString(value.NamePrefix);
  const arn = asString(value.ARN);
  if (!secretString && !secretBinary && !arn.includes('secretsmanager')) {
    return null;
  }
  if (!secretString && !secretBinary) return null;

  const title = name || lastSegment(arn, ':') || 'AWS secret';
  const payload = secretString || decodeBase64(secretBinary).text;
  return {
    id: asString(value.ARN) || asString(value.VersionId) || undefined,
    title,
    group: regionFromArn(arn),
    tags: ['aws'],
    notes: arn,
    secrets: secretsFromPayload(payload, title),
  };
}

function readAzureSecret(value: LooseRecord): CloudBundle | null {
  const id = asString(value.id) || asString(value.kid);
  const rawValue = asString(value.value);
  if (!rawValue) return null;
  if (!id.includes('vault.azure.net') && !isRecord(value.attributes)) return null;

  const name = asString(value.name) || secretNameFromAzureId(id) || 'Azure secret';
  return {
    id: id || undefined,
    title: name,
    group: vaultNameFromAzureId(id),
    tags: ['azure'],
    notes: id,
    secrets: secretsFromPayload(rawValue, name),
  };
}

function readGcpSecret(value: LooseRecord): CloudBundle | null {
  const name = asString(value.name);
  const payload = isRecord(value.payload) ? value.payload : null;
  const data = payload ? asString(payload.data) : '';
  if (!data) return null;
  if (!name.includes('/secrets/') && !name.includes('secretmanager')) return null;

  const decoded = decodeBase64(data);
  const title = name.split('/secrets/').at(1)?.split('/')[0] || 'GCP secret';
  return {
    id: name || undefined,
    title,
    group: name.split('/secrets/')[0] || '',
    tags: ['gcp'],
    notes: name,
    secrets: secretsFromPayload(decoded.text, title),
  };
}

function secretsFromPayload(payload: string, fallbackKey: string): Record<string, string> {
  const json = tryParseJson(payload);
  const map = flattenStringMap(json);
  if (map) return map;
  return { [fallbackKey || 'value']: payload };
}

function lastSegment(value: string, delimiter: string): string {
  const parts = value.split(delimiter).filter(Boolean);
  return parts.at(-1)?.replace(/-[A-Za-z0-9]{6}$/, '') ?? '';
}

function regionFromArn(arn: string): string {
  const parts = arn.split(':');
  return parts[3] || '';
}

function secretNameFromAzureId(id: string): string {
  const match = id.match(/\/secrets\/([^/]+)/);
  return match?.[1] ?? '';
}

function vaultNameFromAzureId(id: string): string {
  const match = id.match(/https:\/\/([^.]+)\.vault\.azure\.net/i);
  return match?.[1] ?? '';
}
