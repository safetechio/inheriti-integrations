import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const parseVaultFile = vi.fn();

vi.mock('@modules/import/infrastructure/parsers', () => ({
  parseVaultFile: (...args: unknown[]) => parseVaultFile(...args),
}));

import { useImportLifecycle } from '@modules/import/application/use-import-lifecycle';
import { importSessionFromVaultState } from '@modules/import/infrastructure/stores/vault-session-adapter';
import { createEmptyEntry, sourceFieldId, VaultUnlockError } from '@modules/import/domain/vault';

describe('useImportLifecycle', () => {
  beforeEach(() => {
    parseVaultFile.mockReset();
  });

  it('marks only unlock attempts as unlocking and returns to Locked on wrong credentials', async () => {
    parseVaultFile.mockRejectedValueOnce(new VaultUnlockError('Synthetic locked vault'));
    const { result } = renderHook(() => useImportLifecycle());
    await act(async () => {
      await result.current.importFiles([{ name: 'vault.kdbx', data: new ArrayBuffer(1) }]);
    });
    const sourceId = result.current.state.sources[0].id;
    expect(result.current.state.sources[0].status).toBe('unlock-required');

    let rejectUnlock!: (reason: Error) => void;
    parseVaultFile.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectUnlock = reject;
      }),
    );
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.unlockSource(sourceId, 'wrong', new ArrayBuffer(2));
    });
    expect(result.current.state.sources[0].status).toBe('unlocking');
    await act(async () => {
      rejectUnlock(new VaultUnlockError('Synthetic wrong password'));
      await pending;
    });
    expect(result.current.state.sources[0].status).toBe('unlock-required');

    parseVaultFile.mockResolvedValueOnce({
      kind: 'keepass',
      name: 'vault',
      entries: [],
      warnings: [],
    });
    await act(async () => {
      await result.current.unlockSource(sourceId, 'correct', new ArrayBuffer(2));
    });
    expect(result.current.state.sources[0].status).toBe('imported');
  });

  it('ignores a parser result that resolves after the import session is purged', async () => {
    let resolveParse: ((value: unknown) => void) | undefined;
    parseVaultFile.mockReturnValue(
      new Promise((resolve) => {
        resolveParse = resolve;
      }),
    );
    const { result } = renderHook(() => useImportLifecycle());
    let pending: Promise<unknown> | undefined;

    act(() => {
      pending = result.current.importFiles([{ name: 'late.env', data: new ArrayBuffer(1) }]);
    });
    expect(result.current.state.sources).toHaveLength(1);

    act(() => result.current.purge());
    await act(async () => {
      resolveParse?.({ kind: 'dotenv', name: 'late.env', entries: [], warnings: [] });
      await pending;
    });

    expect(result.current.state.sources).toEqual([]);
    expect(result.current.state.vaults).toEqual([]);
    expect(result.current.state.entries).toEqual([]);
  });

  it('ignores a parser result that resolves after its source is removed', async () => {
    let resolveParse: ((value: unknown) => void) | undefined;
    parseVaultFile.mockReturnValue(
      new Promise((resolve) => {
        resolveParse = resolve;
      }),
    );
    const { result } = renderHook(() => useImportLifecycle());
    let pending: Promise<unknown> | undefined;

    act(() => {
      pending = result.current.importFiles([{ name: 'late.env', data: new ArrayBuffer(1) }]);
    });
    const sourceId = result.current.state.sources[0].id;
    act(() => result.current.removeSource(sourceId));
    await act(async () => {
      resolveParse?.({ kind: 'dotenv', name: 'late.env', entries: [], warnings: [] });
      await pending;
    });

    expect(result.current.state.sources).toEqual([]);
    expect(result.current.state.vaults).toEqual([]);
  });
  it('carries value-free parser diagnostics through the store into the production session', async () => {
    parseVaultFile.mockResolvedValueOnce({
      kind: 'onepassword',
      name: 'vault',
      entries: [createEmptyEntry({ id: 'parser-item', title: 'An item' })],
      warnings: [],
      diagnostics: [
        {
          code: 'test-item',
          kind: 'unsupported',
          message: 'History skipped.',
          count: 2,
          entryId: 'parser-item',
        },
        {
          code: 'test-source',
          kind: 'skipped',
          message: 'Attachment skipped.',
          count: 1,
          sourcePath: ['files'],
        },
      ],
    });
    const { result } = renderHook(() => useImportLifecycle());
    await act(async () => {
      await result.current.importFiles([{ name: 'vault.1pux', data: new ArrayBuffer(1) }]);
    });
    const state = result.current.state;
    expect(state.sources[0].status).toBe('warning');
    const session = importSessionFromVaultState(state);
    expect(session.sources[0].diagnostics).toEqual(state.sources[0].diagnostics);
    expect(session.sources[0].diagnostics).toEqual([
      expect.objectContaining({ code: 'test-item', entryId: state.entries[0].current.id }),
      expect.objectContaining({ code: 'test-source', sourcePath: ['files'] }),
    ]);
  });
  it('retains distinct Passbolt values for identical resource IDs across files', async () => {
    const { parseVaultFile: realParse } = await vi.importActual<
      typeof import('@modules/import/infrastructure/parsers')
    >('@modules/import/infrastructure/parsers');
    parseVaultFile.mockImplementation(realParse);

    const file = (name: string, password: string) => ({
      name,
      data: new TextEncoder().encode(
        JSON.stringify([{ id: 'same-resource', name: 'VPN', secret: password }]),
      ).buffer,
    });
    const { result } = renderHook(() => useImportLifecycle());
    await act(async () => {
      await result.current.importFiles([file('first.json', 'one'), file('second.json', 'two')]);
    });

    const session = importSessionFromVaultState(result.current.state);
    const entryIds = ['first.json', 'second.json'].map(
      (fileName) =>
        `${session.sources.find((source) => source.fileName === fileName)?.id}:same-resource`,
    );
    expect(session.rootNodeIds).toEqual(expect.arrayContaining(entryIds));
    expect(Object.keys(session.nodesById)).toHaveLength(2);
    expect(Object.keys(session.fieldsById)).toHaveLength(2);
    expect(
      entryIds.map((id) => session.fieldsById[sourceFieldId(id, 'password')].value.reveal()),
    ).toEqual(['one', 'two']);
  });

  it('preserves duplicate IDs, delimiter-bearing fields and source tags in one Passbolt file', async () => {
    const { parseVaultFile: realParse } = await vi.importActual<
      typeof import('@modules/import/infrastructure/parsers')
    >('@modules/import/infrastructure/parsers');
    parseVaultFile.mockImplementation(realParse);

    const data = new TextEncoder().encode(
      JSON.stringify([
        {
          id: 'a',
          name: 'First',
          secret: 'first',
          'b:password': 'custom',
          tags: ['two words', 'x,y'],
        },
        { id: 'a', name: 'Second', secret: 'second', modified: '2026-01-01' },
        { id: 'a~2', name: 'Literal suffix', secret: 'third' },
        { id: 'a:extra:b', name: 'Delimiter', secret: 'fourth' },
      ]),
    ).buffer;
    const { result } = renderHook(() => useImportLifecycle());
    await act(async () => {
      await result.current.importFiles([{ name: 'vault.json', data }]);
    });

    const session = importSessionFromVaultState(result.current.state);
    expect(session.rootNodeIds).toHaveLength(4);
    expect(Object.keys(session.nodesById)).toHaveLength(4);
    expect(Object.values(session.fieldsById).map(({ value }) => value.reveal())).toEqual([
      'first',
      'custom',
      'two words',
      'x,y',
      'second',
      'third',
      'fourth',
    ]);
    expect(session.sources[0].diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'duplicate-source-entry-id',
          kind: 'transformed',
          count: 1,
        }),
        expect.objectContaining({ code: 'passbolt-resource-metadata', count: 1 }),
      ]),
    );
    expect(
      session.sources[0].diagnostics?.find(({ code }) => code === 'passbolt-resource-metadata')
        ?.entryId,
    ).toBeUndefined();
  });
});
