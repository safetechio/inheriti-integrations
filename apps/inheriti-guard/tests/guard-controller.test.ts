import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIPBOARD_EXPIRY_ALARM, GuardController, SESSION_ORIGINS, cookieUrl } from '../src/background/guard/controller.js';

function area(seed: Record<string, unknown> = {}) {
  const values = { ...seed };
  return {
    values,
    async get(keys: string | string[]) {
      const selected = typeof keys === 'string' ? [keys] : keys;
      return Object.fromEntries(selected.filter((key) => key in values).map((key) => [key, values[key]]));
    },
    async set(next: Record<string, unknown>) { Object.assign(values, next); },
    async remove(keys: string | string[]) { for (const key of typeof keys === 'string' ? [keys] : keys) delete values[key]; },
  };
}

describe('Guard runtime controller', () => {
  const updateDynamicRules = vi.fn(async () => undefined);
  const events: string[] = [];

  beforeEach(() => {
    events.length = 0;
    updateDynamicRules.mockClear();
    vi.stubGlobal('chrome', {
      runtime: { id: 'extension-id', getURL: (path: string) => `chrome-extension://extension-id/${path}` },
      declarativeNetRequest: { getDynamicRules: async () => [{ id: 9 }, { id: 20_001 }], updateDynamicRules },
      idle: { setDetectionInterval: vi.fn() },
      tabs: { query: async () => [], sendMessage: async () => undefined, remove: async () => undefined },
      browsingData: { remove: async () => undefined },
      cookies: { getAll: async () => [], remove: async () => undefined },
      notifications: { create: async () => undefined },
      alarms: { create: vi.fn(async () => undefined), clear: vi.fn(async () => true) },
    });
  });

  it('updates only Guard-owned DNR rules and preserves legacy settings', async () => {
    const local = area({ isEnabled: false, blockedSites: ['/legacy'], idleLockMinutes: 15 });
    const controller = new GuardController({ lock() {}, async secureLogoff() {}, unlock() {} }, local as never, area() as never);
    await controller.initialize();
    const response = await controller.respond({ type: 'guard:set-protection', enabled: true });

    expect(response).toMatchObject({ ok: true, guard: { isEnabled: true, idleLockMinutes: 15 } });
    expect(updateDynamicRules).toHaveBeenLastCalledWith(expect.objectContaining({ removeRuleIds: [20_001] }));
    expect(JSON.stringify(updateDynamicRules.mock.calls)).toContain('20000');
    expect(JSON.stringify(updateDynamicRules.mock.calls)).not.toContain('removeRuleIds":[9]');
  });

  it('locks mutations around the complete coordinated logoff', async () => {
    const controller = new GuardController({
      lock() { events.push('lock'); },
      async secureLogoff() { events.push('plan-access'); },
      unlock() { events.push('unlock'); },
    }, area() as never, area() as never);

    await controller.respond({ type: 'guard:secure-logoff' });
    expect(events).toEqual(['lock', 'plan-access', 'unlock']);
  });

  it('keeps clipboard and download protection independent of global navigation protection', async () => {
    const local = area({ isEnabled: false, clipboardGuardEnabled: true, downloadTrapEnabled: true });
    const session = area({ 'inheritiguard.sensitiveClipboard': { expiresAt: Date.now() + 60_000 } });
    const cancel = vi.fn(async () => undefined);
    (chrome.tabs.query as ReturnType<typeof vi.fn>) = vi.fn(async () => []);
    chrome.downloads = { cancel, erase: vi.fn(async () => undefined) } as never;
    const controller = new GuardController({ lock() {}, async secureLogoff() {}, unlock() {} }, local as never, session as never);

    const clipboard = await controller.respondContent({ type: 'guard-content:get-state' },
      { url: 'https://untrusted.example' } as chrome.runtime.MessageSender);
    await controller.download({ id: 7, url: 'https://app.inheriti.com/export.js' });
    expect(clipboard).toMatchObject({ guard: { protection: false, clipboard: true, allowPaste: false } });
    expect(cancel).toHaveBeenCalledWith(7);
    expect(await controller.allowsPlanAccess('https://untrusted.example')).toBe(true);
    await controller.respond({ type: 'guard:set-protection', enabled: true });
    expect(await controller.allowsPlanAccess('https://untrusted.example')).toBe(false);
    expect(await controller.allowsPlanAccess('https://app.inheriti.com')).toBe(true);
  });

  it('records a sanitized CSP observation only while global protection is enabled', async () => {
    const notify = vi.fn(async () => 'notification-id');
    chrome.notifications.create = notify as never;
    const local = area({ isEnabled: true });
    const controller = new GuardController({ lock() {}, async secureLogoff() {}, unlock() {} }, local as never, area() as never);

    await controller.respondContent({ type: 'guard-content:csp-violation' },
      { url: 'https://external.example/private/path?token=secret#fragment' } as chrome.runtime.MessageSender);
    expect(local.values['inheritiguard.activity']).toEqual([expect.objectContaining({
      kind: 'csp-violation', origin: 'https://external.example',
    })]);
    expect(local.values['inheritiguard.activity']).not.toEqual([expect.objectContaining({ pathname: expect.anything() })]);
    expect(JSON.stringify(local.values['inheritiguard.activity'])).not.toContain('secret');
    expect(JSON.stringify(local.values['inheritiguard.activity'])).not.toContain('fragment');
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      message: 'A page security policy violation was observed.',
    }));

    await controller.respond({ type: 'guard:set-protection', enabled: false });
    notify.mockClear();
    await controller.respondContent({ type: 'guard-content:csp-violation' },
      { url: 'https://external.example/ignored' } as chrome.runtime.MessageSender);
    expect(local.values['inheritiguard.activity']).toHaveLength(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it('redirects an ecosystem top-frame inline navigation without leaking its destination', async () => {
    const update = vi.fn(async () => undefined);
    chrome.tabs.get = vi.fn(async () => ({ id: 7, url: 'https://app.inheriti.com/plans' })) as never;
    chrome.tabs.update = update as never;
    const local = area({ downloadTrapEnabled: true });
    const controller = new GuardController({ lock() {}, async secureLogoff() {}, unlock() {} }, local as never, area() as never);

    await controller.inlineNavigation({ tabId: 7, frameId: 0,
      url: 'data:text/html,<script>secret()</script>?token=hidden#hash' });
    expect(update).toHaveBeenCalledWith(7, { url: 'chrome-extension://extension-id/blocked/index.html' });
    expect(JSON.stringify(update.mock.calls)).not.toContain('hidden');
    expect(local.values['inheritiguard.activity']).toEqual([expect.objectContaining({ kind: 'download-blocked' })]);
    expect(local.values['inheritiguard.activity']).not.toEqual([expect.objectContaining({ origin: expect.anything() })]);

    await controller.respond({ type: 'guard:set-download-trap', enabled: false });
    update.mockClear();
    await controller.inlineNavigation({ tabId: 7, frameId: 0, url: 'data:text/html,again' });
    expect(update).not.toHaveBeenCalled();
  });

  it('does not let a deferred inline lookup replace a newer top-frame navigation', async () => {
    let resolveTab!: (tab: chrome.tabs.Tab) => void;
    const deferredTab = new Promise<chrome.tabs.Tab>((resolve) => { resolveTab = resolve; });
    const get = vi.fn(() => deferredTab);
    const update = vi.fn(async () => undefined);
    chrome.tabs.get = get as never;
    chrome.tabs.update = update as never;
    const controller = new GuardController({ lock() {}, async secureLogoff() {}, unlock() {} },
      area({ downloadTrapEnabled: true }) as never, area() as never);

    const stale = controller.inlineNavigation({ tabId: 7, frameId: 0, url: 'data:text/html,stale' });
    await vi.waitFor(() => expect(get).toHaveBeenCalledWith(7));
    await controller.inlineNavigation({ tabId: 7, frameId: 0, url: 'https://external.example/newer' });
    resolveTab({ id: 7, index: 0, pinned: false, highlighted: false, windowId: 1, active: true,
      incognito: false, selected: true, discarded: false, autoDiscardable: true,
      groupId: -1, url: 'https://app.inheriti.com/plans' } as chrome.tabs.Tab);
    await stale;

    expect(update).not.toHaveBeenCalled();
  });

  it('clears every legacy origin and enumerates cookies across all legacy roots', async () => {
    const getAll = vi.fn(async ({ domain }: { domain: string }) => [{
      domain: `.${domain}`, path: '/', secure: true, name: 'session', storeId: '0',
    }]);
    const removeCookie = vi.fn(async () => undefined);
    const removeData = vi.fn(async () => undefined);
    chrome.cookies = { getAll, remove: removeCookie } as never;
    chrome.browsingData.remove = removeData;
    const local = area({ apiBlockingEnabled: true });
    const controller = new GuardController({ lock() {}, async secureLogoff() {}, unlock() {} }, local as never, area() as never);

    await controller.respond({ type: 'guard:secure-logoff' });
    expect(getAll.mock.calls.map(([query]) => query.domain)).toEqual(['inheriti.com', 'safetech.io', 'safekey.be']);
    expect(removeCookie).toHaveBeenCalledTimes(3);
    expect(removeData).toHaveBeenCalledWith({ origins: [...SESSION_ORIGINS] }, expect.objectContaining({ cookies: true, localStorage: true }));
    expect(local.values.apiBlockingEnabled).toBe(false);
    expect(cookieUrl({ domain: '.inheriti.com', path: '/auth', secure: true })).toBe('https://inheriti.com/auth');
  });

  it('reports partial cleanup failure after attempting every cookie root and browsing-data cleanup', async () => {
    const getAll = vi.fn(async ({ domain }: { domain: string }) => {
      if (domain === 'inheriti.com') throw new Error('cookie enumeration failed');
      return [{ domain: `.${domain}`, path: '/', secure: true, name: 'session' }];
    });
    const removeCookie = vi.fn(async ({ url }: { url: string }) => {
      if (url.includes('safetech.io')) throw new Error('cookie removal failed');
    });
    const removeData = vi.fn(async () => { throw new Error('site data removal failed'); });
    chrome.cookies = { getAll, remove: removeCookie } as never;
    chrome.browsingData.remove = removeData;
    const local = area({ apiBlockingEnabled: true });
    const controller = new GuardController({ lock() {}, async secureLogoff() {}, unlock() {} }, local as never, area() as never);

    await expect(controller.respond({ type: 'guard:secure-logoff' }))
      .resolves.toEqual({ ok: false, error: 'guard-operation-failed' });
    expect(getAll.mock.calls.map(([query]) => query.domain)).toEqual(['inheriti.com', 'safetech.io', 'safekey.be']);
    expect(removeCookie).toHaveBeenCalledTimes(2);
    expect(removeData).toHaveBeenCalledOnce();
    expect(local.values.apiBlockingEnabled).toBe(true);
  });

  it('refreshes an already-open external page on ecosystem copy and five-minute expiry', async () => {
    const sendMessage = vi.fn(async () => undefined);
    chrome.tabs.query = vi.fn(async () => [
      { id: 1, url: 'https://app.inheriti.com/plan' },
      { id: 2, url: 'https://external.example/login' },
    ]) as never;
    chrome.tabs.sendMessage = sendMessage;
    const local = area({ clipboardGuardEnabled: true });
    const session = area();
    const controller = new GuardController({ lock() {}, async secureLogoff() {}, unlock() {} }, local as never, session as never);

    await controller.respondContent({ type: 'guard-content:clipboard-copied' },
      { url: 'https://app.inheriti.com/plan', tab: { id: 1 } } as chrome.runtime.MessageSender);
    expect(chrome.alarms.create).toHaveBeenCalledWith(CLIPBOARD_EXPIRY_ALARM, expect.objectContaining({ when: expect.any(Number) }));
    expect(sendMessage).toHaveBeenCalledWith(2, expect.objectContaining({ type: 'inheritiguard:settings' }));
    await expect(controller.respondContent({ type: 'guard-content:get-state' },
      { url: 'https://external.example/login', tab: { id: 2 } } as chrome.runtime.MessageSender))
      .resolves.toMatchObject({ guard: { allowPaste: false, allowRead: false } });

    sendMessage.mockClear();
    await controller.handleAlarm(CLIPBOARD_EXPIRY_ALARM);
    expect(sendMessage).toHaveBeenCalledWith(2, expect.objectContaining({ type: 'inheritiguard:settings' }));
    await expect(controller.respondContent({ type: 'guard-content:get-state' },
      { url: 'https://external.example/login', tab: { id: 2 } } as chrome.runtime.MessageSender))
      .resolves.toMatchObject({ guard: { allowPaste: true } });
  });
});
