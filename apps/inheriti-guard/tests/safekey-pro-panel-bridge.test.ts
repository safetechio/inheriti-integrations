import { beforeEach, expect, it, vi } from 'vitest';
import { SafeKeyProPanelBridge } from '../src/background/safekey-pro-bridge.js';

function panelPort() {
  const messages: Array<(message: unknown) => void> = [];
  const disconnects: Array<() => void> = [];
  const port = {
    name: 'inheriti-safekey-pro',
    sender: { id: 'guard', url: 'chrome-extension://guard/safekey-popup/index.html' },
    onMessage: { addListener: (listener: (message: unknown) => void) => messages.push(listener) },
    onDisconnect: { addListener: (listener: () => void) => disconnects.push(listener) },
    postMessage: vi.fn(), disconnect: vi.fn(),
  };
  return { port: port as unknown as chrome.runtime.Port, messages, disconnects, sent: port.postMessage };
}

beforeEach(() => {
  vi.stubGlobal('chrome', {
    runtime: { id: 'guard', getURL: (path: string) => `chrome-extension://guard/${path}` },
    windows: { create: vi.fn().mockResolvedValue({ id: 12 }), remove: vi.fn().mockResolvedValue(undefined) },
  });
});

it('rejects a forged popup port before sending a custodian share', () => {
  const panel = panelPort();
  panel.port.sender!.url = 'chrome-extension://guard/other.html';
  const bridge = new SafeKeyProPanelBridge(vi.fn());
  bridge.attach(panel.port);
  expect(panel.port.disconnect).toHaveBeenCalledOnce();
  expect(panel.sent).not.toHaveBeenCalled();
});

it('cancels a pending device read if the panel disconnects', async () => {
  const panel = panelPort();
  const disconnected = vi.fn();
  const bridge = new SafeKeyProPanelBridge(disconnected);
  const reading = bridge.device('business.localhost').read({ shareId: 's', planId: 'p' });
  bridge.attach(panel.port);
  await vi.waitFor(() => expect(panel.sent).toHaveBeenCalled());
  expect(chrome.windows.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'popup', url: 'chrome-extension://guard/safekey-popup/index.html' }));
  expect(panel.sent).toHaveBeenCalledWith(expect.objectContaining({ operation: 'read', rpId: 'business.localhost' }));
  panel.disconnects[0]!();
  await expect(reading).rejects.toThrow('SAFEKEY_PANEL_CLOSED');
  expect(disconnected).toHaveBeenCalledOnce();
});

it('settles an aborted read even when Chrome rejects the cancel message', async () => {
  const panel = panelPort();
  const bridge = new SafeKeyProPanelBridge(vi.fn());
  const abort = new AbortController();
  const reading = bridge.device('business.localhost').read({ shareId: 's', planId: 'p' }, abort.signal);
  bridge.attach(panel.port);
  await vi.waitFor(() => expect(panel.sent).toHaveBeenCalled());
  panel.sent.mockImplementation(() => { throw new Error('Port disconnected'); });
  abort.abort();
  await expect(reading).rejects.toThrow('SAFEKEY_ABORTED');
  expect(() => bridge.finish()).not.toThrow();
});

it('cancels the reveal when the user closes the device choice between requests', async () => {
  const panel = panelPort();
  const canceled = vi.fn();
  const bridge = new SafeKeyProPanelBridge(canceled);
  const choosing = bridge.choose();
  bridge.attach(panel.port);
  await vi.waitFor(() => expect(panel.sent).toHaveBeenCalled());
  panel.messages[0]!({ operation: 'cancel-reveal' });
  expect(canceled).toHaveBeenCalledOnce();
  panel.disconnects[0]!();
  await expect(choosing).rejects.toThrow('SAFEKEY_PANEL_CLOSED');
});

it('closes the popup on finish and opens a fresh one for the next reveal', async () => {
  const first = panelPort();
  const bridge = new SafeKeyProPanelBridge(vi.fn());
  const choosing = bridge.choose();
  bridge.attach(first.port);
  await vi.waitFor(() => expect(first.sent).toHaveBeenCalled());
  const firstId = first.sent.mock.calls[0]![0].id;
  first.messages[0]!({ id: firstId, ok: true, value: 'SK_MOBILE' });
  await expect(choosing).resolves.toBe('SK_MOBILE');
  bridge.finish();
  expect(chrome.windows.remove).toHaveBeenCalledWith(12);
  const second = panelPort();
  const next = bridge.choose();
  bridge.attach(second.port);
  await vi.waitFor(() => expect(second.sent).toHaveBeenCalled());
  expect(chrome.windows.create).toHaveBeenCalledTimes(2);
  second.disconnects[0]!();
  await expect(next).rejects.toThrow('SAFEKEY_PANEL_CLOSED');
});
