import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn }));
import { deliverAssetInBrowser, deliverFieldsInBrowser, deliverInBrowser, deliverSelectionInBrowser, openLocalBrowser } from '../src/local-browser.js';

it('delivers once to loopback after an explicit click and then closes', async () => {
  let url = '';
  const secret = '<private>&';
  const delivery = deliverInBrowser('account.password', secret, { timeoutMs: 1000, open: value => { url = value; } });
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{48}$/);
  const landing = await fetch(url);
  const prompt = await landing.text();
  expect(prompt).not.toContain(secret);
  expect(prompt).toContain('Inheriti® Business');
  expect(prompt).toContain('Reveal protected field');
  const revealed = await fetch(url, { method: 'POST' });
  const html = await revealed.text();
  expect(html).toContain('Protected field revealed');
  expect(html).toContain('&lt;private&gt;&amp;');
  await delivery;
  await expect(fetch(url)).rejects.toThrow();
});

it('expires without exposing the value', async () => {
  let url = '';
  await expect(deliverInBrowser('account.password', 'private', { timeoutMs: 20, open: value => { url = value; } })).rejects.toThrow('local_delivery_expired');
  await expect(fetch(url)).rejects.toThrow();
});

it('closes a partial POST socket on abort without a server crash', async () => {
  const { connect } = await import('node:net');
  const controller = new AbortController();
  let url = '';
  const delivery = deliverInBrowser('account.password', 'private', { signal: controller.signal, open: value => { url = value; } });
  await new Promise(resolve => setTimeout(resolve, 10));
  const address = new URL(url);
  const socket = connect(Number(address.port), '127.0.0.1');
  await new Promise<void>(resolve => socket.once('connect', resolve));
  socket.on('error', () => undefined);
  socket.write(`POST ${address.pathname} HTTP/1.1\r\nHost: ${address.host}\r\nContent-Length: 100\r\n\r\npartial`);
  const closed = new Promise<void>(resolve => socket.once('close', () => resolve()));
  controller.abort();
  await expect(delivery).rejects.toThrow('local_delivery_canceled');
  await closed;
});

it('offers binary bytes only after a local click as a one-time attachment', async () => {
  let url = '';
  const bytes = Uint8Array.from([0, 60, 115, 99, 114, 105, 112, 116, 62, 255]);
  const delivery = deliverAssetInBrowser('report"\r\n.html', bytes, { timeoutMs: 1000, open: value => { url = value; } });
  await new Promise(resolve => setTimeout(resolve, 10));
  const landing = await fetch(url);
  expect(landing.headers.get('content-security-policy')).toContain("default-src 'none'");
  const html = await landing.text();
  expect(html).not.toContain('<script>');
  expect(html).toContain('Inheriti® Business');
  expect(html).toContain('Download protected file');
  expect(html).toContain('Download file');
  expect(html).toContain('report___.html');
  expect(html).toContain('HTML file');
  expect(html).toContain('&lt;1 KB');
  const download = await fetch(url, { method: 'POST' });
  expect(download.headers.get('content-type')).toBe('application/octet-stream');
  expect(download.headers.get('content-disposition')).toBe('attachment; filename="report___.html"');
  expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);
  await delivery;
  await expect(fetch(url)).rejects.toThrow();
});

it.skipIf(process.platform === 'win32').each(['FIELD', 'ASSET'] as const)('fails %s delivery when the browser launcher exits unsuccessfully', async kind => {
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
  spawn.mockReturnValueOnce(child);
  const delivery = kind === 'FIELD'
    ? deliverInBrowser('account.password', 'private', { timeoutMs: 1000 })
    : deliverAssetInBrowser('private.bin', Uint8Array.from([255]), { timeoutMs: 1000 });
  const rejected = expect(delivery).rejects.toThrow('local_browser_unavailable');
  await vi.waitFor(() => expect(child.unref).toHaveBeenCalledOnce());
  child.emit('exit', 3, null);
  await rejected;
});

it('does not treat a successful browser launcher exit as confirmation', async () => {
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
  spawn.mockReturnValueOnce(child);
  const delivery = deliverInBrowser('account.password', 'private', { timeoutMs: 100 });
  const rejected = expect(delivery).rejects.toThrow('local_delivery_expired');
  await vi.waitFor(() => expect(child.unref).toHaveBeenCalledOnce());
  child.emit('exit', 0, null);
  await rejected;
});

it.each(['error', 'signal'])('rejects browser launcher %s safely', async event => {
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
  spawn.mockReturnValueOnce(child);
  const delivery = deliverInBrowser('account.password', 'private', { timeoutMs: 1000 });
  const rejected = expect(delivery).rejects.toThrow('local_browser_unavailable');
  await vi.waitFor(() => expect(child.unref).toHaveBeenCalledOnce());
  if (event === 'error') child.emit('error', new Error('private launch diagnostic'));
  if (event === 'signal') child.emit('exit', null, 'SIGTERM');
  await rejected;
});

it('preserves cancellation when the launcher exits after an abort', async () => {
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
  spawn.mockReturnValueOnce(child);
  const controller = new AbortController();
  const delivery = deliverInBrowser('account.password', 'private', { signal: controller.signal });
  const rejected = expect(delivery).rejects.toThrow('local_delivery_canceled');
  await vi.waitFor(() => expect(child.unref).toHaveBeenCalledOnce());
  controller.abort();
  child.emit('exit', 3, null);
  await rejected;
});

it('allows a nonzero Windows Explorer exit after shell dispatch', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
  spawn.mockReturnValueOnce(child);
  const failed = vi.fn();
  try {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    openLocalBrowser('http://127.0.0.1/', failed);
    child.emit('exit', 1, null);
    expect(failed).not.toHaveBeenCalled();
    child.emit('error', new Error('private launch diagnostic'));
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ message: 'local_browser_unavailable' }));
  } finally { Object.defineProperty(process, 'platform', platform); }
});

it('confirms all fields together and escapes selectors and values without exposing values on GET', async () => {
  let opened!: (url: string) => void;
  const ready = new Promise<string>(resolve => { opened = resolve; });
  const delivery = deliverFieldsInBrowser([
    { selector: 'account.<password>', value: '<private>&' },
    { selector: 'account.token', value: { token: 'second-secret' } },
  ], { timeoutMs: 1000, open: opened });
  const url = await ready;
  const landing = await fetch(url);
  expect(landing.headers.get('cache-control')).toBe('no-store');
  expect(landing.headers.get('referrer-policy')).toBe('no-referrer');
  const prompt = await landing.text();
  expect(prompt).toContain('account.&lt;password&gt;');
  expect(prompt).toContain('account.token');
  expect(prompt).not.toContain('private');
  expect(prompt).not.toContain('second-secret');
  const html = await (await fetch(url, { method: 'POST' })).text();
  expect(html).toContain('Protected fields revealed');
  expect(html).toContain('&lt;private&gt;&amp;');
  expect(html).toContain('second-secret');
  expect(html).not.toContain('account.<password>');
  await delivery;
  await expect(fetch(url, { method: 'POST' })).rejects.toThrow();
});

it('delivers mixed fields and files once and waits for every file download', async () => {
  let opened!: (url: string) => void;
  const ready = new Promise<string>(resolve => { opened = resolve; });
  const delivery = deliverSelectionInBrowser([{ selector: 'account.password', value: '<private>' }], [
    { selector: 'files.<first>', fileName: 'first"\r\n.bin', bytes: Uint8Array.from([0, 255, 1]) },
    { selector: 'files.second', fileName: 'second.bin', bytes: Uint8Array.from([2, 3]) },
  ], { timeoutMs: 1000, open: opened });
  let settled = false;
  void delivery.then(() => { settled = true; });
  const url = await ready;
  expect((await fetch(`${url}/0`, { method: 'POST' })).status).toBe(403);
  expect((await fetch(`${url}/0`)).status).toBe(405);
  expect((await fetch(`${url}/2`, { method: 'POST' })).status).toBe(404);
  const { get } = await import('node:http');
  const invalidHost = await new Promise<number | undefined>((resolve, reject) => {
    get(url, { headers: { host: 'example.invalid' } }, response => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject);
  });
  expect(invalidHost).toBe(404);
  const prompt = await (await fetch(url)).text();
  expect(prompt).toContain('files.&lt;first&gt;');
  expect(prompt).toContain('files.second');
  expect(prompt).not.toContain('private');
  const result = await (await fetch(url, { method: 'POST' })).text();
  expect(result).toContain('&lt;private&gt;');
  expect(result).toContain(`action="${new URL(url).pathname}/0"`);
  expect(settled).toBe(false);
  expect((await fetch(url, { method: 'POST' })).status).toBe(410);
  expect((await fetch(url)).status).toBe(410);
  const first = await fetch(`${url}/0`, { method: 'POST' });
  expect(first.headers.get('content-disposition')).toBe('attachment; filename="first___.bin"');
  expect(new Uint8Array(await first.arrayBuffer())).toEqual(Uint8Array.from([0, 255, 1]));
  expect((await fetch(`${url}/0`, { method: 'POST' })).status).toBe(410);
  expect(settled).toBe(false);
  const second = await fetch(`${url}/1`, { method: 'POST' });
  expect(new Uint8Array(await second.arrayBuffer())).toEqual(Uint8Array.from([2, 3]));
  await delivery;
  await expect(fetch(url)).rejects.toThrow();
});

it('cancels mixed delivery while files remain and closes the local server', async () => {
  let opened!: (url: string) => void;
  const ready = new Promise<string>(resolve => { opened = resolve; });
  const controller = new AbortController();
  const delivery = deliverSelectionInBrowser([{ selector: 'account.password', value: 'private' }], [
    { selector: 'files.first', fileName: 'first.bin', bytes: Uint8Array.from([255]) },
  ], { signal: controller.signal, open: opened });
  const rejected = expect(delivery).rejects.toThrow('local_delivery_canceled');
  const url = await ready;
  await (await fetch(url, { method: 'POST' })).text();
  controller.abort();
  await rejected;
  await expect(fetch(`${url}/0`, { method: 'POST' })).rejects.toThrow();
});

it('expires an approved file selection without treating confirmation as delivery', async () => {
  let opened!: (url: string) => void;
  const ready = new Promise<string>(resolve => { opened = resolve; });
  const delivery = deliverSelectionInBrowser([], [
    { selector: 'files.first', fileName: 'first.bin', bytes: Uint8Array.from([255]) },
  ], { timeoutMs: 50, open: opened });
  const rejected = expect(delivery).rejects.toThrow('local_delivery_expired');
  const url = await ready;
  await (await fetch(url, { method: 'POST' })).text();
  await rejected;
  await expect(fetch(`${url}/0`, { method: 'POST' })).rejects.toThrow();
});
