import { expect, it, vi } from 'vitest';
import { resolveConfiguration } from '../src/configuration.js';
import { createIdeSafeKeyPro, selectIdeCustodianDevice } from '../src/safekey-pro.js';

vi.mock('@safetech/inheriti-core-sdk/node', () => ({ createNodeSafeKeyProDevice: (options: unknown) => options }));

it('uses the Business UI RP ID for a local PRO device', () => {
  const values: Record<string, string> = { deployment: 'dev', safeKeyProDevice: '/dev/hidraw4' };
  const configuration = resolveConfiguration((key) => values[key]);
  expect(configuration.safeKeyProDevice).toBe('/dev/hidraw4');
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
  const device = createIdeSafeKeyPro({ safeKeyProDevice: '/dev/hidraw4', safeKeyProRpId: 'business.localhost' } as never,
    { readPin, touch: vi.fn() }) as unknown as { getPin(signal?: AbortSignal): Promise<Uint8Array> };
  await expect(device.getPin(controller.signal)).rejects.toThrow('SAFEKEY_ABORTED');
  expect(readPin).toHaveBeenCalledOnce();
});
