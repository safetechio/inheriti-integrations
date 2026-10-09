import { expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  app: { isReady: vi.fn(() => true), getName: vi.fn(() => 'Inheriti Go') },
  screen: { getPrimaryDisplay: vi.fn(() => ({ workArea: { x: 1920, y: 40, width: 1000, height: 800 } })) },
  BrowserWindow: vi.fn(() => ({
    setMenu: vi.fn(),
    loadFile: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    getBounds: vi.fn(() => ({ x: 100, y: 100, width: 460, height: 756 })),
    setPosition: vi.fn(),
    webContents: { send: vi.fn() },
  })),
}));

vi.mock('electron', () => mock);
vi.mock('../src/modules/launcher/main/window.js', () => ({ registerWindowEvents: vi.fn() }));

import { currentWindow, showLauncher } from '../src/modules/launcher/main/launcher-window.js';

it('creates the Linux launcher at the design content size', () => {
  showLauncher();

  expect(mock.BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({
    width: process.platform === 'linux' ? 448 : 404,
    height: process.platform === 'linux' ? 756 : 676,
    useContentSize: process.platform !== 'linux',
    title: 'Inheriti Go · DEV',
  }));
  const window = mock.BrowserWindow.mock.results[0]!.value;

  expect(window.setPosition).toHaveBeenLastCalledWith(2460, 40);
  expect(window.setPosition.mock.invocationCallOrder[0]).toBeLessThan(window.show.mock.invocationCallOrder[0]);

  window.setPosition.mockClear();
  showLauncher();
  expect(window.setPosition).not.toHaveBeenCalled();
  expect(mock.BrowserWindow).toHaveBeenCalledTimes(1);
});

it('passes only bounded Secure Chat identifiers to the launcher', () => {
  const launcher = currentWindow()!;
  const action = { kind: 'OPEN_INBOX' as const, organizationId: 'org-1', conversationId: 'chat-1' };
  showLauncher(action);
  expect(launcher.webContents.send).toHaveBeenCalledWith('tray:action', action);
  vi.mocked(launcher.webContents.send).mockClear();
  showLauncher({ ...action, conversationId: 'x'.repeat(201) });
  expect(launcher.webContents.send).not.toHaveBeenCalled();
});
