import { parseAllDocuments } from 'yaml';
import { VaultFormatError, type ParseResult, type VaultEntry } from '@modules/import/domain/vault';
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
    const secrets = this.readSecretData(resource, kind);

    if (
      type === 'kubernetes.io/dockerconfigjson' ||
      secrets['.dockerconfigjson'] ||
      secrets['.dockercfg']
    ) {
      return this.mapDockerSecret(resource, secrets, name, namespace, kind, index);
    }

    const notes = [kind !== 'Secret' ? kind : '', type && type !== 'Opaque' ? type : '']
      .filter(Boolean)
      .join(' · ');

    if (Object.keys(secrets).length === 0) {
      this.warnings.push(`${name} has no data keys.`);
    }

    return entryFromSecrets(secrets, {
      id: asString(metadata.uid) || `k8s-${index + 1}`,
      title: name,
      group: namespace,
      tags: [kind.toLowerCase(), type.replace(/^kubernetes\.io\//, '')].filter(
        (tag) => tag && tag !== 'opaque',
      ),
      notes,
    });
  }

  private readSecretData(resource: LooseRecord, kind: string): Record<string, string> {
    const secrets: Record<string, string> = {};
    const encoded = isRecord(resource.data) ? resource.data : {};
    const plain = isRecord(resource.stringData) ? resource.stringData : {};
    const binary = isRecord(resource.binaryData) ? resource.binaryData : {};

    if (kind === 'ConfigMap') this.copyPlainValues(encoded, secrets);
    else this.copyBase64Values(encoded, secrets);
    this.copyPlainValues(plain, secrets);
    this.copyBase64Values(binary, secrets);

    return secrets;
  }

  private copyPlainValues(source: LooseRecord, target: Record<string, string>): void {
    for (const [key, value] of Object.entries(source)) {
      const text = asString(value);
      if (text) target[key] = text;
    }
  }

  private copyBase64Values(source: LooseRecord, target: Record<string, string>): void {
    for (const [key, value] of Object.entries(source)) {
      const raw = asString(value);
      if (!raw) continue;
      const decoded = decodeBase64(raw);
      target[decoded.binary ? `${key} (base64)` : key] = decoded.text;
    }
  }

  private mapDockerSecret(
    resource: LooseRecord,
    secrets: Record<string, string>,
    name: string,
    namespace: string,
    kind: string,
    index: number,
  ): Omit<VaultEntry, 'sourceId'> {
    // Use the first registry as the primary credential and retain the rest as labeled fields.
    const payload = secrets['.dockerconfigjson'] || secrets['.dockercfg'] || '';
    const parsed = tryParseJson(payload);
    const auths =
      isRecord(parsed) && isRecord(parsed.auths) ? parsed.auths : isRecord(parsed) ? parsed : {};
    const registries = Object.entries(auths).filter(([, auth]) => isRecord(auth));

    const extra: Record<string, string> = {};
    let username = '';
    let password = '';
    let url = '';

    registries.forEach(([registry, auth], authIndex) => {
      if (!isRecord(auth)) return;
      const decoded = this.decodeDockerAuth(auth);
      if (authIndex === 0) {
        url = registry;
        username = decoded.username;
        password = decoded.password;
        Object.assign(extra, decoded.extra);
      } else {
        extra[`${registry} username`] = decoded.username;
        extra[`${registry} password`] = decoded.password;
        for (const [key, value] of Object.entries(decoded.extra)) {
          extra[`${registry} ${key}`] = value;
        }
      }
    });

    const metadata = isRecord(resource.metadata) ? resource.metadata : {};
    const entry = entryFromSecrets(
      { username, password, url, ...extra },
      {
        id: asString(metadata.uid) || `k8s-${index + 1}`,
        title: name,
        group: namespace,
        tags: [kind.toLowerCase(), 'dockerconfigjson'],
        notes: 'kubernetes.io/dockerconfigjson',
      },
    );
    if (!entry.username) entry.username = username;
    if (!entry.password) entry.password = password;
    if (!entry.url) entry.url = url;
    return entry;
  }

  private decodeDockerAuth(auth: LooseRecord): {
    username: string;
    password: string;
    extra: Record<string, string>;
  } {
    let username = asString(auth.username);
    let password = asString(auth.password);
    const token = asString(auth.auth);
    if ((!username || !password) && token) {
      const decoded = decodeBase64(token).text;
      const split = decoded.indexOf(':');
      if (split >= 0) {
        username = username || decoded.slice(0, split);
        password = password || decoded.slice(split + 1);
      }
    }
    const extra: Record<string, string> = {};
    for (const [key, value] of Object.entries(auth)) {
      if (key === 'username' || key === 'password' || key === 'auth') continue;
      const text = asString(value);
      if (text) extra[key] = text;
    }
    return { username, password, extra };
  }
}
