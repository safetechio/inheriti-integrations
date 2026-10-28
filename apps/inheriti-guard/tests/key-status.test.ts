import { describe, expect, it, vi } from 'vitest';
import { createKeyStatusRefresh } from '../src/side-panel/main/key-status.js';

describe('panel key status', () => {
  it('does not start during loading or apply an old account response after a switch begins', async () => {
    let context = { revision: 1, kind: 'LOADING' };
    let finish!: (value: { ok: true; keyStatus: { owner: 'Organization'; loaded: true } }) => void;
    const send = vi.fn(() => new Promise<ReturnType<typeof payload>>((resolve) => { finish = resolve; }));
    const render = vi.fn();
    const refresh = createKeyStatusRefresh(send as never, () => context, render);

    await refresh();
    expect(send).not.toHaveBeenCalled();

    context = { revision: 1, kind: 'PLANS' };
    const pending = refresh();
    expect(send).toHaveBeenCalledOnce();
    context = { revision: 2, kind: 'LOADING' };
    finish(payload());
    await pending;
    expect(render).not.toHaveBeenCalled();
  });
});

function payload() { return { ok: true as const, keyStatus: { owner: 'Organization' as const, loaded: true as const } }; }
