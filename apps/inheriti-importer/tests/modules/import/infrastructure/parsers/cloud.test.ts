import { describe, expect, it } from 'vitest';
import { VaultFileImportParser } from '@modules/import/infrastructure/vault-file-import-parser';
import { importSessionFromVaultState } from '@modules/import/infrastructure/stores/vault-session-adapter';
import {
  entriesFromParse,
  initialVaultState,
} from '@modules/import/infrastructure/stores/vault-store';
import { parseCloud } from '@modules/import/infrastructure/parsers/cloud';

function buffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

describe('parseCloud', () => {
  it('retains exact JSON object numeric text before flattening can round it', async () => {
    const payload = '{"accountNumber":9223372036854775807,"password":"current"}';
    const data = buffer(JSON.stringify({ Name: 'cards', SecretString: payload }));
    const normalized = await new VaultFileImportParser().parse({ fileName: 'aws.json', data });
    expect(normalized.fields).toHaveLength(1);
    expect(normalized.fields[0].value.reveal()).toBe(payload);
    expect(normalized.fields[0].metadata).toMatchObject({ sourceAutoMapping: 'manual-only' });
  });

  it('reads AWS Secrets Manager get-secret-value JSON', () => {
    const result = parseCloud(
      buffer(
        JSON.stringify({
          ARN: 'arn:aws:secretsmanager:eu-west-1:123:secret:prod/db-Ab12',
          Name: 'prod/db',
          SecretString: JSON.stringify({ user_id: 'ada', passwd: 's3cret' }),
        }),
      ),
      'aws.json',
    );

    expect(result.kind).toBe('cloud');
    expect(result.entries[0]).toMatchObject({
      title: 'prod/db',
      username: 'ada',
      password: 's3cret',
      group: 'eu-west-1',
      sourceHints: { provider: 'aws' },
      fieldMetadata: { username: { sourceKey: 'user_id' }, password: { sourceKey: 'passwd' } },
    });
  });

  it('keeps guessed canonical aliases separate from native roles through both normalization paths', async () => {
    const fileName = 'aws.json';
    const data = buffer(
      JSON.stringify({
        Name: 'test-secret',
        SecretString: JSON.stringify({ user_id: 'example', passwd: 'example-secret' }),
      }),
    );
    const parsed = parseCloud(data, fileName);
    const normalized = await new VaultFileImportParser().parse({ fileName, data });
    const [entry] = entriesFromParse(parsed, normalized.source.id);
    const session = importSessionFromVaultState({
      ...initialVaultState,
      vaults: [{ ...normalized.source, kind: parsed.kind }],
      entries: [{ current: entry, original: entry }],
    });
    for (const fields of [normalized.fields, Object.values(session.fieldsById)]) {
      expect(fields.map(({ metadata }) => metadata)).toEqual([
        { sourceKey: 'user_id' },
        { sourceKey: 'passwd' },
      ]);
    }
  });

  it('recovers supported records across list siblings and reports unsupported member paths', () => {
    const result = parseCloud(
      buffer(
        JSON.stringify({
          SecretValues: [{ Name: 'first', SecretString: 'text' }, { Name: 'unsupported' }],
          items: [null, { Name: 'next', SecretBinary: 'AAE=' }],
        }),
      ),
    );

    expect(result.entries.map((entry) => entry.title)).toEqual(['first', 'next']);
    expect(result.entries[1].extraFields).toEqual([
      expect.objectContaining({
        value: 'AAE=',
        metadata: expect.objectContaining({
          sourceFieldType: 'base64',
          sourceAutoMapping: 'manual-only',
        }),
      }),
    ]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'cloud-unsupported-record',
        count: 1,
        sourcePath: ['SecretValues', '1'],
      }),
      expect.objectContaining({
        code: 'cloud-unsupported-record',
        count: 1,
        sourcePath: ['items', '0'],
      }),
    ]);
  });

  it('reads Azure Key Vault and Google Secret Manager exports', () => {
    const azure = parseCloud(
      buffer(
        JSON.stringify({
          id: 'https://ops-vault.vault.azure.net/secrets/smtp',
          value: 'mail-token',
          attributes: { enabled: true },
        }),
      ),
      'azure.json',
    );
    expect(azure.entries[0]).toMatchObject({
      title: 'smtp',
      password: '',
      group: 'ops-vault',
      sourceHints: { provider: 'azure' },
      extraFields: [{ key: 'smtp', value: 'mail-token' }],
    });

    const gcp = parseCloud(
      buffer(
        JSON.stringify({
          name: 'projects/demo/secrets/api-key/versions/1',
          payload: { data: Buffer.from('gcp-secret', 'utf8').toString('base64') },
        }),
      ),
      'gcp.json',
    );
    expect(gcp.entries[0]).toMatchObject({
      title: 'api-key',
      sourceHints: { provider: 'gcp' },
      password: '',
      extraFields: [{ key: 'api-key', value: 'gcp-secret' }],
    });
  });
});
