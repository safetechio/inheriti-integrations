import { expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  app: { isReady: vi.fn(() => true), getName: vi.fn(() => 'Inheriti Go'), setName: vi.fn() },
  screen: { getCursorScreenPoint: vi.fn(() => ({ x: 2200, y: 100 })),
    getDisplayNearestPoint: vi.fn(() => ({ workArea: { x: 1920, y: 40, width: 1000, height: 800 } })) },
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
  expect(mock.BrowserWindow).toHaveBeenCalledWith(expect.not.objectContaining({ type: expect.anything() }));
  const window = mock.BrowserWindow.mock.results[0]!.value;

  expect(window.setPosition).toHaveBeenLastCalledWith(2460, 40);
  expect(mock.screen.getDisplayNearestPoint).toHaveBeenCalledWith({ x: 2200, y: 100 });
  expect(window.setPosition.mock.invocationCallOrder[0]).toBeLessThan(window.show.mock.invocationCallOrder[0]);

  window.setPosition.mockClear();
  showLauncher();
  expect(window.setPosition).not.toHaveBeenCalled();
  expect(mock.BrowserWindow).toHaveBeenCalledTimes(1);
});

it('uses a normal window on native Wayland and X11', async () => {
  if (process.platform !== 'linux') return;
  const original = process.argv;
  const display = process.env.DISPLAY;
  try {
    process.argv = original.filter((arg) => arg !== '--ozone-platform=x11');
    delete process.env.DISPLAY;
    vi.resetModules();
    (await import('../src/modules/launcher/main/launcher-window.js')).showLauncher();
    expect(mock.BrowserWindow).toHaveBeenLastCalledWith(expect.not.objectContaining({ type: expect.anything() }));

    process.env.DISPLAY = ':0';
    vi.resetModules();
    (await import('../src/modules/launcher/main/launcher-window.js')).showLauncher();
    expect(mock.BrowserWindow).toHaveBeenLastCalledWith(expect.not.objectContaining({ type: expect.anything() }));
  } finally {
    process.argv = original;
    if (display === undefined) delete process.env.DISPLAY;
    else process.env.DISPLAY = display;
  }
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
