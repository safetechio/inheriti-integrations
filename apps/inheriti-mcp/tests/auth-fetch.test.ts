import { afterEach, expect, it, vi } from 'vitest';
import { authFetch } from '../src/runtime/auth-fetch.js';

afterEach(() => vi.restoreAllMocks());

it('bounds an OAuth request and preserves a caller cancellation', async () => {
  const deadline = new AbortController();
  const nextDeadline = new AbortController();
  const caller = new AbortController();
  const request = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    if (init?.signal?.aborted) { reject(init.signal.reason); return; }
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
  }));
  vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(deadline.signal).mockReturnValueOnce(nextDeadline.signal);
  vi.stubGlobal('fetch', request);
  try {
    const timedOut = authFetch('https://issuer.test/token');
    deadline.abort(new Error('deadline'));
    await expect(timedOut).rejects.toThrow('deadline');

    const canceled = authFetch('https://issuer.test/token', { signal: caller.signal });
    caller.abort(new Error('canceled'));
    await expect(canceled).rejects.toThrow('canceled');
    expect(AbortSignal.timeout).toHaveBeenCalledWith(60_000);
    expect(request).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
  }
});
