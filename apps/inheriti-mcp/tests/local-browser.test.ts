import { expect, it } from 'vitest';
import { deliverAssetInBrowser, deliverFieldsInBrowser, deliverInBrowser, deliverSelectionInBrowser } from '../src/local-browser.js';

const post = (url: string) => fetch(url, { method: 'POST', headers: { origin: new URL(url).origin } });

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
  expect((await fetch(url, { method: 'POST', headers: { origin: 'http://example.test' } })).status).toBe(403);
  const revealed = await post(url);
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
  const download = await post(url);
  expect(download.headers.get('content-type')).toBe('application/octet-stream');
  expect(download.headers.get('content-disposition')).toBe('attachment; filename="report___.html"');
  expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);
  await delivery;
  await expect(fetch(url)).rejects.toThrow();
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
  const html = await (await post(url)).text();
  expect(html).toContain('Protected fields revealed');
  expect(html).toContain('&lt;private&gt;&amp;');
  expect(html).toContain('second-secret');
  expect(html).not.toContain('account.<password>');
  await delivery;
  await expect(post(url)).rejects.toThrow();
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
  expect((await post(`${url}/0`)).status).toBe(403);
  expect((await fetch(`${url}/0`)).status).toBe(405);
  expect((await post(`${url}/2`)).status).toBe(404);
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
  const result = await (await post(url)).text();
  expect(result).toContain('&lt;private&gt;');
  expect(result).toContain(`action="${new URL(url).pathname}/0"`);
  expect(settled).toBe(false);
  expect((await post(url)).status).toBe(410);
  expect((await fetch(url)).status).toBe(410);
  const first = await post(`${url}/0`);
  expect(first.headers.get('content-disposition')).toBe('attachment; filename="first___.bin"');
  expect(new Uint8Array(await first.arrayBuffer())).toEqual(Uint8Array.from([0, 255, 1]));
  expect((await post(`${url}/0`)).status).toBe(410);
  expect(settled).toBe(false);
  const second = await post(`${url}/1`);
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
  await (await post(url)).text();
  controller.abort();
  await rejected;
  await expect(post(`${url}/0`)).rejects.toThrow();
});

it('expires an approved file selection without treating confirmation as delivery', async () => {
  let opened!: (url: string) => void;
  const ready = new Promise<string>(resolve => { opened = resolve; });
  const delivery = deliverSelectionInBrowser([], [
    { selector: 'files.first', fileName: 'first.bin', bytes: Uint8Array.from([255]) },
  ], { timeoutMs: 50, open: opened });
  const rejected = expect(delivery).rejects.toThrow('local_delivery_expired');
  const url = await ready;
  await (await post(url)).text();
  await rejected;
  await expect(post(`${url}/0`)).rejects.toThrow();
});
