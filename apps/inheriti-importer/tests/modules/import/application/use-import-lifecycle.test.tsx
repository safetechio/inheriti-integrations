import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const parseVaultFile = vi.fn();

vi.mock('@modules/import/infrastructure/parsers', () => ({
  parseVaultFile: (...args: unknown[]) => parseVaultFile(...args),
}));

import { useImportLifecycle } from '@modules/import/application/use-import-lifecycle';
import { VaultUnlockError } from '@modules/import/domain/vault';

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
});
