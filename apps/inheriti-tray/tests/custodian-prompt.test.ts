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
  expect(prompt.state()).toEqual({ kind: 'pin', firstAccess: false });
  expect(() => prompt.submitPin('bad\nPIN')).toThrow('invalid_safekey_pin');
  prompt.submitPin('1234');
  expect(await pin).toEqual(new TextEncoder().encode('1234'));
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
