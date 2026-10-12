import * as kdbxweb from 'kdbxweb';
import { beforeAll, describe, expect, it } from 'vitest';
import { setupKdbxCrypto } from '@shared/infrastructure/crypto/crypto-engine';
import { parseKeepass } from '@modules/import/infrastructure/parsers/keepass';
import { VaultUnlockError } from '@modules/import/domain/vault';

beforeAll(async () => {
  await setupKdbxCrypto();
});

async function makeDatabase(password: string | null) {
  const credentials = new kdbxweb.Credentials(
    password ? kdbxweb.ProtectedValue.fromString(password) : null,
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
});
