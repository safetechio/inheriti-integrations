import { expect, it, vi } from 'vitest';
const { createNodeSafeKeyProDevice } = vi.hoisted(() => ({ createNodeSafeKeyProDevice: vi.fn((options: unknown) => ({ options })) }));
vi.mock('@safetech/inheriti-core-sdk/node', () => ({ createNodeSafeKeyProDevice }));
import { openSafeKeyProPrompt } from '../src/safekey-pro.js';

const context = { organizationId: 'org-1', planId: 'plan-1', selector: 'A1.password', kind: 'FIELD' as const };

async function promptPage(deployment: string, controller: AbortController) {
  let opened!: (url: string) => void;
  const url = new Promise<string>(resolve => { opened = resolve; });
  const prompt = await openSafeKeyProPrompt(deployment, '/dev/hidraw4', context, controller.signal, opened);
  return { prompt, url };
}

it('keeps local choice off the model channel and closes after a mobile choice', async () => {
  const controller = new AbortController();
  const page = await promptPage('local', controller);
  const choice = page.prompt.selectCustodianDevice();
  const url = await page.url;
  const landing = await fetch(url);
  expect(await landing.text()).toContain('SafeKey PRO');
  expect(await (await fetch(url)).text()).toContain('A1.password');
  expect(landing.headers.get('cache-control')).toBe('no-store');
  expect(landing.headers.get('referrer-policy')).toBe('same-origin');
  const origin = new URL(url).origin;
  const selected = await fetch(url, { method: 'POST', redirect: 'manual', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'choice=mobile' });
  expect(selected.status).toBe(303);
  expect(selected.headers.get('location')).toBe(new URL(url).pathname);
  expect(await choice).toBe('SK_MOBILE');
  const duplicate = await fetch(url, { method: 'POST', redirect: 'manual', headers: { Origin: origin }, body: 'choice=mobile' });
  expect(duplicate.status).toBe(303);
  page.prompt.close();
  await expect(fetch(url)).rejects.toThrow();
});

it('rejects cross-origin choice and aborts without a device operation', async () => {
  const controller = new AbortController();
  const page = await promptPage('dev', controller);
  const choice = page.prompt.selectCustodianDevice();
  const url = await page.url;
  const forged = await fetch(url, { method: 'POST', headers: { Origin: 'http://evil.local', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'choice=pro' });
  expect(forged.status).toBe(405);
  controller.abort();
  await expect(choice).rejects.toThrow('local_delivery_canceled');
  page.prompt.close();
});

it('binds a PRO choice to the Business RP ID and keeps PIN out of page responses', async () => {
  const controller = new AbortController();
  const page = await promptPage('dev', controller);
  const choice = page.prompt.selectCustodianDevice();
  const url = await page.url;
  const origin = new URL(url).origin;
  await fetch(url, { method: 'POST', headers: { Origin: origin }, body: 'choice=pro' });
  expect(await choice).toBe('SK_PRO');
  expect(createNodeSafeKeyProDevice).toHaveBeenLastCalledWith(expect.objectContaining({ device: '/dev/hidraw4', rpId: 'business-dev.inheriti.com' }));
  const options = createNodeSafeKeyProDevice.mock.lastCall![0] as { getPin: () => Promise<Uint8Array>; onTouch: (operation: string, attempt: number, limit: number) => void };
  const requested = options.getPin();
  expect(await (await fetch(url)).text()).toContain('type="password"');
  const response = await fetch(url, { method: 'POST', redirect: 'manual', headers: { Origin: origin }, body: 'pin=123456' });
  expect(response.status).toBe(303);
  expect(await response.text()).not.toContain('123456');
  const pin = await requested;
  expect(Buffer.from(pin).toString()).toBe('123456');
  pin.fill(0);
  expect(Buffer.from(await options.getPin()).toString()).toBe('123456');
  expect(await (await fetch(url)).text()).not.toContain('type="password"');
  options.onTouch('read', 2, 20);
  expect(await (await fetch(url)).text()).toContain('read 2/20');
  page.prompt.close();
  await expect(fetch(url)).rejects.toThrow();
});

it('opens the PIN page directly for an existing PRO claim without selecting a device', async () => {
  const controller = new AbortController();
  const page = await promptPage('local', controller);
  const options = createNodeSafeKeyProDevice.mock.lastCall![0] as { getPin: () => Promise<Uint8Array> };
  const requested = options.getPin();
  const url = await page.url;
  const html = await (await fetch(url)).text();
  expect(html).toContain('type="password"');
  expect(html).not.toContain('Where should this plan share');
  controller.abort();
  await expect(requested).rejects.toThrow('local_delivery_canceled');
  page.prompt.close();
});
