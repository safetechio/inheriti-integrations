import { afterEach, expect, it, vi } from 'vitest';

const hardware = vi.hoisted(() => ({ create: vi.fn(() => ({
  write: vi.fn(async () => ({ deviceId: 'device' })),
  read: vi.fn(async () => ({ id: 'share', planId: 'plan', shares: ['sealed'], deviceId: 'device' })),
})) }));
vi.mock('@safetech/inheriti-elements-core/node', () => ({
  businessUiRpId: () => 'business.localhost',
  createNodeSafeKeyProDevice: hardware.create,
  createSafeKeyProPinSession: () => ({ getPin: async () => new Uint8Array(), clearPin: vi.fn() }),
  waitForSafeKeyProDevice: async () => '/dev/hidraw0',
}));

import { CustodianPrompt } from '../src/modules/quick-plan/main/custodian-prompt.js';
import { createTraySafeKeyPro } from '../src/modules/quick-plan/main/safekey-pro.js';

afterEach(() => { vi.unstubAllEnvs(); hardware.create.mockClear(); });

it('uses the local Business UI RP for a local tray write, with an explicit local override', async () => {
  vi.stubEnv('INHERITI_APP_URL', 'http://localhost:8081');
  const prompt = new CustodianPrompt();
  await createTraySafeKeyPro('local', prompt)!.write({ id: 'share', planId: 'plan', shares: ['sealed'] });
  expect(hardware.create).toHaveBeenCalledWith(expect.objectContaining({ rpId: 'localhost' }));
  expect(prompt.state()).toEqual({ kind: 'working', firstAccess: true });

  vi.stubEnv('INHERITI_SAFEKEY_PRO_RP_ID', 'business-dev.inheriti.com');
  await createTraySafeKeyPro('local', prompt)!.write({ id: 'share', planId: 'plan', shares: ['sealed'] });
  expect(hardware.create).toHaveBeenLastCalledWith(expect.objectContaining({ rpId: 'business-dev.inheriti.com' }));
});

it('retries a rejected PIN without leaving the device flow', async () => {
  const write = vi.fn().mockRejectedValueOnce(new Error('SAFEKEY_INVALID_PIN')).mockResolvedValueOnce({ deviceId: 'device' });
  hardware.create.mockImplementationOnce(() => ({ write, read: vi.fn() }));
  const prompt = new CustodianPrompt();
  await expect(createTraySafeKeyPro('local', prompt)!.write({ id: 'share', planId: 'plan', shares: ['sealed'] })).resolves.toEqual({ deviceId: 'device' });
  expect(write).toHaveBeenCalledTimes(2);
  expect(prompt.state()).toEqual({ kind: 'working', firstAccess: true });
});
