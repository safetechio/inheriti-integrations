import { describe, expect, it } from 'vitest';
import { SensitiveValue, type ImportSession } from '@modules/import/domain/import-model';
import { parseDotenv } from '@modules/import/infrastructure/parsers/dotenv';
import { importSessionFromVaultState } from '@modules/import/infrastructure/stores/vault-session-adapter';
import {
  entriesFromParse,
  initialVaultState,
} from '@modules/import/infrastructure/stores/vault-store';
import { FieldAliasSuggestionStrategy } from '@modules/mapping/application/strategies/field-alias-strategy';
import {
  suggestedAssetToDraft,
  suggestWithFallback,
} from '@modules/mapping/application/suggestion-engine';

function sessionWith(entryName: string, fields: Record<string, string>): ImportSession {
  const fieldsById: ImportSession['fieldsById'] = {};
  const fieldIds: string[] = [];
  Object.entries(fields).forEach(([name, value], i) => {
    const id = `f${i}`;
    fieldIds.push(id);
    fieldsById[id] = {
      id,
      sourceId: 's1',
      parentNodeId: 'e1',
      sourcePath: ['root', entryName, name],
      name,
      value: new SensitiveValue(value),
      metadata: {},
    };
  });

  return {
    id: 'sess',
    sources: [],
    rootNodeIds: ['g1'],
    nodesById: {
      g1: {
        id: 'g1',
        sourceId: 's1',
        parentNodeId: null,
        kind: 'group',
        name: 'root',
        path: [],
        childNodeIds: ['e1'],
        fieldIds: [],
      },
      e1: {
        id: 'e1',
        sourceId: 's1',
        parentNodeId: 'g1',
        kind: 'entry',
        name: entryName,
        path: ['root', entryName],
        childNodeIds: [],
        fieldIds,
      },
    },
    fieldsById,
  };
}

const KNOWN = new Set([
  'USER-PSWD',
  'API-KEY',
  'PRIVATE-KEY',
  'PLAIN-TEXT',
  'PIN-CODE',
  'RECOVERY-CODE',
]);
const strategy = new FieldAliasSuggestionStrategy();

function buffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

describe('FieldAliasSuggestionStrategy', () => {
  it('maps username + password onto USER-PSWD', () => {
    const session = sessionWith('GitHub', {
      username: 'octo',
      password: 's3cret',
      url: 'github.com',
    });
    const [suggestion] = strategy.suggest({
      session,
      nodeIds: ['g1'],
      knownAssetTypes: KNOWN,
    }).assets;
    expect(suggestion?.type).toBe('USER-PSWD');
    expect(suggestion?.name).toBe('GitHub');
    expect(Object.keys(suggestion!.fieldBindings)).toEqual(
      expect.arrayContaining(['secret.username', 'secret.password', 'secret.appOrWebsite']),
    );
    expect(suggestion?.confidence).toBeGreaterThan(0.5);
  });

  it('maps a lone api key onto API-KEY', () => {
    const session = sessionWith('OpenAI', { service: 'OpenAI', token: 'sk-abc' });
    const [suggestion] = strategy.suggest({
      session,
      nodeIds: ['g1'],
      knownAssetTypes: KNOWN,
    }).assets;
    expect(suggestion?.type).toBe('API-KEY');
  });

  it('keeps paired AWS access credentials as plain text', () => {
    const session = sessionWith('AWS', {
      AWS_ACCESS_KEY_ID: 'AKIA123',
      AWS_SECRET_ACCESS_KEY: 'secret123',
    });
    const [suggestion] = suggestWithFallback([strategy], {
      session,
      nodeIds: ['g1'],
      knownAssetTypes: KNOWN,
    });
    expect(suggestion?.type).toBe('PLAIN-TEXT');
    expect(suggestion?.fieldBindings['secret.text']).toMatchObject({ kind: 'sources' });
    expect(suggestion?.fieldBindings['secret.text']).toMatchObject({
      sources: [{ name: 'AWS_ACCESS_KEY_ID' }, { name: 'AWS_SECRET_ACCESS_KEY' }],
    });
  });

  it('matches prefixed extras by exact name or delimited suffix only', () => {
    for (const name of ['extra:API_KEY', 'extra:API_TOKEN', 'extra:STRIPE_SECRET_KEY']) {
      const [suggestion] = strategy.suggest({
        session: sessionWith('Service', { [name]: 'value' }),
        nodeIds: ['g1'],
        knownAssetTypes: KNOWN,
      }).assets;
      expect(suggestion?.type).toBe('API-KEY');
    }

    const [password] = strategy.suggest({
      session: sessionWith('Database', { 'extra:DATABASE_PASSWORD': 'value' }),
      nodeIds: ['g1'],
      knownAssetTypes: KNOWN,
    }).assets;
    expect(password?.type).toBe('USER-PSWD');
    const arbitrary = sessionWith('Animal', { 'extra:monkey': 'value' });
    expect(
      strategy.suggest({ session: arbitrary, nodeIds: ['g1'], knownAssetTypes: KNOWN }).assets,
    ).toEqual([]);
    expect(
      suggestWithFallback([], { session: arbitrary, nodeIds: ['g1'], knownAssetTypes: KNOWN })[0]
        ?.type,
    ).toBe('PLAIN-TEXT');

    const privateKey = sessionWith('SSH', { 'extra:SSH_PRIVATE_KEY': 'value' });
    expect(
      strategy.suggest({ session: privateKey, nodeIds: ['g1'], knownAssetTypes: KNOWN }).assets,
    ).toEqual([]);
  });

  it('suggests dotenv values by their imported keys', () => {
    const parsed = parseDotenv(buffer('API_KEY=api-value\nUNCLASSIFIED=plain-value\n'), '.env');
    const entries = entriesFromParse(parsed, 's1');
    const session = importSessionFromVaultState({
      ...initialVaultState,
      vaults: [
        {
          id: 's1',
          kind: 'dotenv',
          name: '.env',
          fileName: '.env',
          importedAt: '2026-09-13T00:00:00.000Z',
        },
      ],
      entries: entries.map((entry) => ({ current: entry, original: entry })),
    });
    const suggestions = suggestWithFallback([strategy], {
      session,
      nodeIds: session.rootNodeIds,
      knownAssetTypes: KNOWN,
    });

    expect(suggestions.map((suggestion) => [suggestion.name, suggestion.type])).toEqual([
      ['API_KEY', 'PLAIN-TEXT'],
      ['UNCLASSIFIED', 'PLAIN-TEXT'],
    ]);
    expect(suggestions[0]?.fieldBindings['secret.text']).toEqual({
      kind: 'source',
      sourceFieldId: session.nodesById[entries[0]!.id]?.fieldIds[0],
    });
    expect(
      session.nodesById[entries[0]!.id]?.fieldIds.map((id) => session.fieldsById[id]?.name),
    ).toEqual(['extra:API_KEY']);
  });

  it('does not infer a password from an ambiguous secret field', () => {
    const session = sessionWith('Opaque', { 'extra:secret': 'value' });

    expect(strategy.suggest({ session, nodeIds: ['g1'], knownAssetTypes: KNOWN }).assets).toEqual(
      [],
    );
  });

  it('respects the known-types allowlist', () => {
    const session = sessionWith('Note', { note: 'remember the milk' });
    const result = strategy.suggest({
      session,
      nodeIds: ['g1'],
      knownAssetTypes: new Set(['USER-PSWD']),
    });
    expect(result.assets).toEqual([]);
  });

  it('produces nothing for an entry with no recognisable fields', () => {
    const session = sessionWith('Weird', { xyzzy: 'plugh' });
    expect(strategy.suggest({ session, nodeIds: ['g1'], knownAssetTypes: KNOWN }).assets).toEqual(
      [],
    );
  });

  it('returns one reviewed proposal per entry when a group is dropped', () => {
    const first = sessionWith('First', { password: 'one' });
    const second = sessionWith('Second', { token: 'two' });
    second.nodesById.e1.id = 'e2';
    second.nodesById.e1.parentNodeId = 'g1';
    second.nodesById.g1.childNodeIds = ['e1', 'e2'];
    second.nodesById.e2 = { ...second.nodesById.e1, id: 'e2', name: 'Second', fieldIds: ['f0'] };
    second.fieldsById.f0 = { ...second.fieldsById.f0!, parentNodeId: 'e2' };
    first.nodesById.g1.childNodeIds = ['e1', 'e2'];
    first.nodesById.e2 = second.nodesById.e2;
    first.fieldsById.f0 = { ...first.fieldsById.f0!, name: 'password' };
    first.fieldsById.f1 = {
      ...second.fieldsById.f0!,
      id: 'f1',
      parentNodeId: 'e2',
      name: 'token',
      value: new SensitiveValue('two'),
    };
    first.nodesById.e2.fieldIds = ['f1'];
    const result = strategy.suggest({ session: first, nodeIds: ['g1'], knownAssetTypes: KNOWN });
    expect(result.assets.map((asset) => asset.name)).toEqual(['First', 'Second']);
  });

  it('materialises a confirmed proposal as source references', () => {
    const draft = suggestedAssetToDraft(
      {
        type: 'API-KEY',
        name: 'Service',
        fromNodeId: 'e1',
        confidence: 0.8,
        rationale: 'alias match',
        fieldBindings: { 'secret.apiKey': { kind: 'source', sourceFieldId: 'f1' } },
      },
      'asset-1',
    );
    expect(draft.fieldBindings['secret.apiKey']).toEqual({ kind: 'source', sourceFieldId: 'f1' });
  });

  it('includes every non-empty field as serializable source references', () => {
    const imported = sessionWith('Notes', {
      'extra:title': 'Private title',
      'extra:notes': 'Private notes',
    });
    const [suggestion] = suggestWithFallback([], {
      session: imported,
      nodeIds: ['g1'],
      knownAssetTypes: KNOWN,
    });
    expect(suggestion?.type).toBe('PLAIN-TEXT');
    const binding = suggestion?.fieldBindings['secret.text'];
    expect(binding).toEqual({
      kind: 'sources',
      sources: [
        { sourceFieldId: 'f0', name: 'title' },
        { sourceFieldId: 'f1', name: 'notes' },
      ],
    });
    expect(JSON.stringify(suggestion)).not.toContain('Private');
  });

  it('skips empty preferred fields when selecting a plain-text fallback source', () => {
    const imported = sessionWith('Notes', { password: '', notes: 'Private notes' });
    const [suggestion] = suggestWithFallback([], {
      session: imported,
      nodeIds: ['g1'],
      knownAssetTypes: KNOWN,
    });

    const binding = suggestion?.fieldBindings['secret.text'];
    expect(binding).toEqual({
      kind: 'source',
      sourceFieldId: 'f1',
    });
  });

  it('uses Plain Text for a single password-like field', () => {
    const imported = sessionWith('Password', { password: 'secret' });
    const [suggestion] = suggestWithFallback([strategy], {
      session: imported,
      nodeIds: ['g1'],
      knownAssetTypes: KNOWN,
    });

    expect(suggestion?.type).toBe('PLAIN-TEXT');
    expect(suggestion?.fieldBindings['secret.text']).toEqual({
      kind: 'source',
      sourceFieldId: 'f0',
    });
  });
});
