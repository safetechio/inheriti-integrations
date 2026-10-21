import { describe, expect, it } from 'vitest';
import {
  entriesFromParse,
  initialVaultState,
  vaultReducer,
} from '@modules/import/infrastructure/stores/vault-store';

it('scopes 1Password item IDs to each imported source', () => {
  const result = {
    kind: 'onepassword' as const,
    name: 'Archive',
    warnings: [],
    entries: [
      {
        id: '0:0:item',
        title: 'Item',
        username: '',
        password: '',
        url: '',
        notes: '',
        group: '',
        tags: [],
        extraFields: [],
        category: '',
        team: '',
      },
    ],
  };
  expect(entriesFromParse(result, 'source-1')[0].id).toBe('source-1:0:0:item');
  expect(entriesFromParse(result, 'source-2')[0].id).toBe('source-2:0:0:item');
});

describe('vault reducer cleanup', () => {
  it('purges imported vaults and entries after a successful import', () => {
    const state = vaultReducer(initialVaultState, {
      type: 'import',
      vault: {
        id: 'vault-1',
        name: 'Imported vault',
        kind: 'dotenv',
        fileName: '.env',
        importedAt: new Date().toISOString(),
      },
      entries: [],
      warnings: [],
    });

    expect(vaultReducer(state, { type: 'purge' })).toEqual(initialVaultState);
  });

  it('retains independent lifecycle records and warning ownership per source', () => {
    const first = vaultReducer(initialVaultState, {
      type: 'source-start',
      source: {
        id: 'source-1',
        file: { name: 'first.env', data: new ArrayBuffer(0) },
        status: 'retrying',
        warnings: [],
      },
    });
    const withSources = vaultReducer(first, {
      type: 'source-start',
      source: {
        id: 'source-2',
        file: { name: 'second.env', data: new ArrayBuffer(0) },
        status: 'retrying',
        warnings: [],
      },
    });
    const next = vaultReducer(
      vaultReducer(withSources, {
        type: 'source-status',
        sourceId: 'source-1',
        status: 'warning',
        warnings: ['Skipped line 3.'],
        entries: 2,
      }),
      {
        type: 'source-status',
        sourceId: 'source-2',
        status: 'failed',
        detail: 'Unsupported format.',
      },
    );

    expect(next.sources).toMatchObject([
      { id: 'source-1', status: 'warning', warnings: ['Skipped line 3.'], entries: 2 },
      { id: 'source-2', status: 'failed', detail: 'Unsupported format.' },
    ]);
    expect(vaultReducer(next, { type: 'purge' }).sources).toEqual([]);
  });

  it('removes one failed or imported source without touching its sibling', () => {
    let state = vaultReducer(initialVaultState, {
      type: 'source-start',
      source: {
        id: 'source-1',
        file: { name: 'first.env', data: new ArrayBuffer(0) },
        status: 'retrying',
        warnings: [],
      },
    });
    state = vaultReducer(state, {
      type: 'source-start',
      source: {
        id: 'source-2',
        file: { name: 'broken.json', data: new ArrayBuffer(0) },
        status: 'failed',
        warnings: [],
      },
    });
    state = vaultReducer(state, {
      type: 'import',
      vault: {
        id: 'source-1',
        name: 'First',
        kind: 'dotenv',
        fileName: 'first.env',
        importedAt: '2026-01-01',
      },
      entries: [
        {
          id: 'entry-1',
          sourceId: 'source-1',
          title: 'First',
          username: '',
          password: '',
          url: '',
          notes: '',
          group: '',
          category: '',
          team: '',
          tags: [],
          extraFields: [],
        },
      ],
      warnings: [],
    });

    expect(vaultReducer(state, { type: 'remove-source', sourceId: 'source-2' })).toMatchObject({
      vaults: [{ id: 'source-1' }],
      entries: [{ current: { id: 'entry-1' } }],
      sources: [{ id: 'source-1' }],
    });
  });
});
