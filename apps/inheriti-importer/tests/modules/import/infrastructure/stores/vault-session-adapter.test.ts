import { describe, expect, it } from 'vitest';
import { importSessionFromVaultState } from '@modules/import/infrastructure/stores/vault-session-adapter';
import { initialVaultState } from '@modules/import/infrastructure/stores/vault-store';

describe('importSessionFromVaultState', () => {
  it('preserves the mapping ids used by the normalized materializer', () => {
    const state = {
      ...initialVaultState,
      vaults: [
        {
          id: 'vault-1',
          name: 'Passwords',
          kind: 'keepass' as const,
          fileName: 'vault.kdbx',
          importedAt: '2026-09-02T00:00:00.000Z',
        },
      ],
      entries: [
        {
          original: {
            id: 'entry-1',
            sourceId: 'vault-1',
            title: 'GitHub',
            username: 'octo',
            password: 'secret',
            url: 'https://github.com',
            notes: '',
            group: 'Work',
            tags: [],
            extraFields: [
              { key: 'token', value: 'abc' },
              { key: 'empty', value: '' },
            ],
            category: '',
            team: '',
          },
          current: {
            id: 'entry-1',
            sourceId: 'vault-1',
            title: 'GitHub',
            username: 'octo',
            password: 'secret',
            url: 'https://github.com',
            notes: '',
            group: 'Work',
            tags: [],
            extraFields: [
              { key: 'token', value: 'abc' },
              { key: 'empty', value: '' },
            ],
            category: '',
            team: '',
          },
        },
      ],
    };

    const session = importSessionFromVaultState(state);

    expect(session.nodesById['entry-1']?.fieldIds).toEqual([
      'entry-1:username',
      'entry-1:password',
      'entry-1:url',
      'entry-1:extra:token',
    ]);
    expect(session.fieldsById['entry-1:notes']).toBeUndefined();
    expect(session.fieldsById['entry-1:extra:empty']).toBeUndefined();
    expect(session.fieldsById['entry-1:password']?.value.reveal()).toBe('secret');
  });

  it('carries source warnings into the normalized session', () => {
    const session = importSessionFromVaultState({
      ...initialVaultState,
      vaults: [
        {
          id: 'vault-1',
          name: 'Passwords',
          kind: 'dotenv',
          fileName: '.env',
          importedAt: '2026-09-02T00:00:00.000Z',
          warnings: ['Skipped line 4.'],
        },
      ],
    });

    expect(session.sources[0]?.warnings).toEqual(['Skipped line 4.']);
  });

  it('uses exact paths, legacy KeePass delimiters, and opaque non-KeePass groups', () => {
    const base = {
      id: 'entry',
      sourceId: 'vault-1',
      title: 'Credential',
      username: '',
      password: 'secret',
      url: '',
      notes: '',
      group: 'A / B',
      tags: [],
      extraFields: [],
      category: '',
      team: '',
    };
    const vault = {
      id: 'vault-1',
      name: 'Vault',
      kind: 'keepass' as const,
      fileName: 'vault',
      importedAt: '',
    };
    const run = (kind: 'keepass' | 'onepassword', groupPath?: string[]) =>
      importSessionFromVaultState({
        ...initialVaultState,
        vaults: [{ ...vault, kind }],
        entries: [
          {
            original: { ...base, ...(groupPath ? { groupPath } : {}) },
            current: { ...base, ...(groupPath ? { groupPath } : {}) },
          },
        ],
      }).nodesById.entry.path;
    expect(run('keepass', ['A / B'])).toEqual(['A / B']);
    expect(run('keepass', ['A', 'B'])).toEqual(['A', 'B']);
    expect(run('keepass')).toEqual(['A', 'B']);
    expect(run('onepassword')).toEqual(['A / B']);
  });
});
