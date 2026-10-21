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
} from './utils/secret-fields';

export function parseCloud(data: ArrayBuffer, fileName = 'Cloud secret'): ParseResult {
  return new CloudParser(data, fileName).parse();
}

type CloudBundle = {
  id?: string;
  title: string;
  group: string;
  tags: string[];
  notes: string;
  secrets: Record<string, string>;
};

class CloudParser {
  constructor(
    private readonly data: ArrayBuffer,
    private readonly fileName: string,
  ) {}

  parse(): ParseResult {
    const parsed = tryParseJson(decodeText(this.data));
    if (parsed == null) {
      throw new VaultFormatError('This cloud secret export is not valid JSON.');
    }

    const bundles = this.extractCloudSecrets(parsed);
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
      name: stripExtension(this.fileName),
      entries,
      warnings: [],
    };
  }

  private extractCloudSecrets(value: unknown): CloudBundle[] {
    // Exports may wrap one or more secrets in provider-specific lists.
    if (Array.isArray(value)) {
      return value.flatMap((item) => this.extractCloudSecrets(item));
    }
    if (!isRecord(value)) return [];

    const listKeys = ['SecretValues', 'SecretList', 'value', 'secrets', 'items'];
    for (const key of listKeys) {
      if (Array.isArray(value[key])) {
        const nested = value[key].flatMap((item) => this.extractCloudSecrets(item));
        if (nested.length > 0) return nested;
      }
    }

    const aws = this.readAwsSecret(value);
    if (aws) return [aws];

    const azure = this.readAzureSecret(value);
    if (azure) return [azure];

    const gcp = this.readGcpSecret(value);
    if (gcp) return [gcp];

    return [];
  }

  private readAwsSecret(value: LooseRecord): CloudBundle | null {
    const secretString = asString(value.SecretString);
    const secretBinary = asString(value.SecretBinary);
    const name = asString(value.Name) || asString(value.NamePrefix);
    const arn = asString(value.ARN);
    if (!secretString && !secretBinary && !arn.includes('secretsmanager')) {
      return null;
    }
    if (!secretString && !secretBinary) return null;

    const title = name || this.lastSegment(arn, ':') || 'AWS secret';
    const payload = secretString || decodeBase64(secretBinary).text;
    return {
      id: asString(value.ARN) || asString(value.VersionId) || undefined,
      title,
      group: this.regionFromArn(arn),
      tags: ['aws'],
      notes: arn,
      secrets: this.secretsFromPayload(payload, title),
    };
  }

  private readAzureSecret(value: LooseRecord): CloudBundle | null {
    const id = asString(value.id) || asString(value.kid);
    const rawValue = asString(value.value);
    if (!rawValue) return null;
    if (!id.includes('vault.azure.net') && !isRecord(value.attributes)) return null;

    const name = asString(value.name) || this.secretNameFromAzureId(id) || 'Azure secret';
    return {
      id: id || undefined,
      title: name,
      group: this.vaultNameFromAzureId(id),
      tags: ['azure'],
      notes: id,
      secrets: this.secretsFromPayload(rawValue, name),
    };
  }

  private readGcpSecret(value: LooseRecord): CloudBundle | null {
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
      secrets: this.secretsFromPayload(decoded.text, title),
    };
  }

  private secretsFromPayload(payload: string, fallbackKey: string): Record<string, string> {
    // Keep plain text as a named field when the payload is not a JSON object.
    const json = tryParseJson(payload);
    const map = flattenStringMap(json);
    if (map) return map;
    return { [fallbackKey || 'value']: payload };
  }

  private lastSegment(value: string, delimiter: string): string {
    // AWS appends a generated suffix to secret ARNs.
    const parts = value.split(delimiter).filter(Boolean);
    return parts.at(-1)?.replace(/-[A-Za-z0-9]{6}$/, '') ?? '';
  }

  private regionFromArn(arn: string): string {
    const parts = arn.split(':');
    return parts[3] || '';
  }

  private secretNameFromAzureId(id: string): string {
    const match = id.match(/\/secrets\/([^/]+)/);
    return match?.[1] ?? '';
  }

  private vaultNameFromAzureId(id: string): string {
    const match = id.match(/https:\/\/([^.]+)\.vault\.azure\.net/i);
    return match?.[1] ?? '';
  }
}
