import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OverlayPermissionController, patternOf, secureOrigin } from '../src/background/overlay-permissions.js';

const request = vi.fn();
const contains = vi.fn();
const getAll = vi.fn();
const remove = vi.fn();
const getRegistered = vi.fn();
const register = vi.fn();
const unregister = vi.fn();
const query = vi.fn();
const sendMessage = vi.fn();
const executeScript = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  request.mockResolvedValue(true); contains.mockResolvedValue(true);
  getAll.mockResolvedValue({ origins: [] }); remove.mockResolvedValue(true);
  getRegistered.mockResolvedValue([]); register.mockResolvedValue(undefined); unregister.mockResolvedValue(undefined);
  query.mockResolvedValue([]); sendMessage.mockResolvedValue(undefined); executeScript.mockResolvedValue([]);
  vi.stubGlobal('chrome', {
    permissions: { request, contains, getAll, remove },
    scripting: { getRegisteredContentScripts: getRegistered, registerContentScripts: register,
      unregisterContentScripts: unregister, executeScript },
    tabs: { query, sendMessage },
  });
});

describe('optional overlay origin lifecycle', () => {
  it('accepts only exact secure origins', () => {
    expect(secureOrigin('https://vault.example.test/login')).toBe('https://vault.example.test');
    expect(patternOf('https://vault.example.test')).toBe('https://vault.example.test/*');
    for (const unsupported of ['http://example.test', 'file:///tmp/a', 'chrome://settings', 'not a url']) {
      expect(secureOrigin(unsupported)).toBeUndefined();
    }
  });

  it('reconciles only a previously granted exact origin and injects it', async () => {
    query.mockResolvedValue([{ id: 7 }]);
    getAll.mockResolvedValue({ origins: ['https://vault.example.test/*'] });
    const state = await new OverlayPermissionController().enable('https://vault.example.test/login');

    expect(request).not.toHaveBeenCalled();
    expect(contains).toHaveBeenCalledWith({ origins: ['https://vault.example.test/*'] });
    expect(register).toHaveBeenCalledWith([expect.objectContaining({
      matches: ['https://vault.example.test/*'], js: ['content/overlay.js'], allFrames: true,
    })]);
    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 7, allFrames: true }, files: ['content/overlay.js'] });
    expect(state.currentEnabled).toBe(true);
  });

  it('keeps the side-panel-only state when permission is denied', async () => {
    contains.mockResolvedValue(false);
    const state = await new OverlayPermissionController().enable('https://vault.example.test/login');
    expect(register).not.toHaveBeenCalled();
    expect(state.currentEnabled).toBe(false);
  });

  it('destroys live UI and registration before removing permission', async () => {
    const order: string[] = [];
    query.mockResolvedValue([{ id: 7 }]);
    sendMessage.mockImplementation(async () => { order.push('destroy'); });
    remove.mockImplementation(async () => { order.push('remove'); return true; });
    getRegistered.mockResolvedValue([{ id: 'inheriti-elements-overlay-deadbeef' }]);
    unregister.mockImplementation(async () => { order.push('unregister'); });

    await new OverlayPermissionController().disable('https://vault.example.test');
    expect(order).toEqual(['destroy', 'unregister', 'remove']);
  });

  it('removes registered sites even when Chrome cannot remove the host permission', async () => {
    const origin = 'https://vault.example.test';
    const scripts = [{ id: 'inheriti-elements-overlay-deadbeef', matches: [patternOf(origin)] }];
    getRegistered.mockImplementation(async () => scripts);
    unregister.mockImplementation(async () => { scripts.length = 0; });
    remove.mockRejectedValue(new Error('required host permission'));

    const controller = new OverlayPermissionController();
    expect((await controller.disable(origin)).enabledOrigins).toEqual([]);
    expect(unregister).toHaveBeenCalledOnce();

    scripts.push({ id: 'inheriti-elements-overlay-deadbeef', matches: [patternOf(origin)] });
    expect((await controller.disableAll()).enabledOrigins).toEqual([]);
    expect(unregister).toHaveBeenCalledTimes(2);
  });

  it('restores registrations only from Chrome-authorized exact origins', async () => {
    getAll.mockResolvedValue({ origins: ['https://one.example.test/*', 'https://*/*', 'http://no.example.test/*'] });
    getRegistered.mockResolvedValueOnce([{ id: 'inheriti-elements-overlay-stale' }]).mockResolvedValue([]);

    await new OverlayPermissionController().restore();

    expect(unregister).toHaveBeenCalledWith({ ids: ['inheriti-elements-overlay-stale'] });
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith([expect.objectContaining({ matches: ['https://one.example.test/*'] })]);
  });
});
