import { describe, expect, it } from 'vitest';
import { parseKubernetes } from '@modules/import/infrastructure/parsers/kubernetes';
import { decodeBase64 } from '@modules/import/infrastructure/parsers/utils/secret-fields';

function buffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

function b64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

describe('parseKubernetes', () => {
  it('does not parse raw JSON from an invalid-base64 or shadowed Docker data field', () => {
    const raw = JSON.stringify({
      auths: { 'registry.invalid': { username: 'old-user', password: 'old-password' } },
    });
    const result = parseKubernetes(
      buffer(
        JSON.stringify({
          kind: 'Secret',
          metadata: { name: 'docker-override' },
          type: 'kubernetes.io/dockerconfigjson',
          stringData: { '.dockerconfigjson': '' },
          data: { '.dockerconfigjson': raw },
        }),
      ),
      'docker.json',
    );
    expect(result.entries[0].password).toBe('');
    expect(result.entries[0].extraFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: raw,
          metadata: expect.objectContaining({ sourceAutoMapping: 'manual-only' }),
        }),
      ]),
    );
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'k8s-docker-unreadable-payload' })]),
    );
  });

  it('does not infer superseded data when stringData explicitly overrides it with empty text', () => {
    const result = parseKubernetes(
      buffer(
        JSON.stringify({
          kind: 'Secret',
          metadata: { name: 'empty-override' },
          stringData: { password: '' },
          data: { password: b64('superseded') },
        }),
      ),
      'empty.json',
    );
    expect(result.entries[0].password).toBe('');
    expect(result.entries[0].extraFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: 'superseded',
          metadata: expect.objectContaining({ sourceAutoMapping: 'manual-only' }),
        }),
      ]),
    );
  });

  it('retains lower-priority data conflicts for manual mapping without hiding the primary login', () => {
    const result = parseKubernetes(
      buffer(
        JSON.stringify({
          kind: 'Secret',
          metadata: { name: 'collision' },
          stringData: { username: 'current-user', password: 'current-password' },
          data: { password: b64('alternate-password') },
        }),
      ),
      'collision.json',
    );
    expect(result.entries[0].password).toBe('current-password');
    expect(result.entries[0].extraFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'password (2)',
          value: 'alternate-password',
          metadata: expect.objectContaining({
            sourceAutoMapping: 'manual-only',
            sourcePath: '["data","password"]',
          }),
        }),
      ]),
    );
  });

  it('reads an Opaque Secret from YAML', () => {
    const result = parseKubernetes(
      buffer(`apiVersion: v1
kind: Secret
metadata:
  name: db-credentials
  namespace: production
type: Opaque
data:
  username: ${b64('ada')}
  password: ${b64('s3cret')}
`),
      'db-credentials.yaml',
    );

    expect(result.kind).toBe('kubernetes');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      title: 'db-credentials',
      username: 'ada',
      password: 's3cret',
      group: 'production',
      sourceHints: { category: 'Secret' },
    });
  });

  it('reads stringData, Lists, and docker registry secrets', () => {
    const docker = JSON.stringify({
      auths: {
        'https://index.docker.io/v1/': { username: 'ada', password: 'harbor' },
      },
    });

    const listed = parseKubernetes(
      buffer(
        JSON.stringify({
          kind: 'List',
          items: [
            {
              kind: 'Secret',
              metadata: { name: 'api', namespace: 'default' },
              stringData: { token: 'abc123' },
            },
            {
              kind: 'Secret',
              metadata: { name: 'registry' },
              type: 'kubernetes.io/dockerconfigjson',
              data: { '.dockerconfigjson': b64(docker) },
            },
            { kind: 'Deployment', metadata: { name: 'skip-me' } },
          ],
        }),
      ),
      'secrets.json',
    );

    expect(listed.entries).toHaveLength(2);
    expect(listed.entries[0]).toMatchObject({ title: 'api', password: '' });
    expect(listed.entries[0].extraFields).toEqual([{ key: 'token', value: 'abc123' }]);
    expect(listed.entries[1]).toMatchObject({
      title: 'registry',
      username: 'ada',
      password: 'harbor',
      url: 'https://index.docker.io/v1/',
    });
    expect(listed.warnings[0]).toMatch(/Skipped 1/);
  });

  it('reads multi-document YAML including ConfigMaps', () => {
    const result = parseKubernetes(
      buffer(`apiVersion: v1
kind: Secret
metadata:
  name: tls
type: kubernetes.io/tls
data:
  tls.crt: ${b64('CERT')}
  tls.key: ${b64('KEY')}
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
  namespace: default
data:
  LOG_LEVEL: info
`),
      'bundle.yaml',
    );

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].extraFields).toEqual(
      expect.arrayContaining([
        { key: 'tls.crt', value: 'CERT' },
        { key: 'tls.key', value: 'KEY' },
      ]),
    );
    expect(result.entries[1]).toMatchObject({
      title: 'app-config',
      sourceHints: { category: 'ConfigMap' },
      password: '',
    });
    expect(result.entries[1].extraFields).toEqual([{ key: 'LOG_LEVEL', value: 'info' }]);
  });

  it('preserves Docker registry metadata fields', () => {
    const result = parseKubernetes(
      buffer(
        JSON.stringify({
          kind: 'Secret',
          metadata: { name: 'registry' },
          type: 'kubernetes.io/dockerconfigjson',
          data: {
            '.dockerconfigjson': b64(
              JSON.stringify({
                auths: {
                  'registry.example.com': {
                    username: 'ada',
                    password: 'secret',
                    identitytoken: 'opaque-token',
                    email: 'ada@example.com',
                  },
                },
              }),
            ),
          },
        }),
      ),
      'registry.json',
    );

    expect(result.entries[0].extraFields).toEqual(
      expect.arrayContaining([
        { key: 'identitytoken', value: 'opaque-token' },
        { key: 'email', value: 'ada@example.com' },
      ]),
    );
  });

  it('keeps malformed Docker payloads for manual mapping alongside sibling keys', () => {
    const result = parseKubernetes(
      buffer(
        JSON.stringify({
          kind: 'Secret',
          type: 'kubernetes.io/dockerconfigjson',
          data: { '.dockerconfigjson': b64('{broken'), sibling: b64('retained') },
        }),
      ),
    );

    expect(result.entries[0].extraFields).toMatchObject([
      {
        key: '.dockerconfigjson',
        value: '{broken',
        metadata: { sourceAutoMapping: 'manual-only' },
      },
      { key: 'sibling', value: 'retained' },
    ]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'k8s-docker-unreadable-payload',
        count: 1,
        sourcePath: ['data', '.dockerconfigjson'],
      }),
    ]);
  });

  it('retains unconsumed Docker config and auth values with collision-safe labels', () => {
    const result = parseKubernetes(
      buffer(
        JSON.stringify({
          kind: 'Secret',
          stringData: {
            email: 'sibling',
            '.dockerconfigjson': JSON.stringify({
              credsStore: 'helper',
              auths: {
                registry: {
                  username: 'explicit',
                  password: 'pass',
                  auth: b64('conflicting:other'),
                  email: 'registry email',
                },
                unsupported: 'raw member',
              },
            }),
          },
        }),
      ),
    );

    const [entry] = result.entries;
    expect(entry).toMatchObject({ username: 'explicit', password: 'pass', url: 'registry' });
    expect(entry.extraFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'email', value: 'sibling' }),
        expect.objectContaining({ key: 'email (2)', value: 'registry email' }),
        expect.objectContaining({ key: 'credsStore', value: 'helper' }),
        expect.objectContaining({
          key: 'auth',
          value: b64('conflicting:other'),
          metadata: expect.objectContaining({ sourceAutoMapping: 'manual-only' }),
        }),
        expect.objectContaining({ key: 'unsupported', value: 'raw member' }),
      ]),
    );
  });

  it('rejects malformed YAML documents', () => {
    expect(() =>
      parseKubernetes(buffer('kind: Secret\nmetadata: [broken\n'), 'broken.yaml'),
    ).toThrow('not valid YAML or JSON');
  });

  it('keeps invalid UTF-8 base64 encoded values intact', () => {
    const encoded = Buffer.from([0xff, 0xfe]).toString('base64');
    expect(decodeBase64(encoded)).toEqual({ text: encoded, binary: true });
    const result = parseKubernetes(
      buffer(
        JSON.stringify({
          kind: 'ConfigMap',
          binaryData: { 'blob.bin': encoded },
        }),
      ),
    );
    expect(result.entries[0].extraFields).toEqual([
      {
        key: 'blob.bin (base64)',
        value: encoded,
        metadata: {
          sourceKey: 'blob.bin',
          sourceFieldType: 'base64',
          sourcePath: '["binaryData","blob.bin"]',
          sourceAutoMapping: 'manual-only',
        },
      },
    ]);
  });
});
