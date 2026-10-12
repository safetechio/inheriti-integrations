import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const parseVaultFile = vi.fn();

vi.mock('@modules/import/infrastructure/parsers', () => ({
  parseVaultFile: (...args: unknown[]) => parseVaultFile(...args),
}));

import { useImportLifecycle } from '@modules/import/application/use-import-lifecycle';

describe('useImportLifecycle', () => {
  beforeEach(() => {
    parseVaultFile.mockReset();
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
