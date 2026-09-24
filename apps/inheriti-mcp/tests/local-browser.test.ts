import { expect, it } from 'vitest';
import { deliverAssetInBrowser, deliverInBrowser } from '../src/local-browser.js';

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
