import { expect, it, vi } from 'vitest';
import { CustodianPrompt } from '../src/modules/quick-plan/main/custodian-prompt.js';

it('accepts only an offered device and keeps the PIN out of state', async () => {
  const prompt = new CustodianPrompt();
  prompt.setPublisher(vi.fn());
  const choice = prompt.choose(false);
  expect(prompt.state()).toEqual({ kind: 'choice', proAvailable: false });
  expect(() => prompt.select('SK_PRO')).toThrow('safekey_pro_unavailable');
  prompt.select('SK_MOBILE');
  await expect(choice).resolves.toBe('SK_MOBILE');

  const pin = prompt.readPin(false);
  expect(prompt.state()).toEqual({ kind: 'pin', firstAccess: false, invalidPin: false });
  expect(() => prompt.submitPin('bad\nPIN')).toThrow('invalid_safekey_pin');
  prompt.submitPin('1234');
  expect(await pin).toEqual(new TextEncoder().encode('1234'));
  expect(prompt.state()).toEqual({ kind: 'working', firstAccess: false });
  prompt.clear();
  expect(prompt.state()).toBeUndefined();
});

it('shows a rejected PIN in the PIN state and accepts another entry', async () => {
  const prompt = new CustodianPrompt();
  const retry = prompt.readPin(true, undefined, true);
  expect(prompt.state()).toEqual({ kind: 'pin', firstAccess: true, invalidPin: true });
  prompt.submitPin('5678');
  expect(await retry).toEqual(new TextEncoder().encode('5678'));
  expect(prompt.state()).toEqual({ kind: 'working', firstAccess: true });
});

it('keeps first access on the device screen from selection through PIN submission', async () => {
  const prompt = new CustodianPrompt();
  const choice = prompt.choose(true);
  prompt.select('SK_PRO');
  await expect(choice).resolves.toBe('SK_PRO');
  expect(prompt.state()).toEqual({ kind: 'connect', firstAccess: true });
  const pin = prompt.readPin(true);
  prompt.submitPin('1234');
  await pin;
  expect(prompt.state()).toEqual({ kind: 'working', firstAccess: true });
  prompt.touch(true, 'write', 1, 20);
  expect(prompt.state()).toEqual({ kind: 'touch', firstAccess: true, operation: 'write', attempt: 1, limit: 20 });
  prompt.clear();
  expect(prompt.state()).toBeUndefined();
});

it('cancels a pending device prompt', async () => {
  const prompt = new CustodianPrompt();
  const signal = new AbortController();
  const choice = prompt.choose(true, signal.signal);
  signal.abort();
  await expect(choice).rejects.toThrow('custodian_prompt_canceled');
  expect(prompt.state()).toBeUndefined();
});
