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
} from './secret-fields';

const SECRET_KINDS = new Set(['Secret', 'ConfigMap']);

export function parseKubernetes(data: ArrayBuffer, fileName = 'Kubernetes export'): ParseResult {
  const text = decodeText(data);
  const objects = collectDocuments(text);
  const resources = objects.flatMap(expandLists).filter(isSecretLike);

  if (resources.length === 0) {
    throw new VaultFormatError(
      'No Kubernetes Secret or ConfigMap resources were found. Export with kubectl get secret -o yaml (or json).',
    );
  }

  const warnings: string[] = [];
  const skipped = objects
    .flatMap(expandLists)
    .filter((item) => isRecord(item) && !isSecretLike(item));
  if (skipped.length > 0) {
    warnings.push(
      `Skipped ${skipped.length} non-secret Kubernetes ${skipped.length === 1 ? 'resource' : 'resources'}.`,
    );
  }

  const entries = resources.map((resource, index) =>
    mapKubernetesResource(resource, index, warnings),
  );

  return {
    kind: 'kubernetes',
    name: stripExtension(fileName),
    entries,
    warnings,
  };
}

function collectDocuments(text: string): unknown[] {
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

function expandLists(value: unknown): LooseRecord[] {
  if (!isRecord(value)) return [];
  if (Array.isArray(value.items)) {
    return value.items.filter(isRecord);
  }
  return [value];
}

function isSecretLike(value: unknown): value is LooseRecord {
  return isRecord(value) && SECRET_KINDS.has(asString(value.kind));
}

function mapKubernetesResource(
  resource: LooseRecord,
  index: number,
  warnings: string[],
): Omit<VaultEntry, 'sourceId'> {
  const metadata = isRecord(resource.metadata) ? resource.metadata : {};
  const name = asString(metadata.name) || `untitled-${index + 1}`;
  const namespace = asString(metadata.namespace);
  const kind = asString(resource.kind) || 'Secret';
  const type = asString(resource.type);
  const secrets = readSecretData(resource, kind);

  if (
    type === 'kubernetes.io/dockerconfigjson' ||
    secrets['.dockerconfigjson'] ||
    secrets['.dockercfg']
  ) {
    return mapDockerSecret(resource, secrets, name, namespace, kind, index);
  }

  const notes = [kind !== 'Secret' ? kind : '', type && type !== 'Opaque' ? type : '']
    .filter(Boolean)
    .join(' · ');

  if (Object.keys(secrets).length === 0) {
    warnings.push(`${name} has no data keys.`);
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

function readSecretData(resource: LooseRecord, kind: string): Record<string, string> {
  const secrets: Record<string, string> = {};
  const encoded = isRecord(resource.data) ? resource.data : {};
  const plain = isRecord(resource.stringData)
    ? resource.stringData
    : kind === 'ConfigMap' && isRecord(resource.data)
      ? {}
      : {};
  const binary = isRecord(resource.binaryData) ? resource.binaryData : {};

  if (kind === 'ConfigMap') {
    for (const [key, value] of Object.entries(encoded)) {
      const text = asString(value);
      if (text) secrets[key] = text;
    }
  } else {
    for (const [key, value] of Object.entries(encoded)) {
      const raw = asString(value);
      if (!raw) continue;
      const decoded = decodeBase64(raw);
      secrets[decoded.binary ? `${key} (base64)` : key] = decoded.text;
    }
  }

  for (const [key, value] of Object.entries(plain)) {
    const text = asString(value);
    if (text) secrets[key] = text;
  }

  for (const [key, value] of Object.entries(binary)) {
    const raw = asString(value);
    if (!raw) continue;
    const decoded = decodeBase64(raw);
    secrets[decoded.binary ? `${key} (base64)` : key] = decoded.text;
  }

  return secrets;
}

function mapDockerSecret(
  resource: LooseRecord,
  secrets: Record<string, string>,
  name: string,
  namespace: string,
  kind: string,
  index: number,
): Omit<VaultEntry, 'sourceId'> {
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
    const decoded = decodeDockerAuth(auth);
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

function decodeDockerAuth(auth: LooseRecord): {
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
