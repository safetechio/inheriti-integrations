import { parseAllDocuments } from 'yaml';
import type { ImportDiagnostic } from '@modules/import/domain/import-diagnostic';
import {
  VaultFormatError,
  type ParseResult,
  type SourceFieldMetadata,
  type VaultEntry,
} from '@modules/import/domain/vault';
import {
  asString,
  decodeBase64,
  decodeText,
  entryFromSecrets,
  isRecord,
  stripExtension,
  tryParseJson,
  type LooseRecord,
} from './utils/secret-fields';

const SECRET_KINDS = new Set(['Secret', 'ConfigMap']);

export function parseKubernetes(data: ArrayBuffer, fileName = 'Kubernetes export'): ParseResult {
  return new KubernetesParser(data, fileName).parse();
}

class KubernetesParser {
  private readonly diagnostics: ImportDiagnostic[] = [];
  private readonly warnings: string[] = [];

  constructor(
    private readonly data: ArrayBuffer,
    private readonly fileName: string,
  ) {}

  parse(): ParseResult {
    const objects = this.collectDocuments(decodeText(this.data));
    const expanded = objects.flatMap((item) => this.expandLists(item));
    const resources = expanded.filter((item) => this.isSecretLike(item));

    if (resources.length === 0) {
      throw new VaultFormatError(
        'No Kubernetes Secret or ConfigMap resources were found. Export with kubectl get secret -o yaml (or json).',
      );
    }

    const skipped = expanded.filter((item) => !this.isSecretLike(item));
    if (skipped.length > 0) {
      this.warnings.push(
        `Skipped ${skipped.length} non-secret Kubernetes ${skipped.length === 1 ? 'resource' : 'resources'}.`,
      );
    }

    const entries = resources.map((resource, index) => this.mapResource(resource, index));

    return {
      kind: 'kubernetes',
      name: stripExtension(this.fileName),
      entries,
      warnings: this.warnings,
      diagnostics: this.diagnostics,
    };
  }

  private collectDocuments(text: string): unknown[] {
    const json = tryParseJson(text);
    if (json != null) {
      return Array.isArray(json) ? json : [json];
    }

    try {
      const documents = parseAllDocuments(text);
      if (documents.some((document) => document.errors.length > 0)) {
        throw new VaultFormatError('This Kubernetes file is not valid YAML or JSON.');
      }
      return documents.map((document) => document.toJSON()).filter((value) => value != null);
    } catch {
      throw new VaultFormatError('This Kubernetes file is not valid YAML or JSON.');
    }
  }

  private expandLists(value: unknown): LooseRecord[] {
    if (!isRecord(value)) return [];
    if (Array.isArray(value.items)) {
      return value.items.filter(isRecord);
    }
    return [value];
  }

  private isSecretLike(value: unknown): value is LooseRecord {
    return isRecord(value) && SECRET_KINDS.has(asString(value.kind));
  }

  private mapResource(resource: LooseRecord, index: number): Omit<VaultEntry, 'sourceId'> {
    const metadata = isRecord(resource.metadata) ? resource.metadata : {};
    const name = asString(metadata.name) || `untitled-${index + 1}`;
    const namespace = asString(metadata.namespace);
    const kind = asString(resource.kind) || 'Secret';
    const type = asString(resource.type);
    const id = asString(metadata.uid) || `k8s-${index + 1}`;
    const fields: VaultEntry['extraFields'] = [];
    this.readSecretData(resource, kind, fields);
    const isDocker =
      type === 'kubernetes.io/dockerconfigjson' ||
      type === 'kubernetes.io/dockercfg' ||
      fields.some((field) => this.isDockerKey(field));
    const tags = [kind.toLowerCase(), type.replace(/^kubernetes\.io\//, '')].filter(
      (tag) => tag && tag !== 'opaque',
    );
    const meta = {
      id,
      title: name,
      group: namespace,
      sourceHints: { category: kind },
      tags,
      notes: [kind !== 'Secret' ? kind : '', type && type !== 'Opaque' ? type : '']
        .filter(Boolean)
        .join(' · '),
    };
    if (fields.length === 0) this.warnings.push(`${name} has no data keys.`);
    if (isDocker) {
      return this.mapDockerSecret(fields, meta);
    }

    const unique = this.uniqueFields(fields);
    return entryFromSecrets(Object.fromEntries(unique.map((field) => [field.key, field.value])), {
      ...meta,
      extraFieldMetadata: new Map(
        unique.flatMap((field) => (field.metadata ? [[field.key, field.metadata]] : [])),
      ),
    });
  }

  private readSecretData(
    resource: LooseRecord,
    kind: string,
    fields: VaultEntry['extraFields'],
  ): void {
    const seen = new Set<string>();
    for (const source of ['stringData', 'data', 'binaryData']) {
      const values = resource[source];
      if (!isRecord(values)) continue;
      const base64 = source === 'binaryData' || (source === 'data' && kind !== 'ConfigMap');
      for (const [key, value] of Object.entries(values)) {
        const path = [source, key];
        const shadowed = seen.has(key);
        seen.add(key);
        const binary = base64 && typeof value === 'string' ? decodeBase64(value) : undefined;
        const metadata = binary?.binary
          ? ({
              sourceKey: key,
              sourcePath: JSON.stringify(path),
              sourceFieldType: 'base64',
              sourceAutoMapping: 'manual-only',
            } satisfies SourceFieldMetadata)
          : shadowed
            ? {
                sourceKey: key,
                sourcePath: JSON.stringify(path),
                sourceAutoMapping: 'manual-only' as const,
              }
            : undefined;
        this.addField(
          fields,
          binary?.binary ? `${key} (base64)` : key,
          binary?.text ?? value,
          path,
          metadata,
        );
      }
    }
  }

  private isDockerKey(field: VaultEntry['extraFields'][number]): boolean {
    const key = field.metadata?.sourceKey ?? field.key;
    return key === '.dockerconfigjson' || key === '.dockercfg';
  }

  private mapDockerSecret(
    fields: VaultEntry['extraFields'],
    meta: Parameters<typeof entryFromSecrets>[1] & { id: string },
  ): Omit<VaultEntry, 'sourceId'> {
    const entry = entryFromSecrets({}, meta);
    const extras = entry.extraFields;
    for (const field of fields) {
      if (!this.isDockerKey(field) || field.metadata?.sourceAutoMapping === 'manual-only') {
        extras.push(field);
        if (this.isDockerKey(field) && field.metadata?.sourceFieldType === 'base64')
          this.reportUnreadableDocker(field, entry.id);
        continue;
      }
      const key = field.metadata?.sourceKey ?? field.key;
      const parsed = tryParseJson(field.value);
      const hasAuths =
        key === '.dockerconfigjson' || (isRecord(parsed) && Object.hasOwn(parsed, 'auths'));
      const auths = isRecord(parsed) ? (hasAuths ? parsed.auths : parsed) : undefined;
      if (!isRecord(parsed) || !isRecord(auths) || !Object.values(auths).some(isRecord)) {
        extras.push({
          ...field,
          metadata: {
            ...field.metadata,
            sourceKey: key,
            sourceAutoMapping: 'manual-only',
          },
        });
        this.reportUnreadableDocker(field, entry.id);
        continue;
      }
      const path = this.dockerSourcePath(field, key);
      if (hasAuths) {
        for (const [configKey, value] of Object.entries(parsed)) {
          if (configKey !== 'auths') this.addField(extras, configKey, value, [...path, configKey]);
        }
      }
      for (const [registry, auth] of Object.entries(auths)) {
        const authPath = hasAuths ? [...path, 'auths', registry] : [...path, registry];
        if (!isRecord(auth)) {
          this.addField(extras, registry, auth, authPath);
          continue;
        }
        const primary = !entry.url;
        const { username, password, used } = this.decodeDockerAuth(auth);
        if (primary) {
          entry.url = registry;
          entry.username = username;
          entry.password = password;
        } else {
          this.addField(extras, `${registry} username`, username, [...authPath, 'username']);
          this.addField(extras, `${registry} password`, password, [...authPath, 'password']);
        }
        for (const [authKey, value] of Object.entries(auth)) {
          if (used.has(authKey)) continue;
          const label = primary ? authKey : `${registry} ${authKey}`;
          const opaqueAuth =
            authKey === 'auth'
              ? ({
                  sourceKey: authKey,
                  sourcePath: JSON.stringify([...authPath, authKey]),
                  sourceAutoMapping: 'manual-only',
                } satisfies SourceFieldMetadata)
              : undefined;
          this.addField(extras, label, value, [...authPath, authKey], opaqueAuth);
        }
      }
    }
    entry.fieldMetadata = {
      ...(entry.username ? { username: { sourceKey: 'username' } } : {}),
      ...(entry.password ? { password: { sourceKey: 'password' } } : {}),
      ...(entry.url ? { url: { sourceKey: 'url' } } : {}),
    };
    entry.extraFields = this.uniqueFields(extras);
    return entry;
  }

  private reportUnreadableDocker(field: VaultEntry['extraFields'][number], entryId: string): void {
    const key = field.metadata?.sourceKey ?? field.key;
    this.diagnostics.push({
      code: 'k8s-docker-unreadable-payload',
      kind: 'unsupported',
      message:
        'A Docker configuration could not be read as credentials. Its original value was retained for manual mapping.',
      count: 1,
      entryId,
      sourcePath: this.dockerSourcePath(field, key),
    });
  }

  private dockerSourcePath(field: VaultEntry['extraFields'][number], key: string): string[] {
    return field.metadata?.sourcePath ? JSON.parse(field.metadata.sourcePath) : [key];
  }

  private decodeDockerAuth(auth: LooseRecord) {
    let username = asString(auth.username);
    let password = asString(auth.password);
    const used = new Set<string>();
    if (username) used.add('username');
    if (password) used.add('password');

    const token = asString(auth.auth);
    if (token) {
      const decoded = decodeBase64(token);
      const split = decoded.text.indexOf(':');
      if (!decoded.binary && split >= 0) {
        const tokenUser = decoded.text.slice(0, split);
        const tokenPassword = decoded.text.slice(split + 1);
        username ||= tokenUser;
        password ||= tokenPassword;
        if (username === tokenUser && password === tokenPassword) used.add('auth');
      }
    }
    return { username, password, used };
  }

  private addField(
    fields: VaultEntry['extraFields'],
    key: string,
    value: unknown,
    sourcePath: string[],
    metadata?: SourceFieldMetadata,
  ): void {
    const structured = value != null && typeof value === 'object';
    const text = structured ? JSON.stringify(value) : asString(value);
    if (!text) return;
    if (structured) metadata = { ...metadata, sourceFieldType: 'json' };
    if (metadata || this.isDockerKey({ key, value: text })) {
      metadata = {
        sourceKey: sourcePath.at(-1),
        sourcePath: JSON.stringify(sourcePath),
        ...metadata,
      };
    }
    fields.push({ key, value: text, ...(metadata ? { metadata } : {}) });
  }

  private uniqueFields(fields: VaultEntry['extraFields']): VaultEntry['extraFields'] {
    const reserved = new Set(fields.map((field) => field.key));
    const used = new Set<string>();
    return fields.map((field) => {
      if (!used.has(field.key)) {
        used.add(field.key);
        return field;
      }
      let index = 2;
      let key = `${field.key} (${index})`;
      while (reserved.has(key) || used.has(key)) {
        index++;
        key = `${field.key} (${index})`;
      }
      used.add(key);
      return {
        ...field,
        key,
        metadata: { sourceKey: field.key, ...field.metadata, sourceAutoMapping: 'manual-only' },
      };
    });
  }
}
