import { expect, it, vi } from 'vitest';
import { createSafeKeyProPinSession } from '../src/node-safekey-pro.js';

it('uses one PIN for write and read, then clears it at the end of the reveal', async () => {
  const prompt = vi.fn().mockResolvedValueOnce(Uint8Array.from([49, 50, 51, 52]))
    .mockResolvedValueOnce(Uint8Array.from([53, 54, 55, 56]));
  const session = createSafeKeyProPinSession(prompt);
  const writePin = await session.getPin();
  writePin.fill(0);
  expect(await session.getPin()).toEqual(Uint8Array.from([49, 50, 51, 52]));
  expect(prompt).toHaveBeenCalledOnce();
  session.clearPin();
  expect(await session.getPin()).toEqual(Uint8Array.from([53, 54, 55, 56]));
  expect(prompt).toHaveBeenCalledTimes(2);
  session.clearPin();
});
