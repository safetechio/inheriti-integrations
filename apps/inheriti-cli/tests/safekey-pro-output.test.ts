import { expect, it, vi } from 'vitest';

const { waitForSafeKeyProDevice } = vi.hoisted(() => ({ waitForSafeKeyProDevice: vi.fn(async (_path?: string, _signal?: AbortSignal) => '/dev/hidraw4') }));
vi.mock('@safetech/inheriti-elements-core/node', async (original) => ({
  ...await original<typeof import('@safetech/inheriti-elements-core/node')>(),
  waitForSafeKeyProDevice,
}));
vi.mock('@safetech/inheriti-core-sdk/node', () => ({
  createNodeSafeKeyProDevice: (options: { onTouch: (operation: 'write', attempt: number, limit: number) => void }) => ({
    write: async () => { options.onTouch('write', 1, 3); options.onTouch('write', 2, 3); options.onTouch('write', 3, 3); },
  }),
}));
import { createCliSafeKeyPro } from '../src/safekey-pro.js';

it('updates one terminal line through repeated PRO touch attempts', async () => {
  const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const previous = process.stderr.isTTY;
  Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: true });
  try {
    await createCliSafeKeyPro({ safeKeyProRpId: 'business.localhost' } as never)!.write({} as never);
    expect(String(write.mock.calls[0]?.[0])).toContain('Connect your SafeKey PRO');
    expect(write.mock.calls.filter(([chunk]) => String(chunk).includes('\n'))).toHaveLength(0);
    expect(write.mock.calls.filter(([chunk]) => String(chunk).includes('\r'))).toHaveLength(5);
  } finally {
    write.mockRestore();
    Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: previous });
  }
});

it('clears the connection prompt when device waiting is canceled', async () => {
  const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const previous = process.stderr.isTTY;
  Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: true });
  waitForSafeKeyProDevice.mockImplementationOnce(async (_path, signal) => new Promise<string>((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
  try {
    const controller = new AbortController();
    const pending = createCliSafeKeyPro({ safeKeyProRpId: 'business.localhost' } as never)!.write({} as never, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('aborted');
    expect(write.mock.calls.at(-1)?.[0]).toBe('\r\x1b[2K');
  } finally {
    write.mockRestore();
    Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: previous });
  }
});
