import { describe, expect, it } from 'vitest';
import { parsePassbolt } from '@modules/import/infrastructure/parsers/passbolt';

function buffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

describe('parsePassbolt', () => {
  it('reads a JSON resource array', () => {
    const result = parsePassbolt(
      buffer(
        JSON.stringify([
          {
            id: 'res-1',
            name: 'GitHub',
            username: 'ada',
            uri: 'https://github.com',
            description: 'org account',
            secret: 's3cret',
          },
        ]),
      ),
      'passbolt.json',
    );

    expect(result.kind).toBe('passbolt');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      title: 'GitHub',
      username: 'ada',
      url: 'https://github.com',
      password: 's3cret',
      notes: 'org account',
    });
  });

  it('reads nested resources and CSV exports', () => {
    const json = parsePassbolt(
      buffer(JSON.stringify({ resources: [{ Name: 'VPN', Username: 'root', Secret: 'hunter2' }] })),
      'export.json',
    );
    expect(json.entries[0].title).toBe('VPN');
    expect(json.entries[0].password).toBe('hunter2');

    const csv = parsePassbolt(
      buffer(
        'Name,Username,URI,Description,Secret\nAWS,admin,https://aws.amazon.com,root,abc123\n',
      ),
      'passbolt.csv',
    );
    expect(csv.kind).toBe('passbolt');
    expect(csv.entries[0]).toMatchObject({
      title: 'AWS',
      username: 'admin',
      url: 'https://aws.amazon.com',
      password: 'abc123',
    });
  });

  it('does not treat a nested description as a password', () => {
    const result = parsePassbolt(
      buffer(
        JSON.stringify([{ name: 'Documented resource', secret: { description: 'metadata' } }]),
      ),
      'passbolt.json',
    );

    expect(result.entries[0].password).toBe('');
    expect(result.entries[0].extraFields).toEqual([
      { key: 'secret.description', value: 'metadata' },
    ]);
    expect(result.warnings).toHaveLength(1);
  });
});
