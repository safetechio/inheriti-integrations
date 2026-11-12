// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePlanBatch } from '@modules/batch/application/use-plan-batch';

describe('usePlanBatch', () => {
  it('drops a failed snapshot and its retry id when reset for a new import', async () => {
    const configure = vi
      .fn()
      .mockRejectedValueOnce(new Error('stage failed'))
      .mockResolvedValue(undefined);
    const { result } = renderHook(() => usePlanBatch({ create: async () => {}, configure }));
    await act(async () => {
      await result.current.run([{ planId: 'old', input: { secret: 'old' } }]);
    });
    expect(result.current.result.createdUnconfigured).toHaveLength(1);
    act(() => result.current.reset());
    expect(result.current.items).toEqual([]);
    await act(async () => {
      await result.current.retryConfigure('old');
    });
    expect(configure).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.run([{ planId: 'new', input: { secret: 'new' } }]);
    });
    expect(result.current.items.map((item) => item.planId)).toEqual(['new']);
  });

  it('does not restore a discarded snapshot after a delayed configure settles', async () => {
    let finish!: () => void;
    const configure = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => usePlanBatch({ create: async () => {}, configure }));
    act(() => {
      void result.current.run([{ planId: 'old', input: { secret: 'old' } }]);
    });
    await waitFor(() => expect(configure).toHaveBeenCalledTimes(1));
    act(() => result.current.reset());
    await act(async () => finish());
    expect(result.current.items).toEqual([]);
    expect(result.current.running).toBe(false);
  });
});
