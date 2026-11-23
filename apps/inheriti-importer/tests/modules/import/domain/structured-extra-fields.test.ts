import { describe, expect, it, vi } from 'vitest';
import {
  expandStructuredExtraFields,
  hasLosslessJsonNumbers,
} from '@modules/import/domain/structured-extra-fields';
import { createEmptyEntry, type ExtraField } from '@modules/import/domain/vault';
import { VaultFileImportParser } from '@modules/import/infrastructure/vault-file-import-parser';
import { importSessionFromVaultState } from '@modules/import/infrastructure/stores/vault-session-adapter';
import { initialVaultState } from '@modules/import/infrastructure/stores/vault-store';
import {
  bindingSourceIds,
  suggestWithFallback,
} from '@modules/mapping/application/suggestion-engine';
import { FieldAliasSuggestionStrategy } from '@modules/mapping/application/strategies/field-alias-strategy';

const { parseVaultFile } = vi.hoisted(() => ({ parseVaultFile: vi.fn() }));
vi.mock('@modules/import/infrastructure/parsers', () => ({ parseVaultFile }));

function json(key: string, value: unknown): ExtraField {
  return { key, value: JSON.stringify(value), metadata: { sourceFieldType: 'json' } };
}

function sessionFor(extraFields: ExtraField[], password = '') {
  const entry = createEmptyEntry({
    id: 'database',
    sourceId: 'vault',
    title: 'Database',
    extraFields,
    password,
  });
  return importSessionFromVaultState({
    ...initialVaultState,
    vaults: [{ id: 'vault', kind: 'vault', name: 'Vault', fileName: 'vault.json', importedAt: '' }],
    entries: [{ current: entry, original: entry }],
  });
}

function suggest(session: ReturnType<typeof sessionFor>) {
  return suggestWithFallback([new FieldAliasSuggestionStrategy()], {
    session,
    nodeIds: session.rootNodeIds,
    knownAssetTypes: new Set(['USER-PSWD', 'PLAIN-TEXT']),
  });
}

describe('structured source normalization', () => {
  it('keeps nested database records and array members disjoint', () => {
    const session = sessionFor([
      json('databases', {
        primary: { username: 'one', password: 'one-pass' },
        replicas: [
          { username: 'two', password: 'two-pass' },
          { username: 'three', password: 'three-pass' },
        ],
        incomplete: { username: 'no-password' },
        passwordOnly: { password: 'no-username' },
      }),
    ]);
    const results = suggest(session);
    expect(results).toHaveLength(4);
    expect(results.every(({ type }) => type === 'USER-PSWD')).toBe(true);
    const usedIds = results.flatMap(({ fieldBindings }) =>
      Object.values(fieldBindings).flatMap(bindingSourceIds),
    );
    expect(new Set(usedIds).size).toBe(usedIds.length);
    const pairs = results.map(({ fieldBindings }) =>
      ['secret.username', 'secret.password'].map((key) => {
        const binding = fieldBindings[key];
        return binding?.kind === 'source'
          ? session.fieldsById[binding.sourceFieldId].value.reveal()
          : undefined;
      }),
    );
    expect(pairs).toEqual([
      ['one', 'one-pass'],
      ['two', 'two-pass'],
      ['three', 'three-pass'],
      [undefined, 'no-username'],
    ]);
  });

  it('matches alias spellings only within the exact source record', () => {
    const session = sessionFor([
      json('same', { credential: { username: 'one' } }),
      json('same', { credential: { password: 'second-field' } }),
    ]);
    const [asset] = suggest(session);
    expect(Object.keys(asset.fieldBindings)).toEqual(['secret.password']);
  });

  it('extends the existing source path of structured fields', () => {
    const servers = json('servers', [{ username: 'user' }]);
    const [leaf] = expandStructuredExtraFields([
      {
        ...servers,
        metadata: { ...servers.metadata, sourcePath: '["overview","serverDetails","servers"]' },
      },
    ]);
    expect(leaf.metadata).toMatchObject({
      sourcePath: '["overview","serverDetails","servers",0,"username"]',
      sourceRecordPath: '["overview","serverDetails","servers",0]',
    });
    const [historical] = expandStructuredExtraFields([
      {
        ...servers,
        metadata: { ...servers.metadata, sourcePath: '["overview","history","servers"]' },
      },
    ]);
    expect(historical).toMatchObject({
      value: servers.value,
      metadata: { sourceAutoMapping: 'manual-only' },
    });
  });

  it('keeps JSON-shaped strings literal and history pending', () => {
    const password = '{"username":"inside","password":"inside"}';
    const history = {
      ...json('history', [{ password: 'old' }]),
      metadata: {
        sourceFieldType: 'json',
        sourceRole: 'password-history',
        sourceAutoMapping: 'manual-only',
      },
    };
    const session = sessionFor([history], password);
    const [asset] = suggest(session);
    expect(asset.type).toBe('PLAIN-TEXT');
    expect(asset.fieldBindings['secret.text']).toEqual({
      kind: 'source',
      sourceFieldId: 'database:password',
    });
    expect(session.fieldsById['database:password'].value.reveal()).toBe(password);
    expect(session.fieldsById['database:extra:history'].value.reveal()).toBe(history.value);

    const [placeholder] = suggest(sessionFor([history]));
    expect(placeholder.type).toBe('PLAIN-TEXT');
    expect(placeholder.fieldBindings).toEqual({});
  });

  it('preserves the original value when expansion would lose data or exceed a limit', () => {
    let deep: unknown = 'value';
    for (let index = 0; index < 20; index += 1) deep = { next: deep };
    for (const field of [
      json('data', { username: 'user', password: null }),
      json('data', { username: 'user', password: '' }),
      json('data', { username: 'user', password: {} }),
      json('data', { username: 'user', password: [] }),
      json('data', deep),
      json(
        'data',
        Array.from({ length: 196 }, () => 'value'),
      ),
      json('data', { username: 'user', password: 'a'.repeat(1024 * 1024) }),
    ]) {
      expect(expandStructuredExtraFields([field])).toEqual([
        {
          ...field,
          metadata: { ...field.metadata, sourceAutoMapping: 'manual-only' },
        },
      ]);
    }
  });

  it('checks numeric tokens without interpreting digits in quoted strings', () => {
    expect(
      hasLosslessJsonNumbers(
        JSON.stringify({
          username: 'literal ["9223372036854775807"]',
          password: '1.0000000000000001',
          offset: -Number.MAX_SAFE_INTEGER,
        }),
      ),
    ).toBe(true);
  });

  it.each(['9223372036854775807', '1.0000000000000001', '1.25'])(
    'retains the exact numeric token %s in an opaque AWS payload',
    async (token) => {
      const realParsers = await vi.importActual<
        typeof import('@modules/import/infrastructure/parsers')
      >('@modules/import/infrastructure/parsers');
      parseVaultFile.mockImplementationOnce(realParsers.parseVaultFile);
      const payload = `[{"accountNumber":${token}}]`;
      const { fields } = await new VaultFileImportParser().parse({
        data: new TextEncoder().encode(JSON.stringify({ Name: 'database', SecretString: payload }))
          .buffer,
        fileName: 'aws-secret.json',
      });
      expect(fields).toHaveLength(1);
      expect(fields[0].value.reveal()).toBe(payload);
      expect(fields[0].metadata).toMatchObject({
        sourceFieldType: 'json',
        sourceAutoMapping: 'manual-only',
      });
    },
  );

  it('normalizes identical values and provenance in both adapters', async () => {
    const extraFields = [
      {
        ...json('servers', [{ username: 'user', enabled: false, port: 42 }]),
        metadata: {
          sourceFieldType: 'json',
          sourceKey: 'hosts',
          sourceRole: 'password',
          sourceSection: 'Connection',
        },
      },
      { key: 'password', value: '{"password":"literal"}' },
    ];
    const entry = createEmptyEntry({ id: 'database', title: 'Database', extraFields });
    parseVaultFile.mockResolvedValueOnce({
      kind: 'vault',
      name: 'Vault',
      entries: [entry],
      warnings: [],
    });
    const file = await new VaultFileImportParser().parse({
      data: new ArrayBuffer(0),
      fileName: 'vault.json',
    });
    const normalized = (fields: typeof file.fields) =>
      fields.map(({ name, value, metadata }) => ({ name, value: value.reveal(), metadata }));
    const fields = normalized(file.fields);
    expect(fields).toEqual(normalized(Object.values(sessionFor(extraFields).fieldsById)));
    expect(fields[0]).toMatchObject({
      name: 'extra:servers[0].username',
      metadata: {
        sourceKey: 'username',
        sourcePath: '["hosts",0,"username"]',
        sourceRecordPath: '["hosts",0]',
        sourceSection: 'Connection',
      },
    });
    expect(fields[0].metadata.sourceRole).toBeUndefined();
    expect(fields.slice(1).map(({ value, metadata }) => [value, metadata.sourceFieldType])).toEqual(
      [
        ['false', 'boolean'],
        ['42', 'number'],
        ['{"password":"literal"}', undefined],
      ],
    );
  });
});
