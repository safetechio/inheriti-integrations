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
  it('preserves exact nonempty text, falsy primitives, and JSON while retaining duplicate labels', () => {
    const result = parsePassbolt(
      buffer(
        JSON.stringify([
          {
            name: 'Resource',
            username: '  name  ',
            secret: {
              password: '  secret  ',
              description: '   ',
              flag: false,
              structure: ['x', null],
            },
            'secret.description': '  second   ',
            zero: 0,
            attrs: { property: ['a', false] },
          },
        ]),
      ),
      'passbolt.json',
    );
    expect(result.entries[0]).toMatchObject({
      username: '  name  ',
      password: '  secret  ',
      extraFields: [
        { key: 'secret.description', value: '  second   ' },
        { key: 'zero', value: '0' },
        { key: 'attrs', value: '{"property":["a",false]}' },
        { key: 'secret.description', value: '   ' },
        { key: 'secret.flag', value: 'false' },
        { key: 'secret.structure', value: '["x",null]' },
      ],
    });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ kind: 'transformed', count: 4, entryId: result.entries[0].id }),
    ]);
  });

  it('rejects unrelated CSV headers and generic JSON records', () => {
    expect(() => parsePassbolt(buffer('Name,Quantity\nGloves,2'), 'stock.csv')).toThrow(
      'Unsupported CSV headers',
    );
    expect(() => parsePassbolt(buffer('[{"name":"Gloves","quantity":2}]'), 'stock.json')).toThrow(
      'No Passbolt resources',
    );
  });
});
