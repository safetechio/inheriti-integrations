import { hasLosslessJsonNumbers } from '@modules/import/domain/structured-extra-fields';
import type { ImportDiagnostic } from '@modules/import/domain/import-diagnostic';
import {
  VaultFormatError,
  type ParseResult,
  type SourceFieldMetadata,
} from '@modules/import/domain/vault';
import {
  asString,
  decodeBase64,
  decodeText,
  entryFromSecrets,
  flattenStringMap,
  isRecord,
  stripExtension,
  structuredFieldMetadata,
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
  provider: 'aws' | 'azure' | 'gcp';
  notes: string;
  secrets: Record<string, string>;
  extraFieldMetadata?: ReadonlyMap<string, SourceFieldMetadata>;
};

class CloudParser {
  private readonly diagnostics: ImportDiagnostic[] = [];

  constructor(
    private readonly data: ArrayBuffer,
    private readonly fileName: string,
  ) {}

  parse(): ParseResult {
    const parsed = tryParseJson(decodeText(this.data));
    if (parsed == null) {
      throw new VaultFormatError('This cloud secret export is not valid JSON.');
    }

    const bundles = this.extractCloudSecrets(parsed, []);
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
        tags: [bundle.provider],
        sourceHints: { provider: bundle.provider },
        notes: bundle.notes,
        extraFieldMetadata: bundle.extraFieldMetadata,
      }),
    );

    return {
      kind: 'cloud',
      name: stripExtension(this.fileName),
      entries,
      warnings: [],
      diagnostics: this.diagnostics,
    };
  }

  private extractCloudSecrets(value: unknown, sourcePath: string[]): CloudBundle[] {
    if (Array.isArray(value)) {
      return value.flatMap((item, index) =>
        this.extractCloudSecrets(item, [...sourcePath, String(index)]),
      );
    }
    if (isRecord(value)) {
      const bundle =
        this.readAwsSecret(value) ?? this.readAzureSecret(value) ?? this.readGcpSecret(value);
      const listKeys = ['SecretValues', 'SecretList', 'value', 'secrets', 'items'].filter((key) =>
        Array.isArray(value[key]),
      );
      if (bundle || listKeys.length) {
        return [
          ...(bundle ? [bundle] : []),
          ...listKeys.flatMap((key) => this.extractCloudSecrets(value[key], [...sourcePath, key])),
        ];
      }
    }
    this.diagnostics.push({
      code: 'cloud-unsupported-record',
      kind: 'unsupported',
      count: 1,
      message: 'A cloud export record had no supported secret payload.',
      sourcePath,
    });
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
    const decoded = decodeBase64(secretBinary);
    const payload =
      secretString || !decoded.binary
        ? this.secretsFromPayload(secretString || decoded.text, title)
        : this.binaryPayload('SecretBinary', secretBinary);
    if (secretString && secretBinary) {
      let key = 'SecretBinary (base64)';
      while (Object.hasOwn(payload.secrets, key)) key += ' (source)';
      payload.secrets[key] = secretBinary;
      payload.extraFieldMetadata.set(key, this.binaryMetadata('SecretBinary'));
    }
    return {
      id: asString(value.ARN) || asString(value.VersionId) || undefined,
      title,
      group: this.regionFromArn(arn),
      provider: 'aws',
      notes: arn,
      ...payload,
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
      provider: 'azure',
      notes: id,
      ...this.secretsFromPayload(rawValue, name),
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
      provider: 'gcp',
      notes: name,
      ...(decoded.binary
        ? this.binaryPayload('payload.data', data, ['payload', 'data'])
        : this.secretsFromPayload(decoded.text, title)),
    };
  }

  private secretsFromPayload(payload: string, fallbackKey: string) {
    // Keep plain text as a named field when the payload is not a JSON object.
    const json = tryParseJson(payload);
    if (json !== null && typeof json === 'object' && !hasLosslessJsonNumbers(payload)) {
      const key = fallbackKey || 'value';
      return {
        secrets: { [key]: payload },
        extraFieldMetadata: new Map<string, SourceFieldMetadata>([
          [key, { sourceKey: key, sourceFieldType: 'json', sourceAutoMapping: 'manual-only' }],
        ]),
      };
    }
    const map = flattenStringMap(json);
    if (map) return { secrets: map, extraFieldMetadata: structuredFieldMetadata(json) };

    const key = fallbackKey || 'value';
    const extraFieldMetadata = new Map<string, SourceFieldMetadata>();
    if (Array.isArray(json)) extraFieldMetadata.set(key, { sourceFieldType: 'json' });
    return { secrets: { [key]: payload }, extraFieldMetadata };
  }

  private binaryPayload(key: string, value: string, sourcePath = [key]) {
    const label = `${key} (base64)`;
    return {
      secrets: { [label]: value },
      extraFieldMetadata: new Map([[label, this.binaryMetadata(key, sourcePath)]]),
    };
  }

  private binaryMetadata(key: string, sourcePath = [key]): SourceFieldMetadata {
    return {
      sourceKey: key,
      sourcePath: JSON.stringify(sourcePath),
      sourceFieldType: 'base64',
      sourceAutoMapping: 'manual-only',
    };
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
