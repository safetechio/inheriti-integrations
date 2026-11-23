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
  additionalFieldsAsset,
  bindingSourceIds,
  suggestEntryFields,
  suggestedAssetToDraft,
  suggestWithFallback,
} from '@modules/mapping/application/suggestion-engine';
import {
  convertToPlainText,
  statusKey,
} from '@modules/importer-preview/ImporterFlow/application/importer-workspace-suggestions';
import { projectSuggestions } from '@modules/importer-preview/ImporterFlow/application/importer-workspace-projection';

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
  it('detects a shared login and disjoint API keys without creating an unmatched asset', () => {
    const session = sessionWith('Integration', {
      username: 'operator',
      email: 'operator@example.test',
      password: 'secret',
      'extra:FIRST_API_KEY': ' first ',
      'extra:SECOND_API_KEY': '第二',
      notes: '  Keep the original spacing  ',
      key: 'ambiguous',
      token: 'ambiguous, too',
      count: '0',
      enabled: 'false',
      unknown: '{"API_KEY":"opaque"}',
      empty: '',
      whitespace: '  ',
    });
    const context = { session, nodeIds: ['g1'], knownAssetTypes: KNOWN };
    const suggestions = suggestWithFallback([strategy], context);
    expect(suggestions.map(({ type, id, variant }) => [type, id, variant])).toEqual([
      ['USER-PSWD', undefined, undefined],
      ['API-KEY', 'e1:DETECTED-API-KEY-f3', undefined],
      ['API-KEY', 'e1:DETECTED-API-KEY-f4', undefined],
    ]);
    expect(
      suggestions
        .flatMap(({ fieldBindings }) => Object.values(fieldBindings).flatMap(bindingSourceIds))
        .sort(),
    ).toEqual(['f0', 'f1', 'f2', 'f3', 'f4']);
    expect(session.fieldsById.f5.value.reveal()).toBe('  Keep the original spacing  ');
    const secrets = suggestions.map(
      (suggestion) =>
        materialiseAsset(suggestedAssetToDraft(suggestion, 'draft'), session).asset.secret,
    );
    expect(secrets[1]).toEqual({ apiKey: ' first ' });
    expect(secrets[2]).toEqual({ apiKey: '第二' });
    expect(suggestWithFallback([strategy], context)).toEqual(suggestions);
  });

  it('uses anchor IDs even when labels are duplicated and optional fields move', () => {
    const session = sessionWith('Integration', {
      username: 'operator',
      password: 'secret',
      first_api_key: 'first',
      second_api_key: 'second',
      note: 'protected',
      email: 'operator@example.test',
    });
    const second = { ...session.fieldsById.f3, id: 'e1:duplicate:κ', name: 'first_api_key' };
    session.fieldsById[second.id] = second;
    delete session.fieldsById.f3;
    const context = { session, nodeIds: ['g1'], knownAssetTypes: KNOWN };
    const suggestions = () => suggestWithFallback([strategy], context).map(({ id }) => id);
    session.nodesById.e1.fieldIds = ['f0', 'f1', 'f2', second.id, 'f4', 'f5'];
    const first = suggestions();
    session.nodesById.e1.fieldIds = ['f5', 'f4', 'f1', 'f0', 'f2', second.id];
    expect(suggestions()).toEqual(first);
    expect(first).toEqual([
      undefined,
      'e1:DETECTED-API-KEY-f2',
      'e1:DETECTED-API-KEY-e1%3Aduplicate%3A%CE%BA',
    ]);
  });

  it('escapes anchor separators when an imported label contains an isolated surrogate', () => {
    const session = sessionWith('Integration', {
      username: 'operator',
      email: 'operator@example.test',
      password: 'secret',
      api_key: 'key',
    });
    const id = 'extra:\ud800:api_key';
    session.fieldsById[id] = { ...session.fieldsById.f3, id };
    session.nodesById.e1.fieldIds[3] = id;
    const results = suggestWithFallback([strategy], {
      session,
      nodeIds: ['g1'],
      knownAssetTypes: KNOWN,
    });
    expect(results[1]?.id).toBe('e1:DETECTED-API-KEY-extra%3A\ud800%3Aapi_key');
  });

  it('detects a single explicit key only when the reviewer selects that field', () => {
    const session = sessionWith('Integration', { api_key: 'key' });
    const context = { session, nodeIds: ['g1'], knownAssetTypes: KNOWN };
    expect(suggestWithFallback([strategy], context).map(({ type }) => type)).toEqual([
      'PLAIN-TEXT',
    ]);
    expect(
      suggestEntryFields([strategy], context, session.nodesById.e1, [session.fieldsById.f0]),
    ).toMatchObject([
      { type: 'API-KEY', fieldBindings: { 'secret.apiKey': { sourceFieldId: 'f0' } } },
    ]);
  });

  it('keeps proposals isolated by entry when the parent and entry are both selected', () => {
    const session = sessionWith('Login', { username: 'operator', password: 'secret' });
    const separate = sessionWith('Keys', { api_key: 'key' });
    session.nodesById.g1.childNodeIds.push('other');
    session.nodesById.other = { ...separate.nodesById.e1, id: 'other', fieldIds: ['other:key'] };
    session.fieldsById['other:key'] = {
      ...separate.fieldsById.f0,
      id: 'other:key',
      parentNodeId: 'other',
    };
    // An inconsistent source reference must not allow another entry's key to be claimed.
    session.nodesById.e1.fieldIds.push('other:key');
    const results = suggestWithFallback([strategy], {
      session,
      nodeIds: ['g1', 'e1'],
      knownAssetTypes: KNOWN,
    });
    expect(results.map(({ fromNodeId, type }) => [fromNodeId, type])).toEqual([
      ['e1', 'USER-PSWD'],
      ['other', 'PLAIN-TEXT'],
    ]);
    expect(
      results.flatMap(({ fieldBindings }) =>
        Object.values(fieldBindings).flatMap(bindingSourceIds),
      ),
    ).toEqual(['f0', 'f1', 'other:key']);
  });

  it('scopes optional context to the strongest available group sharing its prefix', () => {
    const session = sessionWith('Integration', {
      FIRST_PASSWORD: 'first-password',
      SECOND_USERNAME: 'second-user',
      FIRST_USERNAME: 'first-user',
      SECOND_PASSWORD: 'second-password',
      SECOND_API_KEY: 'key',
      SECOND_APP: 'shared context',
    });
    const suggestions = suggestWithFallback([strategy], {
      session,
      nodeIds: ['g1'],
      knownAssetTypes: KNOWN,
    });
    const secrets = suggestions.map(
      (suggestion) =>
        materialiseAsset(suggestedAssetToDraft(suggestion, 'draft'), session).asset.secret,
    );
    expect(secrets).toEqual([
      { app: 'shared context', apiKey: 'key' },
      { username: 'first-user', password: 'first-password' },
      { username: 'second-user', password: 'second-password' },
    ]);
  });

  it('leaves invalid secondary card and paired AWS credentials unresolved', () => {
    const session = sessionWith('Integration', {
      username: 'operator',
      password: 'secret',
      cardNumber: '4111111111111112',
      AWS_ACCESS_KEY_ID: 'AKIA123',
      AWS_SECRET_ACCESS_KEY: 'secret123',
      external_api_key: 'key',
      email: 'operator@example.test',
    });
    const context = { session, nodeIds: ['g1'], knownAssetTypes: KNOWN };
    const suggestions = suggestWithFallback([strategy], context);
    expect(suggestions.map(({ type }) => type)).toEqual(['USER-PSWD', 'API-KEY']);
    const bound = suggestions.flatMap(({ fieldBindings }) =>
      Object.values(fieldBindings).flatMap(bindingSourceIds),
    );
    expect(bound).not.toContain('f2');
    expect(bound).not.toContain('f3');
    expect(bound).not.toContain('f4');

    const selected = suggestEntryFields([strategy], context, session.nodesById.e1, [
      session.fieldsById.f3,
      session.fieldsById.f2,
    ]);
    expect(selected.map(({ type }) => type)).not.toContain('API-KEY');
    expect(
      selected
        .flatMap(({ fieldBindings }) => Object.values(fieldBindings).flatMap(bindingSourceIds))
        .sort(),
    ).toEqual(['f2', 'f3']);
  });

  it('detects explicit scalar credential types without guessing generic labels', () => {
    const privateKey = 'a'.repeat(64);
    const words = [
      'one',
      'two',
      'three',
      'four',
      'five',
      'six',
      'seven',
      'eight',
      'nine',
      'ten',
      'eleven',
      'twelve',
    ];
    const session = sessionWith('Integration', {
      password: 'secret',
      username: 'operator',
      recovery_code: 'recover-here',
      pin_code: '0017',
      private_key: privateKey,
      public_address: 'public',
      seed_phrase: words.join(' '),
      other_seed_phrase: 'a short note',
      service_private_key: '-----BEGIN PRIVATE KEY-----\nopaque',
      code: 'opaque',
      words: 'arbitrary',
    });
    const suggestions = suggestWithFallback([strategy], {
      session,
      nodeIds: ['g1'],
      knownAssetTypes: new Set([...KNOWN, 'SEED-PHRASE']),
    });
    expect(suggestions.map(({ type }) => type)).toEqual([
      'USER-PSWD',
      'RECOVERY-CODE',
      'PIN-CODE',
      'PRIVATE-KEY',
      'SEED-PHRASE',
    ]);
    expect(
      suggestions
        .slice(1)
        .map(
          (suggestion) =>
            materialiseAsset(suggestedAssetToDraft(suggestion, 'draft'), session).asset.secret,
        ),
    ).toEqual([
      { code: 'recover-here' },
      { code: '0017' },
      { privateKey, publicAddress: 'public' },
      { words },
    ]);
  });

  it('leaves fields discarded by schema filtering unresolved and keeps composite sources', () => {
    const session = sessionWith('Composite', { first: 'one', second: 'two', rejected: 'three' });
    const composite = {
      kind: 'sources' as const,
      sources: [
        { name: 'first', sourceFieldId: 'f0' },
        { name: 'second', sourceFieldId: 'f1' },
      ],
    };
    const assets = suggestWithFallback(
      [
        {
          id: 'synthetic',
          suggest: () => ({
            strategyId: 'synthetic',
            assets: [
              {
                type: 'PLAIN-TEXT',
                name: 'Composite',
                fromNodeId: 'e1',
                confidence: 1,
                rationale: '',
                fieldBindings: {
                  'secret.text': composite,
                  'secret.unknown': { kind: 'source', sourceFieldId: 'f2' },
                },
              },
            ],
          }),
        },
      ],
      { session, nodeIds: ['g1'], knownAssetTypes: KNOWN },
    );
    expect(assets.map((asset) => asset.fieldBindings)).toEqual([{ 'secret.text': composite }]);
  });

  it('maps a 1Password credit card and leaves unmatched fields unresolved', () => {
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

    expect(suggestions.map((item) => item.type)).toEqual(['PAYMENT-CREDIT-CARD']);
    expect(suggestions[0]?.fieldBindings['secret.cardNumber']).toEqual({
      kind: 'source',
      sourceFieldId: 'f0',
    });
    expect(Object.values(suggestions[0].fieldBindings).flatMap(bindingSourceIds)).not.toContain(
      'f4',
    );
    expect(JSON.stringify(suggestions)).not.toContain('Call the issuer');
  });

  it('leaves native 1Password, KeePass, and Passbolt notes pending by default', () => {
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
      expect(suggestion?.fieldBindings['meta.notes']).toBeUndefined();
      expect(companion).toBeUndefined();
      expect(JSON.stringify(suggestion)).not.toContain('Private instructions');
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
    expect(suggestions.map((asset) => asset.type)).toEqual(['USER-PSWD']);
    expect(suggestions[0]?.fieldBindings['meta.notes']).toBeUndefined();
    expect(Object.values(suggestions[0].fieldBindings).flatMap(bindingSourceIds)).toEqual(['f0']);
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

  it('leaves generic secret parser notes pending', () => {
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
      expect(companion).toBeUndefined();
      expect(
        materialiseAsset(suggestedAssetToDraft(suggestion!, 'a1'), session).asset.meta.notes,
      ).toBeUndefined();
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

  it.each(['IP source', 'IP/source'])(
    'maps an imported %s value separately from the website',
    (label) => {
      const [suggestion] = strategy.suggest({
        session: sessionWith('Server login', {
          username: 'admin',
          password: 'secret',
          website: 'example.com',
          [label]: '10.0.0.1 / internal',
        }),
        nodeIds: ['g1'],
        knownAssetTypes: KNOWN,
      }).assets;
      expect(Object.keys(suggestion!.fieldBindings)).toEqual(
        expect.arrayContaining(['secret.appOrWebsite', 'secret.ipSource']),
      );
    },
  );

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

  it('keeps a valid username with an invalid email shape and leaves an oversized username pending', () => {
    const detect = (username: string) =>
      strategy.suggest({
        session: sessionWith('Mail', { username, password: 'secret' }),
        nodeIds: ['g1'],
        knownAssetTypes: KNOWN,
      }).assets[0];
    expect(detect('ada@@example.com')?.fieldBindings).toEqual({
      'secret.username': { kind: 'source', sourceFieldId: 'f0' },
      'secret.password': { kind: 'source', sourceFieldId: 'f1' },
    });
    expect(detect(`${'a'.repeat(250)}@example.com`)).toMatchObject({
      fieldBindings: { 'secret.password': { kind: 'source', sourceFieldId: 'f1' } },
      evidence: expect.arrayContaining(['invalid-field']),
    });
    expect(Object.keys(detect(`${'a'.repeat(250)}@example.com`).fieldBindings)).toEqual([
      'secret.password',
    ]);
  });

  it('evaluates the anchors before ranking and keeps invalid optional fields pending', () => {
    const session = sessionWith('Login', {
      cardNumber: '4111111111111112',
      expiryDate: '2030-12',
      cardHolderName: 'Fixture Name',
      API_KEY: 'x'.repeat(501),
      password: 'fixture',
      username: 'fixture-user',
      email: 'invalid-email',
      website: 'x'.repeat(101),
    });
    const results = suggestWithFallback([strategy], {
      session,
      nodeIds: ['g1'],
      knownAssetTypes: KNOWN,
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      type: 'USER-PSWD',
      evidence: ['specific-anchor', 'matching-context', 'invalid-field'],
    });
    expect(Object.values(results[0].fieldBindings).flatMap(bindingSourceIds)).toEqual(['f5', 'f4']);
  });

  it('matches native roles and structural keys within their source section', () => {
    const session = sessionWith('Sections', {
      'Private sign-in': 'fixture',
      'Account alias': 'fixture-user',
      'Duplicate label': 'other-user',
      'Other secret': 'other-fixture',
      Link: 'example.test',
    });
    session.fieldsById.f0.metadata = { sourceRole: 'password', sourceSection: 'first' };
    session.fieldsById.f1.metadata = { sourceKey: 'username', sourceSection: 'first' };
    session.fieldsById.f2.metadata = { sourceKey: 'username', sourceSection: 'second' };
    session.fieldsById.f3.metadata = { sourceKey: 'password', sourceSection: 'second' };
    session.fieldsById.f4.metadata = { sourceRole: 'url', sourceSection: 'other' };
    const results = suggestWithFallback([strategy], {
      session,
      nodeIds: ['g1'],
      knownAssetTypes: KNOWN,
    });
    expect(
      results.map(({ fieldBindings }) => Object.values(fieldBindings).flatMap(bindingSourceIds)),
    ).toEqual([
      ['f1', 'f0'],
      ['f2', 'f3'],
    ]);
    expect(results[0].evidence).toContain('native-role');
  });

  it('isolates sections with identical names and skips opaque fields', () => {
    const session = sessionWith('Sections', {
      password: 'fixture',
      username: 'unrelated',
      api_key: 'fixture',
      cardNumber: '4111111111111111',
      email: 'fixture@example.test',
    });
    const firstSection = { sourceSection: 'Service', sourceSectionIdentity: '0' };
    session.fieldsById.f0.metadata = firstSection;
    session.fieldsById.f1.metadata = { ...firstSection, sourceSectionIdentity: '1' };
    session.fieldsById.f2.metadata = { sourceFieldType: 'base64' };
    session.fieldsById.f3.metadata = { sourceFieldType: 'opaque' };
    session.fieldsById.f4.metadata = { ...firstSection, sourceFieldType: 'base64' };
    const results = suggestWithFallback([strategy], {
      session,
      nodeIds: ['g1'],
      knownAssetTypes: KNOWN,
    });
    expect(
      results.map(({ type, fieldBindings }) => [
        type,
        Object.values(fieldBindings).flatMap(bindingSourceIds),
      ]),
    ).toEqual([['USER-PSWD', ['f0']]]);
  });

  it('matches a bounded alias suffix after a long, heavily separated prefix', () => {
    const prefix = 'part_'.repeat(5000);
    const session = sessionWith('Long label', {
      [`${prefix}api_key`]: 'fixture',
      [`${prefix}service`]: 'Example',
    });
    const [result] = suggestWithFallback([strategy], {
      session,
      nodeIds: ['g1'],
      knownAssetTypes: KNOWN,
    });
    expect(result.fieldBindings).toEqual({
      'secret.app': { kind: 'source', sourceFieldId: 'f1' },
      'secret.apiKey': { kind: 'source', sourceFieldId: 'f0' },
    });
  });

  it('leaves indistinguishable optional aliases and required login anchors unresolved', () => {
    const session = sessionWith('Duplicates', {
      password: 'fixture',
      username: 'first-user',
      login: 'second-user',
    });
    const detect = () =>
      suggestWithFallback([strategy], { session, nodeIds: ['g1'], knownAssetTypes: KNOWN });
    const [partial] = detect();
    expect(partial.evidence).toContain('ambiguous-fields');
    expect(Object.keys(partial.fieldBindings)).toEqual(['secret.password']);
    session.fieldsById.f1.metadata.sourceKey = 'password';
    expect(detect().map(({ type }) => type)).toEqual(['PLAIN-TEXT']);
  });

  it('ranks native anchors over generic aliases regardless of optional field count', () => {
    const detect = (fields: Record<string, string>, native = false) => {
      const session = sessionWith('Ranking', fields);
      if (native) session.fieldsById.f0.metadata.sourceRole = 'password';
      return strategy.suggest({ session, nodeIds: ['g1'], knownAssetTypes: KNOWN }).assets[0];
    };
    const native = detect({ 'Hidden Credential': 'fixture' }, true);
    const generic = detect({ token: 'fixture', service: 'Example' });
    const specific = detect({ api_key: 'fixture' });
    const close = detect({ api_key: 'fixture', password: 'fixture', username: 'fixture-user' });
    expect(native.confidence).toBeGreaterThan(specific.confidence);
    expect(specific.confidence).toBeGreaterThan(generic.confidence);
    expect(close.evidence).toContain('competing-types');
    expect(close.confidence).toBeLessThan(specific.confidence);
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

  it('keeps native notes with fallback secret text before review', () => {
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
        'secret.text': {
          kind: 'sources',
          sources: [
            { sourceFieldId: 'f0', name: 'notes' },
            { sourceFieldId: 'f1', name: 'private key' },
          ],
        },
      });
      const materialised = materialiseAsset(
        suggestedAssetToDraft(fallback!, 'asset-1'),
        session,
      ).asset;
      expect(materialised.secret.text).toBe(
        'notes: Handle with care\nprivate key: private material',
      );
      expect(materialised.meta.notes).toBeUndefined();
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

  it('preserves an explicitly mapped note when converting a structured asset to Plain Text', () => {
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
    const [structured] = suggestWithFallback([strategy], {
      session,
      nodeIds: ['g1'],
      knownAssetTypes: KNOWN,
    });
    const companion = additionalFieldsAsset(session, session.nodesById.e1, [
      session.fieldsById.f1,
      session.fieldsById.f2,
    ]);
    const converted = convertToPlainText(session, structured!, true);
    expect(converted.fieldBindings).toEqual({
      'secret.text': { kind: 'source', sourceFieldId: 'f0' },
    });
    expect(
      materialiseAsset(suggestedAssetToDraft(converted, 'asset-1'), session).asset.meta.notes,
    ).toBeUndefined();
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
    const [, rebuiltCompanion] = projectSuggestions(
      session,
      [structured!, companion!],
      { [statusKey(structured!)]: { 'meta.notes': 'f2' } },
      {},
      new Set(),
    );
    expect(rebuiltCompanion.fieldBindings['secret.text']).toEqual({
      kind: 'source',
      sourceFieldId: 'f1',
    });
  });

  it('preserves a native note explicitly changed from public to protected', () => {
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
    const [structured] = suggestWithFallback([strategy], {
      session,
      nodeIds: ['g1'],
      knownAssetTypes: KNOWN,
    });
    const originals = [structured!];
    const [withPublicNote] = projectSuggestions(
      session,
      originals,
      {},
      {},
      new Set(),
      {},
      {
        sourceNotes: { s1: 'asset-notes' },
      },
    );
    expect(withPublicNote.fieldBindings['meta.notes']).toEqual({
      kind: 'source',
      sourceFieldId: 'f1',
    });
    const [, rebuilt] = projectSuggestions(
      session,
      originals,
      {},
      {},
      new Set(),
      {},
      {
        sourceNotes: { s1: 'protected' },
      },
    );
    expect(rebuilt.fieldBindings['meta.notes']).toBeUndefined();
    expect(rebuilt.fieldBindings['secret.text']).toEqual({
      kind: 'source',
      sourceFieldId: 'f1',
    });
    expect(
      materialiseAsset(suggestedAssetToDraft(rebuilt, 'asset-1'), session).asset.secret.text,
    ).toBe('Instructions');
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
