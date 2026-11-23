import { describe, expect, it } from 'vitest';
import { parseVaultFile } from '@modules/import/infrastructure/parsers';
import { detectVaultKind } from '@modules/import/infrastructure/parsers/utils/detect';
import { zipSync, strToU8 } from 'fflate';
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

  it('recognises ZIP signature before decoding text', () => {
    const zip = zipSync({ 'export.data': strToU8('{}') });
    expect(
      detectVaultKind(
        'backup.zip',
        zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength),
      ),
    ).toBe('onepassword');
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
  it('rejects disguised Excel archives and recognizes the 1Password CSV signature', async () => {
    const workbook = zipSync({
      '[Content_Types].xml': strToU8(''),
      'xl/workbook.xml': strToU8(''),
    });
    expect(() =>
      detectVaultKind(
        'disguised.zip',
        workbook.buffer.slice(workbook.byteOffset, workbook.byteOffset + workbook.byteLength),
      ),
    ).toThrow('Excel workbooks are unsupported');

    const csv = buffer(
      'Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes\r\nLogin,https://example.invalid,ada,"  password  ",otp,0,false,work,"first\nsecond"',
    );
    const parsed = await parseVaultFile(csv, 'export.csv');
    expect(parsed.kind).toBe('onepassword');
    expect(parsed.entries[0]).toMatchObject({
      password: '  password  ',
      notes: 'first\nsecond',
      extraFields: expect.arrayContaining([
        {
          key: 'OTPAuth',
          value: 'otp',
          metadata: { sourceKey: 'OTPAuth', sourceFieldType: 'otp' },
        },
        {
          key: 'Favorite',
          value: '0',
          metadata: { sourceKey: 'Favorite', sourceAutoMapping: 'manual-only' },
        },
        {
          key: 'Archived',
          value: 'false',
          metadata: { sourceKey: 'Archived', sourceAutoMapping: 'manual-only' },
        },
        {
          key: 'Tags',
          value: 'work',
          metadata: { sourceKey: 'Tags', sourceAutoMapping: 'manual-only' },
        },
      ]),
    });
  });
});
