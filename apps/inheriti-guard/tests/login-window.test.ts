import { afterEach, expect, it, vi } from 'vitest';
import { watchLoginWindow } from '../src/side-panel/login-window.js';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('sizes only the Guard OAuth popup and corrects Chrome if it shrinks again', async () => {
  vi.useFakeTimers();
  const redirect = 'https://extension.example/integrations-oauth';
  let poll = 0;
  const update = vi.fn(async () => undefined);
  const removeListener = vi.fn();
  vi.stubGlobal('chrome', {
    identity: { getRedirectURL: vi.fn(() => redirect) },
    tabs: { onUpdated: { addListener: vi.fn(), removeListener } },
    windows: {
      getAll: vi.fn(async (options?: { populate?: boolean }) => {
        if (!options?.populate) return [{ id: 1, type: 'normal' }];
        poll += 1;
        return [
          { id: 2, type: 'popup', width: 400, height: 300, tabs: [{ url: 'https://other.example/' }] },
          { id: 3, type: 'popup', width: poll === 2 ? 960 : 664, height: poll === 2 ? 760 : 306,
            tabs: [{ url: `https://safeid.example/auth?redirect_uri=${encodeURIComponent(redirect)}` }] },
        ];
      }),
      update,
    },
  });

  const stop = await watchLoginWindow();
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(250);
  expect(update).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(250);
  expect(update).toHaveBeenCalledTimes(2);
  expect(update).toHaveBeenCalledWith(3, { width: 960, height: 760 });
  stop();
  await vi.advanceTimersByTimeAsync(250);
  expect(update).toHaveBeenCalledTimes(2);
  expect(removeListener).toHaveBeenCalledOnce();
});
