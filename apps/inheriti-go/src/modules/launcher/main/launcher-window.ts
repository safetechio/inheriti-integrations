import { app, BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { registerWindowEvents } from './window.js';

let window: BrowserWindow | undefined;
let quitting = false;
export type TrayAction = string | { kind: 'OPEN_INBOX'; organizationId: string; conversationId?: string };
declare const __INHERITI_DEPLOYMENT__: string | undefined;
const deployment = typeof __INHERITI_DEPLOYMENT__ === 'undefined' ? 'dev' : __INHERITI_DEPLOYMENT__;
const displayName = app.getName();

export function currentWindow(): BrowserWindow | undefined {
  return window;
}

export function prepareToQuit(): void {
  quitting = true;
}

export function showLauncher(action?: TrayAction): void {
  if (!app.isReady()) return;
  if (action && typeof action !== 'string' && (action.kind !== 'OPEN_INBOX' ||
    typeof action.organizationId !== 'string' || !action.organizationId || action.organizationId.length > 200 ||
    (action.conversationId !== undefined && (typeof action.conversationId !== 'string' || !action.conversationId || action.conversationId.length > 200)))) return;
  const creating = !window || window.isDestroyed();
  if (creating) {
    const linuxWindow = process.platform === 'linux';
    if (linuxWindow) app.setName(`inheriti-go-${deployment}`);
    window = new BrowserWindow({
      width: linuxWindow ? 448 : 404,
      height: linuxWindow ? 756 : 676,
      useContentSize: !linuxWindow,
      show: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      title: deployment === 'prod' ? displayName : `${displayName} · ${deployment.toUpperCase()}`,
      icon: join(import.meta.dirname, deployment === 'prod' ? 'tray.png' : `tray-${deployment}.png`),
      webPreferences: {
        preload: join(import.meta.dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.setMenu(null);
    registerWindowEvents(window, action, () => quitting);
    void window.loadFile(join(import.meta.dirname, 'launcher.html'));
  }
  const launcher = window;
  if (!launcher) return;
  if (creating) {
    const { x, y, width } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    launcher.setPosition(x + width - launcher.getBounds().width, y);
  }
  launcher.show();
  launcher.focus();
  if (action && !creating) launcher.webContents.send('tray:action', action);
}
