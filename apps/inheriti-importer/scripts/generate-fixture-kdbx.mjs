import * as kdbxweb from 'kdbxweb';
import { argon2d, argon2id } from 'hash-wasm';
import { writeFile } from 'node:fs/promises';

function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

kdbxweb.CryptoEngine.argon2 = async (
  password,
  salt,
  memory,
  iterations,
  length,
  parallelism,
  type,
) => {
  const hashFn = type === kdbxweb.CryptoEngine.Argon2TypeArgon2d ? argon2d : argon2id;
  const hash = await hashFn({
    password: new Uint8Array(password),
    salt: new Uint8Array(salt),
    parallelism,
    iterations,
    memorySize: memory,
    hashLength: length,
    outputType: 'binary',
  });
  return toArrayBuffer(hash);
};

const PASSWORD = 'demo-password';

const credentials = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString(PASSWORD));
const db = kdbxweb.Kdbx.create(credentials, 'Demo Vault');

const eng = db.createGroup(db.getDefaultGroup(), 'Engineering');
const ops = db.createGroup(db.getDefaultGroup(), 'Operations');

function addEntry(group, { title, username, password, url, notes, tags, extra }) {
  const entry = db.createEntry(group);
  entry.fields.set('Title', title);
  entry.fields.set('UserName', username ?? '');
  entry.fields.set('Password', kdbxweb.ProtectedValue.fromString(password ?? ''));
  entry.fields.set('URL', url ?? '');
  entry.fields.set('Notes', notes ?? '');
  entry.tags = tags ?? [];
  for (const [key, value] of Object.entries(extra ?? {})) {
    entry.fields.set(key, value);
  }
  return entry;
}

addEntry(eng, {
  title: 'GitHub',
  username: 'ada.lovelace',
  password: 'gh_9f2c8a1e4d7b',
  url: 'https://github.com/eduorg',
  notes: 'Org owner account',
  tags: ['infra', 'git'],
  extra: { 'Recovery Codes': 'AB12-CD34-EF56' },
});

addEntry(eng, {
  title: 'Staging Database',
  username: 'staging_admin',
  password: 'Stg!Db_7Kx2vQ',
  url: 'postgres://staging.db.internal:5432/app',
  notes: 'Staging Postgres instance',
  tags: ['database', 'staging'],
});

addEntry(ops, {
  title: 'AWS Root Account',
  username: 'root@eduorg.example.com',
  password: 'R00t!Aws_5Lm9pZ',
  url: 'https://console.aws.amazon.com',
  notes: 'Break-glass root credentials — MFA required',
  tags: ['cloud', 'aws', 'critical'],
});

addEntry(ops, {
  title: 'Office WiFi',
  username: '',
  password: 'CoffeeShop#2026',
  url: '',
  notes: 'Guest network password',
  tags: ['office'],
});

const data = await db.save();
await writeFile(
  new URL('../tests/fixtures/sample-imports/keepass-demo-vault.kdbx', import.meta.url),
  Buffer.from(data),
);
console.log('wrote keepass-demo-vault.kdbx (password: ' + PASSWORD + ')');
