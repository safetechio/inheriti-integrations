import { describe, expect, it } from 'vitest';
import { SensitiveValue, type ImportSession } from '@modules/import/domain/import-model';
import { parseDotenv } from '@modules/import/infrastructure/parsers/dotenv';
import { importSessionFromVaultState } from '@modules/import/infrastructure/stores/vault-session-adapter';
import {
  entriesFromParse,
  initialVaultState,
} from '@modules/import/infrastructure/stores/vault-store';
import { FieldAliasSuggestionStrategy } from '@modules/mapping/application/strategies/field-alias-strategy';
import { materialiseAsset } from '@modules/plans/domain/asset-materializer';
import {
  suggestedAssetToDraft,
  suggestWithFallback,
} from '@modules/mapping/application/suggestion-engine';
import {
  additionalFieldsSuggestion,
  convertToPlainText,
} from '@modules/importer-preview/ImporterFlow/application/importer-workspace-suggestions';

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
  'PAYMENT-CREDIT-CARD',
]);
const strategy = new FieldAliasSuggestionStrategy();

function buffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

describe('FieldAliasSuggestionStrategy', () => {
  it('maps a 1Password credit card and preserves its unmatched fields', () => {
    const session = sessionWith('Travel card', {
      'extra:creditCardNumber': '4111111111111111',
      'extra:expiryDate': '2030-12',
      'extra:cardHolderName': 'Ada Lovelace',
      'extra:bank': 'Example Bank',
      'extra:notes': 'Call the issuer before travel',
    });
    session.sources = [
      {
        id: 's1',
        kind: 'onepassword',
        name: '1Password',
        fileName: 'vault.txt',
        importedAt: '2026-10-20T00:00:00.000Z',
        warnings: [],
      },
    ];
    const suggestions = suggestWithFallback([strategy], {
      session,
      nodeIds: ['g1'],
      knownAssetTypes: KNOWN,
    });

    expect(suggestions.map((item) => item.type)).toEqual(['PAYMENT-CREDIT-CARD', 'PLAIN-TEXT']);
    expect(suggestions[1]?.variant).toBe('additional-fields');
    expect(suggestions[0]?.fieldBindings['secret.cardNumber']).toEqual({
      kind: 'source',
      sourceFieldId: 'f0',
    });
    expect(suggestions[1]?.fieldBindings['secret.text']).toEqual({
      kind: 'source',
      sourceFieldId: 'f4',
    });
    expect(JSON.stringify(suggestions)).not.toContain('Call the issuer');
  });

  it('maps dedicated 1Password, KeePass, and Passbolt notes to readable metadata', () => {
    for (const [kind, fields, expectedType] of [
      [
        'onepassword',
        { username: 'ada', password: 'secret', notes: 'Private instructions' },
        'USER-PSWD',
      ],
      ['keepass', { token: 'secret', notes: 'Private instructions' }, 'API-KEY'],
      ['passbolt', { password: 'secret', notes: 'Private instructions' }, 'USER-PSWD'],
    ] as const) {
      const session = sessionWith('Service', fields);
      session.sources = [
        {
          id: 's1',
          kind,
          name: kind,
          fileName: 'vault',
          importedAt: '2026-10-20T00:00:00.000Z',
          warnings: [],
        },
      ];
      const [suggestion, companion] = suggestWithFallback([strategy], {
        session,
        nodeIds: ['g1'],
        knownAssetTypes: KNOWN,
      });
      expect(suggestion?.type).toBe(expectedType);
      expect(suggestion?.fieldBindings['meta.notes']).toEqual({
        kind: 'source',
        sourceFieldId: `f${Object.keys(fields).length - 1}`,
      });
      expect(companion).toBeUndefined();
      expect(JSON.stringify([suggestion, companion])).not.toContain('Private instructions');
      const draft = suggestedAssetToDraft(suggestion!, 'asset-1');
      expect(draft.fieldBindings['meta.notes']).toEqual(suggestion?.fieldBindings['meta.notes']);
      expect(materialiseAsset(draft, session).asset.meta.notes).toBe('Private instructions');
      const withoutNotes = sessionWith(
        'Service',
        Object.fromEntries(Object.entries(fields).filter(([name]) => name !== 'notes')),
      );
      const [base] = strategy.suggest({
        session: withoutNotes,
        nodeIds: ['g1'],
        knownAssetTypes: KNOWN,
      }).assets;
      expect(suggestion?.confidence).toBe(base?.confidence);
    }
  });

  it('keeps arbitrary extra notes out of structured metadata', () => {
    const session = sessionWith('Service', {
      password: 'secret',
      notes: 'Canonical notes',
      'extra:notes': 'Extra notes',
      note: 'Alias note',
      'extra:SECRET_NOTES': 'Secret note',
    });
    session.sources = [
      {
        id: 's1',
        kind: 'onepassword',
        name: '1Password',
        fileName: 'vault.1pux',
        importedAt: '2026-10-20T00:00:00.000Z',
        warnings: [],
      },
    ];
    const suggestions = suggestWithFallback([strategy], {
      session,
      nodeIds: ['g1'],
      knownAssetTypes: KNOWN,
    });
    expect(suggestions.map((asset) => asset.type)).toEqual(['USER-PSWD', 'PLAIN-TEXT']);
    expect(suggestions[0]?.fieldBindings['meta.notes']).toEqual({
      kind: 'source',
      sourceFieldId: 'f1',
    });
    expect(suggestions[1]?.fieldBindings['secret.text']).toMatchObject({
      kind: 'sources',
      sources: [
        { sourceFieldId: 'f2', name: 'notes' },
        { sourceFieldId: 'f3', name: 'note' },
        { sourceFieldId: 'f4', name: 'SECRET_NOTES' },
      ],
    });
    expect(JSON.stringify(suggestions)).not.toContain('Secret note');

    const unmatched = sessionWith('Note', { notes: 'Private instructions' });
    const [fallback] = suggestWithFallback([strategy], {
      session: unmatched,
      nodeIds: ['g1'],
      knownAssetTypes: KNOWN,
    });
    expect(fallback?.type).toBe('PLAIN-TEXT');
    expect(fallback?.fieldBindings['meta.notes']).toBeUndefined();
  });

  it('keeps generic secret parser notes in a protected companion', () => {
    for (const kind of ['vault', 'cloud', 'kubernetes', 'dotenv'] as const) {
      const session = sessionWith('Service', {
        username: 'ada',
        password: 'secret',
        notes: 'Key material',
      });
      session.sources = [
        {
          id: 's1',
          kind,
          name: kind,
          fileName: 'export',
          importedAt: '2026-10-20T00:00:00.000Z',
          warnings: [],
        },
      ];
      const [suggestion, companion] = suggestWithFallback([strategy], {
        session,
        nodeIds: ['g1'],
        knownAssetTypes: KNOWN,
      });
      expect(suggestion?.fieldBindings['meta.notes']).toBeUndefined();
      expect(companion?.type).toBe('PLAIN-TEXT');
      expect(companion?.fieldBindings['secret.text']).toEqual({
        kind: 'source',
        sourceFieldId: 'f2',
      });
      expect(
        materialiseAsset(suggestedAssetToDraft(suggestion!, 'a1'), session).asset.meta.notes,
      ).toBeUndefined();
      expect(
        materialiseAsset(suggestedAssetToDraft(companion!, 'a2'), session).asset.secret.text,
      ).toBe('Key material');
    }
  });

  it('maps credit card aliases from any source format', () => {
    const session = sessionWith('Card', {
      'extra:cardNumber': '4111111111111111',
      'extra:expiryDate': '2030-12',
    });
    expect(
      suggestWithFallback([strategy], { session, nodeIds: ['g1'], knownAssetTypes: KNOWN }).map(
        (item) => item.type,
      ),
    ).toEqual(['PAYMENT-CREDIT-CARD']);
    expect(
      strategy.suggest({ session, nodeIds: ['g1'], knownAssetTypes: KNOWN }).assets[0]
        ?.fieldBindings['secret.cardNumber'],
    ).toEqual({ kind: 'source', sourceFieldId: 'f0' });
  });

  it('keeps unmatched Identity and SSH fields as Plain Text', () => {
    for (const [name, fields] of [
      ['Identity', { 'extra:firstName': 'Ada', 'extra:notes': 'private' }],
      ['SSH', { 'extra:privateKey': 'private', 'extra:publicKey': 'public' }],
    ] as const) {
      const session = sessionWith(name, fields);
      session.sources = [
        {
          id: 's1',
          kind: 'onepassword',
          name: '1Password',
          fileName: 'vault.txt',
          importedAt: '2026-10-20T00:00:00.000Z',
          warnings: [],
        },
      ];
      expect(
        suggestWithFallback([strategy], { session, nodeIds: ['g1'], knownAssetTypes: KNOWN }).map(
          (item) => item.type,
        ),
      ).toEqual(['PLAIN-TEXT']);
    }
  });
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

  it('maps an email-shaped username to email', () => {
    const session = sessionWith('Mail', { username: 'ada@example.com', password: 'secret' });
    session.sources = [
      {
        id: 's1',
        kind: 'onepassword',
        name: '1Password',
        fileName: 'vault.1pux',
        importedAt: '2026-10-20T00:00:00.000Z',
        warnings: [],
      },
    ];
    const suggestions = suggestWithFallback([strategy], {
      session,
      nodeIds: ['g1'],
      knownAssetTypes: KNOWN,
    });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.fieldBindings['secret.email']).toEqual({
      kind: 'source',
      sourceFieldId: 'f0',
    });
    expect(suggestions[0]?.fieldBindings['secret.username']).toBeUndefined();
  });

  it('keeps a separate email and an email-shaped username in their named fields', () => {
    const session = sessionWith('Mail', {
      email: 'contact@example.com',
      username: 'login@example.com',
      password: 'secret',
    });
    const [suggestion] = strategy.suggest({
      session,
      nodeIds: ['g1'],
      knownAssetTypes: KNOWN,
    }).assets;
    expect(suggestion?.fieldBindings['secret.email']).toEqual({
      kind: 'source',
      sourceFieldId: 'f0',
    });
    expect(suggestion?.fieldBindings['secret.username']).toEqual({
      kind: 'source',
      sourceFieldId: 'f1',
    });
  });

  it('keeps invalid and oversized email-shaped usernames as usernames', () => {
    for (const username of ['ada@@example.com', `${'a'.repeat(250)}@example.com`]) {
      const session = sessionWith('Mail', { username, password: 'secret' });
      const [suggestion] = strategy.suggest({
        session,
        nodeIds: ['g1'],
        knownAssetTypes: KNOWN,
      }).assets;
      expect(suggestion?.fieldBindings['secret.username']).toEqual({
        kind: 'source',
        sourceFieldId: 'f0',
      });
      expect(suggestion?.fieldBindings['secret.email']).toBeUndefined();
    }
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

  it('separates native notes from fallback secret text when other fields exist', () => {
    for (const kind of ['onepassword', 'keepass', 'passbolt']) {
      const session = sessionWith('Unmatched key', {
        notes: 'Handle with care',
        'extra:private key': 'private material',
      });
      session.sources = [
        {
          id: 's1',
          kind,
          name: kind,
          fileName: 'vault',
          importedAt: '2026-10-20T00:00:00.000Z',
          warnings: [],
        },
      ];
      const [fallback] = suggestWithFallback([], {
        session,
        nodeIds: ['g1'],
        knownAssetTypes: KNOWN,
      });
      expect(fallback?.fieldBindings).toEqual({
        'secret.text': { kind: 'source', sourceFieldId: 'f1' },
        'meta.notes': { kind: 'source', sourceFieldId: 'f0' },
      });
      const materialised = materialiseAsset(
        suggestedAssetToDraft(fallback!, 'asset-1'),
        session,
      ).asset;
      expect(materialised.secret.text).toBe('private material');
      expect(materialised.meta.notes).toBe('Handle with care');
      expect(JSON.stringify(fallback)).not.toContain('private material');
    }
  });

  it('keeps generic and note-only fallback notes in secret text', () => {
    for (const kind of ['vault', 'cloud', 'onepassword']) {
      const session = sessionWith(
        'Notes',
        kind === 'onepassword'
          ? { notes: 'Only note' }
          : { notes: 'Secret note', 'extra:key': 'private material' },
      );
      session.sources = [
        {
          id: 's1',
          kind,
          name: kind,
          fileName: 'vault',
          importedAt: '2026-10-20T00:00:00.000Z',
          warnings: [],
        },
      ];
      const [fallback] = suggestWithFallback([], {
        session,
        nodeIds: ['g1'],
        knownAssetTypes: KNOWN,
      });
      expect(fallback?.fieldBindings['meta.notes']).toBeUndefined();
      expect(
        materialiseAsset(suggestedAssetToDraft(fallback!, 'asset-1'), session).asset.secret.text,
      ).toContain(kind === 'onepassword' ? 'Only note' : 'Secret note');
    }
  });

  it('keeps native notes separate when converting a structured asset to Plain Text', () => {
    const session = sessionWith('Service', {
      password: 'secret',
      notes: 'Instructions',
      'extra:other': 'other secret',
    });
    session.sources = [
      {
        id: 's1',
        kind: 'onepassword',
        name: '1Password',
        fileName: 'vault',
        importedAt: '2026-10-20T00:00:00.000Z',
        warnings: [],
      },
    ];
    const [structured, companion] = suggestWithFallback([strategy], {
      session,
      nodeIds: ['g1'],
      knownAssetTypes: KNOWN,
    });
    expect(companion?.variant).toBe('additional-fields');
    const converted = convertToPlainText(session, structured!, true);
    expect(converted.fieldBindings).toEqual({
      'secret.text': { kind: 'source', sourceFieldId: 'f0' },
      'meta.notes': { kind: 'source', sourceFieldId: 'f1' },
    });
    expect(
      materialiseAsset(suggestedAssetToDraft(converted, 'asset-1'), session).asset,
    ).toMatchObject({ secret: { text: 'secret' }, meta: { notes: 'Instructions' } });
    const remapped = {
      ...structured!,
      fieldBindings: {
        ...structured!.fieldBindings,
        'meta.notes': { kind: 'source' as const, sourceFieldId: 'f2' },
      },
    };
    const convertedRemap = convertToPlainText(session, remapped, true);
    expect(
      materialiseAsset(suggestedAssetToDraft(convertedRemap, 'asset-2'), session).asset,
    ).toMatchObject({ secret: { text: 'secret' }, meta: { notes: 'other secret' } });
    expect(convertedRemap.fieldBindings['secret.text']).toEqual({
      kind: 'source',
      sourceFieldId: 'f0',
    });
    const rebuiltCompanion = additionalFieldsSuggestion(session, remapped, companion!);
    expect(rebuiltCompanion.fieldBindings['secret.text']).toEqual({
      kind: 'source',
      sourceFieldId: 'f1',
    });
  });

  it('returns unmapped native notes to companion secret text', () => {
    const session = sessionWith('Service', {
      password: 'secret',
      notes: 'Instructions',
      'extra:other': 'other secret',
    });
    session.sources = [
      {
        id: 's1',
        kind: 'onepassword',
        name: '1Password',
        fileName: 'vault',
        importedAt: '2026-10-20T00:00:00.000Z',
        warnings: [],
      },
    ];
    const [structured, companion] = suggestWithFallback([strategy], {
      session,
      nodeIds: ['g1'],
      knownAssetTypes: KNOWN,
    });
    const { 'meta.notes': _notes, ...withoutNotes } = structured!.fieldBindings;
    const rebuilt = additionalFieldsSuggestion(
      session,
      { ...structured!, fieldBindings: withoutNotes },
      companion!,
    );
    expect(rebuilt.fieldBindings['meta.notes']).toBeUndefined();
    expect(rebuilt.fieldBindings['secret.text']).toEqual({
      kind: 'sources',
      sources: [
        { sourceFieldId: 'f1', name: 'notes' },
        { sourceFieldId: 'f2', name: 'other' },
      ],
    });
    expect(
      materialiseAsset(suggestedAssetToDraft(rebuilt, 'asset-1'), session).asset.secret.text,
    ).toContain('notes: Instructions');
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
