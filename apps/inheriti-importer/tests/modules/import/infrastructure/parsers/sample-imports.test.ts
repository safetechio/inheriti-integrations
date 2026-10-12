import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseVaultFile } from '@modules/import/infrastructure/parsers';
import type { VaultSourceKind } from '@modules/import/domain/vault';

const fixtureDirectory = resolve(process.cwd(), 'tests/fixtures/sample-imports');
const fixtures: Array<[string, VaultSourceKind, number]> = [
  ['.env.production', 'dotenv', 4],
  ['aws-secretsmanager.json', 'cloud', 3],
  ['azure-keyvault-secret.json', 'cloud', 1],
  ['gcp-secretmanager.json', 'cloud', 1],
  ['k8s-secrets.json', 'kubernetes', 2],
  ['k8s-secrets.yaml', 'kubernetes', 5],
  ['keepass-demo-vault.kdbx', 'keepass', 4],
  ['passbolt-export.csv', 'passbolt', 3],
  ['passbolt-export.json', 'passbolt', 3],
  ['sample.env', 'dotenv', 6],
  ['vault-kv-dump.json', 'vault', 1],
  ['vault-kv-v1.yaml', 'vault', 1],
];

async function parseFixture(fileName: string, kind: VaultSourceKind) {
  const file = readFileSync(resolve(fixtureDirectory, fileName));
  const data = Uint8Array.from(file).buffer;
  const secrets = kind === 'keepass' ? { password: 'demo-password' } : {};
  return parseVaultFile(data, fileName, secrets);
}

describe('sample import fixtures', () => {
  it.each(fixtures)(
    'parses every entry in %s through the production dispatcher',
    async (fileName, kind, entryCount) => {
      const result = await parseFixture(fileName, kind);

      expect(result.kind).toBe(kind);
      expect(result.entries).toHaveLength(entryCount);
    },
  );

  it('preserves representative decoded values from the added variants', async () => {
    const [aws, gcp, kubernetesJson, kubernetesYaml, vault] = await Promise.all([
      parseFixture('aws-secretsmanager.json', 'cloud'),
      parseFixture('gcp-secretmanager.json', 'cloud'),
      parseFixture('k8s-secrets.json', 'kubernetes'),
      parseFixture('k8s-secrets.yaml', 'kubernetes'),
      parseFixture('vault-kv-v1.yaml', 'vault'),
    ]);

    expect(aws.entries.find((entry) => entry.title === 'eduorg/signing-key')?.extraFields).toEqual([
      { key: 'eduorg/signing-key', value: 'binary_synthetic_key_7a2d' },
    ]);
    expect(gcp.entries[0]?.extraFields).toEqual(
      expect.arrayContaining([
        { key: 'client_id', value: 'gcp-demo-client' },
        { key: 'client_secret', value: 'gcp_fake_secret_7f2a' },
      ]),
    );
    expect(kubernetesJson.entries[0]).toMatchObject({
      username: 'api-user',
      password: 'BasicAuth!42',
    });
    expect(
      kubernetesYaml.entries.find((entry) => entry.title === 'ingress-tls')?.extraFields,
    ).toEqual(expect.arrayContaining([{ key: 'tls.crt', value: 'FAKE CERTIFICATE DATA' }]));
    expect(vault.entries[0]).toMatchObject({
      username: 'notification-worker',
      password: 'SyntheticVaultPassword_8d2f',
    });
  });
});
