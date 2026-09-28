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

it('rejects and erases a PIN entered after its session was cleared', async () => {
  let enter!: (pin: Uint8Array) => void;
  const pending = new Promise<Uint8Array>(resolve => { enter = resolve; });
  const prompt = vi.fn().mockReturnValueOnce(pending)
    .mockResolvedValueOnce(Uint8Array.from([53, 54, 55, 56]));
  const session = createSafeKeyProPinSession(prompt);
  const requested = session.getPin();
  session.clearPin();
  const entered = Uint8Array.from([49, 50, 51, 52]);
  enter(entered);
  await expect(requested).rejects.toThrow('SAFEKEY_ABORTED');
  expect(entered).toEqual(new Uint8Array(4));
  expect(await session.getPin()).toEqual(Uint8Array.from([53, 54, 55, 56]));
  expect(prompt).toHaveBeenCalledTimes(2);
  session.clearPin();
});
