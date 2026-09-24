import { beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  appEvents: new Map<string, (...args: unknown[]) => void>(),
  powerEvents: new Map<string, () => void>(),
  registerIpc: vi.fn(),
  watchLinuxLock: vi.fn(),
  stopLinuxLock: vi.fn(),
  setAppUserModelId: vi.fn(),
  clearOnLock: vi.fn(),
  clearRevealed: vi.fn(),
  hide: vi.fn(),
  reload: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { requestSingleInstanceLock: () => true, on: (name: string, listener: (...args: unknown[]) => void) => mock.appEvents.set(name, listener), whenReady: () => Promise.resolve(), setAppUserModelId: mock.setAppUserModelId },
  globalShortcut: { register: () => true, unregisterAll: vi.fn() },
  powerMonitor: { on: (name: string, listener: () => void) => mock.powerEvents.set(name, listener) },
  Notification: { isSupported: () => false },
}));
vi.mock('../src/modules/launcher/main/launcher-window.js', () => ({
  currentWindow: () => ({ isDestroyed: () => false, hide: mock.hide, webContents: { reload: mock.reload } }),
  prepareToQuit: vi.fn(), showLauncher: vi.fn(),
}));
vi.mock('../src/modules/launcher/main/tray.js', () => ({ registerTrayEvents: vi.fn() }));
vi.mock('../src/modules/launcher/main/ipc.js', () => ({ registerTrayIpc: mock.registerIpc }));
vi.mock('../src/modules/launcher/main/linux-lock.js', () => ({ watchLinuxLock: mock.watchLinuxLock }));

import { registerAppEvents } from '../src/modules/launcher/main/app.js';

beforeEach(() => {
  vi.clearAllMocks();
  mock.appEvents.clear();
  mock.powerEvents.clear();
});

it('hides and reloads the launcher on lock and suspend while clearing session data', async () => {
  const session = { clearOnLock: mock.clearOnLock, clearRevealed: mock.clearRevealed, restore: vi.fn() };
  mock.watchLinuxLock.mockReturnValue(mock.stopLinuxLock);
  registerAppEvents(session as never, undefined, 'dev');
  await vi.waitFor(() => expect(mock.powerEvents.size).toBe(2));
  expect(mock.setAppUserModelId).toHaveBeenCalledWith('com.safetech.inheriti.tray.dev');
  mock.powerEvents.get('lock-screen')?.();
  mock.powerEvents.get('suspend')?.();
  expect(mock.clearOnLock).toHaveBeenCalledTimes(2);
  expect(mock.hide).toHaveBeenCalledTimes(2);
  expect(mock.reload).toHaveBeenCalledTimes(2);
  mock.appEvents.get('before-quit')?.();
  expect(mock.clearRevealed).toHaveBeenCalled();
});
