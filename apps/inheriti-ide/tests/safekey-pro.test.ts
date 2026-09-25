import { expect, it, vi } from 'vitest';
import { resolveConfiguration } from '../src/configuration.js';
import { createIdeSafeKeyPro, selectIdeCustodianDevice } from '../src/safekey-pro.js';

vi.mock('@safetech/inheriti-elements-core/node', async (original) => ({ ...await original<typeof import('@safetech/inheriti-elements-core/node')>(), waitForSafeKeyProDevice: async () => '/dev/hidraw4' }));
vi.mock('@safetech/inheriti-core-sdk/node', () => ({ createNodeSafeKeyProDevice: (options: { getPin: (signal?: AbortSignal) => Promise<Uint8Array> }) => ({
  write: (_share: unknown, signal?: AbortSignal) => options.getPin(signal),
  read: (_request: unknown, signal?: AbortSignal) => options.getPin(signal),
}) }));

it('uses the Business UI RP ID and offers PRO without a connected device', () => {
  const values: Record<string, string> = { deployment: 'dev' };
  const configuration = resolveConfiguration((key) => values[key]);
  expect(configuration.safeKeyProDevice).toBeUndefined();
  expect(configuration.safeKeyProRpId).toBe('business-dev.inheriti.com');
});

it('requires a current human choice and cancels stale selections', async () => {
  const controller = new AbortController();
  const pick = vi.fn(async (signal?: AbortSignal) => { expect(signal).toBe(controller.signal); controller.abort(); return 'SK_PRO' as const; });
  await expect(selectIdeCustodianDevice(pick, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
});

it('passes cancellation to the PIN prompt and preserves the adapter cancel code', async () => {
  const controller = new AbortController();
  const readPin = vi.fn(async (signal?: AbortSignal) => { expect(signal).toBe(controller.signal); controller.abort(); return undefined; });
  const device = createIdeSafeKeyPro({ safeKeyProRpId: 'business.localhost' } as never,
    { readPin, touch: vi.fn() })!;
  await expect(device.write({} as never, controller.signal)).rejects.toThrow('SAFEKEY_ABORTED');
  expect(readPin).toHaveBeenCalledOnce();
});

it('asks for the PIN once across PRO write and verification read', async () => {
  const readPin = vi.fn().mockResolvedValueOnce('1234').mockResolvedValueOnce('5678');
  const device = createIdeSafeKeyPro({ safeKeyProRpId: 'business.localhost' } as never,
    { readPin, touch: vi.fn() })!;
  await device.write({} as never);
  expect(await device.read({} as never)).toEqual(Uint8Array.from([49, 50, 51, 52]));
  expect(readPin).toHaveBeenCalledOnce();
  device.clearPin();
  expect(await device.read({} as never)).toEqual(Uint8Array.from([53, 54, 55, 56]));
  expect(readPin).toHaveBeenCalledTimes(2);
});
