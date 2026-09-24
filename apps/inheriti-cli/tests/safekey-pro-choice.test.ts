import { expect, it, vi } from 'vitest';

const promptSelect = vi.hoisted(() => vi.fn());
vi.mock('../src/render/select.jsx', () => ({ promptSelect }));
import { selectCliCustodianDevice } from '../src/safekey-pro.js';

it('lets the operator switch to SafeKey Mobile before starting a PRO operation', async () => {
  promptSelect.mockResolvedValueOnce('SK_PRO').mockResolvedValueOnce('SK_MOBILE');
  const terminal = { interactive: true, write: vi.fn() } as never;
  await expect(selectCliCustodianDevice(terminal)).resolves.toBe('SK_MOBILE');
  expect(promptSelect).toHaveBeenCalledTimes(2);
  expect(promptSelect.mock.calls[1]?.[0]).toContain('Connect your SafeKey PRO');
});
