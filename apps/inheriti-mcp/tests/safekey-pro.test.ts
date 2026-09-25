import { expect, it, vi } from 'vitest';
const { createNodeSafeKeyProDevice } = vi.hoisted(() => ({ createNodeSafeKeyProDevice: vi.fn((options: unknown) => ({ options, write: async () => undefined, read: async () => undefined })) }));
vi.mock('@safetech/inheriti-core-sdk/node', async (original) => ({ ...await original<typeof import('@safetech/inheriti-core-sdk/node')>(), createNodeSafeKeyProDevice }));
vi.mock('@safetech/inheriti-elements-core/node', async (original) => ({ ...await original<typeof import('@safetech/inheriti-elements-core/node')>(), waitForSafeKeyProDevice: async () => '/dev/hidraw4' }));
import { openSafeKeyProPrompt } from '../src/safekey-pro.js';

const context = { organizationId: 'org-1', planId: 'plan-1', selector: 'A1.password', kind: 'FIELD' as const };

async function promptPage(deployment: string, controller: AbortController, device?: string) {
  let opened!: (url: string) => void;
  const url = new Promise<string>(resolve => { opened = resolve; });
  const prompt = await openSafeKeyProPrompt(deployment, device, context, controller.signal, opened);
  return { prompt, url };
}

it('keeps local choice off the model channel and closes after a mobile choice', async () => {
  const controller = new AbortController();
  const page = await promptPage('local', controller);
  const choice = page.prompt.selectCustodianDevice();
  const url = await page.url;
  const landing = await fetch(url);
  const html = await landing.text();
  expect(html).toContain('SafeKey PRO');
  expect(html).toContain('Choose a custodian device');
  expect(html).toContain('A request to claim this plan share will be sent to your SafeKey Mobile.');
  expect(html).toContain('Future access will require the same device');
  expect(html).toContain('Inheriti® Business');
  expect(html).toMatch(/font-family:\s*AppFont/);
  expect(html).toContain('data:image/png;base64,');
  expect(html).toMatch(/background:\s*#2962ff/);
  expect(landing.headers.get('content-security-policy')).toContain('img-src data:');
  expect(landing.headers.get('content-security-policy')).toContain('font-src data:');
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

it('offers PRO while the device is disconnected and then asks to connect it', async () => {
  const controller = new AbortController();
  const page = await promptPage('local', controller);
  const choice = page.prompt.selectCustodianDevice();
  const url = await page.url;
  const html = await (await fetch(url)).text();
  expect(html).toContain('SafeKey PRO');
  expect(html).toContain('Connect your SafeKey PRO cold device to write this plan share.');
  const origin = new URL(url).origin;
  await fetch(url, { method: 'POST', headers: { Origin: origin }, body: 'choice=pro' });
  expect(await choice).toBe('SK_PRO');
  const waiting = await (await fetch(url)).text();
  expect(waiting).toContain('Waiting for SafeKey PRO');
  expect(waiting).toContain('Connect your SafeKey PRO to this computer');
  page.prompt.close();
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
  await page.prompt.proDevice!.write({} as never);
  expect(createNodeSafeKeyProDevice).toHaveBeenLastCalledWith(expect.objectContaining({ device: '/dev/hidraw4', rpId: 'business-dev.inheriti.com' }));
  const options = createNodeSafeKeyProDevice.mock.lastCall![0] as { getPin: () => Promise<Uint8Array>; onTouch: (operation: string, attempt: number, limit: number) => void };
  const requested = options.getPin();
  const pinPage = await (await fetch(url)).text();
  expect(pinPage).toContain('type="password"');
  expect(pinPage).toContain('Write to device');
  expect(pinPage).toContain('data:image/png;base64,');
  const response = await fetch(url, { method: 'POST', redirect: 'manual', headers: { Origin: origin }, body: 'pin=123456' });
  expect(response.status).toBe(303);
  expect(await response.text()).not.toContain('123456');
  const pin = await requested;
  expect(Buffer.from(pin).toString()).toBe('123456');
  pin.fill(0);
  expect(Buffer.from(await options.getPin()).toString()).toBe('123456');
  expect(await (await fetch(url)).text()).not.toContain('type="password"');
  options.onTouch('write', 1, 20);
  expect(await (await fetch(url)).text()).toContain('Writing to SafeKey PRO');
  options.onTouch('read', 2, 20);
  const reading = await (await fetch(url)).text();
  expect(reading).toContain('Reading from SafeKey PRO');
  expect(reading).toContain('Touch request 2 of 20');
  page.prompt.close('complete');
  expect(await (await fetch(url)).text()).toContain('Request complete');
  page.prompt.close();
  await expect(fetch(url)).rejects.toThrow();
});

it('opens the PIN page directly for an existing PRO claim without selecting a device', async () => {
  const controller = new AbortController();
  const page = await promptPage('local', controller);
  await page.prompt.proDevice!.read({} as never);
  const options = createNodeSafeKeyProDevice.mock.lastCall![0] as { getPin: () => Promise<Uint8Array> };
  const requested = options.getPin();
  const url = await page.url;
  const html = await (await fetch(url)).text();
  expect(html).toContain('type="password"');
  expect(html).not.toContain('Where should this plan share');
  expect(html).toContain('Device PIN');
  expect(html).toContain('Connect &amp; collect');
  controller.abort();
  await expect(requested).rejects.toThrow('local_delivery_canceled');
  page.prompt.close();
});
