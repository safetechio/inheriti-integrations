import * as kdbxweb from 'kdbxweb';
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { setupKdbxCrypto } from '@shared/infrastructure/crypto/crypto-engine';
import { parseKeepass } from '@modules/import/infrastructure/parsers/keepass';
import { VaultUnlockError } from '@modules/import/domain/vault';

beforeAll(async () => {
  await setupKdbxCrypto();
});

async function makeDatabase(password: string | null, keyFile?: ArrayBuffer) {
  const credentials = new kdbxweb.Credentials(
    password ? kdbxweb.ProtectedValue.fromString(password) : null,
    keyFile?.slice(0),
  );
  const db = kdbxweb.Kdbx.create(credentials, 'Ops vault');
  const group = db.createGroup(db.getDefaultGroup(), 'Engineering');
  const entry = db.createEntry(group);
  entry.fields.set('Title', 'GitHub');
  entry.fields.set('UserName', 'ada');
  entry.fields.set('Password', kdbxweb.ProtectedValue.fromString('s3cret'));
  entry.fields.set('URL', 'https://github.com');
  entry.fields.set('Notes', 'org owner');
  entry.fields.set('Token', 'extra-token');
  entry.tags = ['infra', 'git'];
  return db.save();
}

describe('parseKeepass', () => {
  const keyFile = new Uint8Array(32).fill(7).buffer;
  const wrongKeyFile = new Uint8Array(32).fill(8).buffer;

  it('reports failed credentials for the real demo vault and then opens it on retry', async () => {
    const bytes = await readFile(
      new URL('../../../../fixtures/sample-imports/keepass-demo-vault.kdbx', import.meta.url),
    );
    const data = Uint8Array.from(bytes).buffer;

    await expect(parseKeepass(data)).rejects.toThrow(
      'This KeePass database is protected. Enter the master password to unlock it.',
    );
    await expect(parseKeepass(data, { password: 'wrong' })).rejects.toThrow(
      'Could not open this KeePass database. Check the master password or key file.',
    );
    expect((await parseKeepass(data, { password: 'demo-password' })).entries).toHaveLength(4);
  });

  it('reads a password-protected kdbx file', async () => {
    const data = await makeDatabase('master-key');
    const result = await parseKeepass(data, { password: 'master-key', fileName: 'ops.kdbx' });

    expect(result.kind).toBe('keepass');
    expect(result.name).toBe('Ops vault');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      title: 'GitHub',
      username: 'ada',
      password: 's3cret',
      url: 'https://github.com',
      notes: 'org owner',
      group: 'Engineering',
    });
    expect(result.entries[0].tags).toEqual(['infra', 'git']);
    expect(result.entries[0].extraFields).toContainEqual({ key: 'Token', value: 'extra-token' });
  });

  it('asks for a password when the database is locked', async () => {
    const data = await makeDatabase('master-key');
    await expect(parseKeepass(data, { fileName: 'ops.kdbx' })).rejects.toBeInstanceOf(
      VaultUnlockError,
    );
  });

  it('opens a vault protected only by a key file', async () => {
    const data = await makeDatabase(null, keyFile);
    const result = await parseKeepass(data, { keyFile });
    expect(result.entries).toHaveLength(1);
    await expect(parseKeepass(data, { keyFile: wrongKeyFile })).rejects.toBeInstanceOf(
      VaultUnlockError,
    );
  });

  it('requires both password and key file when both protect the vault', async () => {
    const data = await makeDatabase('synthetic-password', keyFile);
    expect(
      (await parseKeepass(data, { password: 'synthetic-password', keyFile })).entries,
    ).toHaveLength(1);
    await expect(parseKeepass(data, { password: 'wrong', keyFile })).rejects.toBeInstanceOf(
      VaultUnlockError,
    );
    await expect(
      parseKeepass(data, { password: 'synthetic-password', keyFile: wrongKeyFile }),
    ).rejects.toBeInstanceOf(VaultUnlockError);
  });

  it('can retry a wrong password with the same selected key file bytes', async () => {
    const data = await makeDatabase('synthetic-password', keyFile);
    const selectedKeyFile = keyFile.slice(0);
    await expect(
      parseKeepass(data, { password: 'wrong', keyFile: selectedKeyFile }),
    ).rejects.toBeInstanceOf(VaultUnlockError);
    expect(
      (await parseKeepass(data, { password: 'synthetic-password', keyFile: selectedKeyFile }))
        .entries,
    ).toHaveLength(1);
  });

  it('preserves a whitespace-only password exactly', async () => {
    const data = await makeDatabase(' ');
    expect((await parseKeepass(data, { password: ' ' })).entries).toHaveLength(1);
    await expect(parseKeepass(data, { password: '' })).rejects.toBeInstanceOf(VaultUnlockError);
  });
});
