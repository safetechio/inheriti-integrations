import { describe, expect, it } from 'vitest';
import { parseCloud } from '@modules/import/infrastructure/parsers/cloud';

function buffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

describe('parseCloud', () => {
  it('reads AWS Secrets Manager get-secret-value JSON', () => {
    const result = parseCloud(
      buffer(
        JSON.stringify({
          ARN: 'arn:aws:secretsmanager:eu-west-1:123:secret:prod/db-Ab12',
          Name: 'prod/db',
          SecretString: JSON.stringify({ username: 'ada', password: 's3cret' }),
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
    });
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
      password: '',
      extraFields: [{ key: 'api-key', value: 'gcp-secret' }],
    });
  });
});
