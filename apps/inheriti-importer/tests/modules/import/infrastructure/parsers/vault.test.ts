import { describe, expect, it } from 'vitest';
import { parseVault } from '@modules/import/infrastructure/parsers/vault';

function buffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

describe('parseVault', () => {
  it('reads a KV v2 vault kv get JSON export', () => {
    const result = parseVault(
      buffer(
        JSON.stringify({
          request_id: 'req-1',
          lease_id: '',
          data: {
            data: { username: 'ada', password: 's3cret' },
            metadata: { path: 'secret/data/github', version: 2 },
          },
        }),
      ),
      'github.json',
    );

    expect(result.kind).toBe('vault');
    expect(result.entries[0]).toMatchObject({
      title: 'github',
      username: 'ada',
      password: 's3cret',
    });
  });

  it('reads KV v1 responses and named path dumps', () => {
    const v1 = parseVault(
      buffer(
        JSON.stringify({
          request_id: 'req-2',
          data: { API_KEY: 'abc', url: 'https://api.example.com' },
        }),
      ),
      'v1.json',
    );
    expect(v1.entries[0]).toMatchObject({
      password: '',
      url: 'https://api.example.com',
    });
    expect(v1.entries[0].extraFields).toEqual([{ key: 'API_KEY', value: 'abc' }]);

    const named = parseVault(
      buffer(
        JSON.stringify({
          'secret/ops/db': { username: 'root', password: 'hunter2' },
          'secret/ops/vpn': {
            request_id: 'req-3',
            data: { data: { password: 'tunnel' } },
          },
        }),
      ),
      'dump.json',
    );
    expect(named.entries).toHaveLength(2);
    expect(named.entries.map((entry) => entry.title).sort()).toEqual(['db', 'vpn']);
    expect(named.entries.find((entry) => entry.title === 'db')?.password).toBe('hunter2');
  });

  it('preserves an ambiguous secret field as an extra', () => {
    const result = parseVault(
      buffer(JSON.stringify({ request_id: 'req-4', data: { secret: 'opaque' } })),
      'secret.json',
    );

    expect(result.entries[0].password).toBe('');
    expect(result.entries[0].extraFields).toEqual([{ key: 'secret', value: 'opaque' }]);
  });

  it('preserves nested KV values as JSON text', () => {
    const result = parseVault(
      buffer(JSON.stringify({ request_id: 'req-5', data: { config: { region: 'eu' } } })),
      'nested.json',
    );

    expect(result.entries[0].extraFields).toEqual([{ key: 'config', value: '{"region":"eu"}' }]);
  });

  it('rejects malformed YAML documents', () => {
    expect(() => parseVault(buffer('request_id: req\ndata: [broken\n'), 'broken.yaml')).toThrow(
      'not valid JSON or YAML',
    );
  });
});
