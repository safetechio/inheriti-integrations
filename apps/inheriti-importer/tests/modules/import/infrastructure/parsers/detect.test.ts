import { describe, expect, it } from 'vitest';
import { detectVaultKind } from '@modules/import/infrastructure/parsers/detect';
import { VaultFormatError } from '@modules/import/domain/vault';

function buffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

describe('detectVaultKind', () => {
  it('recognises kubernetes, vault, dotenv, cloud, and passbolt files', () => {
    expect(
      detectVaultKind(
        'secret.yaml',
        buffer('apiVersion: v1\nkind: Secret\nmetadata:\n  name: x\n'),
      ),
    ).toBe('kubernetes');

    expect(
      detectVaultKind(
        'vault.json',
        buffer(JSON.stringify({ request_id: '1', data: { data: { a: 'b' }, metadata: {} } })),
      ),
    ).toBe('vault');

    expect(detectVaultKind('.env', buffer('API_KEY=abc\n'))).toBe('dotenv');

    expect(
      detectVaultKind(
        'aws.json',
        buffer(JSON.stringify({ Name: 'db', SecretString: '{"password":"x"}' })),
      ),
    ).toBe('cloud');

    expect(
      detectVaultKind(
        'passbolt.json',
        buffer(JSON.stringify([{ name: 'GitHub', username: 'ada', secret: 'x' }])),
      ),
    ).toBe('passbolt');
  });

  it('rejects unknown files', () => {
    expect(() => detectVaultKind('notes.txt', buffer('hello'))).toThrow(VaultFormatError);
  });

  it('recognises named-path Vault YAML while keeping Kubernetes priority', () => {
    expect(
      detectVaultKind(
        'vault.yaml',
        buffer('secret/ops/db:\n  username: root\n  password: hunter2\n'),
      ),
    ).toBe('vault');
    expect(
      detectVaultKind(
        'secret.yaml',
        buffer('apiVersion: v1\nkind: Secret\ndata:\n  secret/ops/db: dmFsdWU=\n'),
      ),
    ).toBe('kubernetes');
    expect(detectVaultKind('vault.yaml', buffer('secret/app:\n  config:\n    host: db\n'))).toBe(
      'vault',
    );
  });

  it('does not classify malformed YAML as Kubernetes or Vault', () => {
    expect(() => detectVaultKind('broken.yaml', buffer('kind: Secret\ndata: [broken\n'))).toThrow(
      'Could not recognise',
    );
  });
});
