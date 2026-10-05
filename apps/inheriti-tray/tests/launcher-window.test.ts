import { expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  app: { isReady: vi.fn(() => true), getName: vi.fn(() => 'Inheriti Go') },
  BrowserWindow: vi.fn(() => ({
    setMenu: vi.fn(),
    loadFile: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() },
  })),
}));

vi.mock('electron', () => mock);
vi.mock('../src/modules/launcher/main/window.js', () => ({ registerWindowEvents: vi.fn() }));

import { showLauncher } from '../src/modules/launcher/main/launcher-window.js';

it('creates the Linux launcher at the design content size', () => {
  showLauncher();

  expect(mock.BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({
    width: process.platform === 'linux' ? 448 : 404,
    height: process.platform === 'linux' ? 756 : 676,
    useContentSize: process.platform !== 'linux',
  }));
});
