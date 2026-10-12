import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';

// `electron/main.cjs` is loaded through Node's *real* CommonJS loader (not
// vite-node's module graph), so `vi.mock('electron', ...)` never intercepts
// its internal `require('electron')` / `require('socket.io-client')` calls.
// Fake those two modules directly in Node's own require cache instead.
const here = dirname(fileURLToPath(import.meta.url));
const mainCjsPath = resolvePath(here, '../../../electron/main.cjs');
const electronDir = resolvePath(here, '../../../electron');
const cjsRequire = createRequire(mainCjsPath);

// `main.cjs` is split across `electron/lib/*.cjs`, and those modules hold
// their own module-level state (the socket singleton, pending auth, the CSRF
// token, trusted sender ids). Clearing only `main.cjs`'s cache entry would
// leave that state to leak between tests, so every load/unload drops the
// whole `electron/` require subtree instead of just the entry file.
function ownModuleCachePaths(): string[] {
  return Object.keys(cjsRequire.cache).filter((id) => id.startsWith(electronDir + '/'));
}

function clearOwnModuleCache(): void {
  for (const id of ownModuleCachePaths()) delete cjsRequire.cache[id];
}

// Drives electron/main.cjs against a fake `electron` + `socket.io-client` so
// the acceptance-bar behaviours (CSP, navigation/popup denial, sender
// rejection, cookie persistence, CSRF retry, socket subscribe/unsubscribe,
// auth cancel, cleanup) run for real instead of being grepped for.

export interface FakeNetResponse {
  status: number;
  headers?: Record<string, string | string[]>;
  body?: string;
}

class FakeClientRequest extends EventEmitter {
  headers: Record<string, string> = {};
  written: string[] = [];
  ended = false;
  setHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  write(chunk: string) {
    this.written.push(chunk);
  }
  end() {
    this.ended = true;
  }
}

export function createMainHarness() {
  const netRequests: { url: string; method: string; request: FakeClientRequest }[] = [];
  const netQueue: FakeNetResponse[] = [];

  function queueNetResponse(response: FakeNetResponse) {
    netQueue.push(response);
  }

  const partitions = new Map<string, ReturnType<typeof createPartitionSession>>();

  function createPartitionSession() {
    const cookies = new Map<string, any>();
    return {
      cookies: {
        get: vi.fn(async () => Array.from(cookies.values())),
        set: vi.fn(async (cookie: any) => {
          cookies.set(cookie.name, cookie);
        }),
        flushStore: vi.fn(async () => {}),
      },
      clearStorageData: vi.fn(async () => {
        cookies.clear();
      }),
      _cookies: cookies,
      webRequest: { onHeadersReceived: vi.fn() },
      setPermissionRequestHandler: vi.fn(),
    };
  }

  const defaultSession = createPartitionSession();

  let webContentsIdSeq = 1;
  const windows: any[] = [];

  function createFakeWebContents() {
    const listeners = new Map<string, ((...a: any[]) => void)[]>();
    const wc: any = {
      id: webContentsIdSeq++,
      send: vi.fn(),
      on: vi.fn((event: string, handler: (...a: any[]) => void) => {
        const arr = listeners.get(event) || [];
        arr.push(handler);
        listeners.set(event, arr);
      }),
      once: vi.fn((event: string, handler: (...a: any[]) => void) => {
        const arr = listeners.get(event) || [];
        arr.push(handler);
        listeners.set(event, arr);
      }),
      setWindowOpenHandler: vi.fn(),
      emit(event: string, ...args: any[]) {
        for (const handler of listeners.get(event) || []) handler(...args);
      },
    };
    return wc;
  }

  function BrowserWindowMock(this: any) {
    this.webContents = createFakeWebContents();
    this.loadURL = vi.fn();
    this.loadFile = vi.fn();
    windows.push(this);
  }
  (BrowserWindowMock as any).getAllWindows = () => windows;

  const appHandlers = new Map<string, ((...a: any[]) => void)[]>();
  const app = {
    isPackaged: false,
    getVersion: () => '0.1.1',
    whenReady: () => Promise.resolve(),
    on: vi.fn((event: string, handler: (...a: any[]) => void) => {
      const arr = appHandlers.get(event) || [];
      arr.push(handler);
      appHandlers.set(event, arr);
    }),
    quit: vi.fn(),
  };

  const ipcHandlers = new Map<string, (event: any, ...args: any[]) => any>();
  const ipcMain = {
    handle: vi.fn((channel: string, listener: (...a: any[]) => any) => {
      ipcHandlers.set(channel, listener);
    }),
  };

  const dialog = { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) };
  const shell = {
    openExternal: vi.fn(async () => {}),
    openPath: vi.fn(async () => ''),
    showItemInFolder: vi.fn(),
  };

  const netRequestMock = vi.fn(({ method, url }: { method: string; url: string }) => {
    const req = new FakeClientRequest();
    netRequests.push({ url, method, request: req });
    queueMicrotask(() => {
      const next = netQueue.shift();
      if (!next) {
        req.emit('error', new Error(`No queued net response for ${method} ${url}`));
        return;
      }
      const response = new EventEmitter() as any;
      response.statusCode = next.status;
      response.headers = next.headers || {};
      req.emit('response', response);
      queueMicrotask(() => {
        if (next.body) response.emit('data', Buffer.from(next.body));
        response.emit('end');
      });
    });
    return req;
  });

  const electronMock = {
    app,
    BrowserWindow: BrowserWindowMock,
    ipcMain,
    dialog,
    session: {
      fromPartition: vi.fn((name: string) => {
        if (!partitions.has(name)) partitions.set(name, createPartitionSession());
        return partitions.get(name);
      }),
      defaultSession,
    },
    shell,
    net: { request: netRequestMock },
  };

  const socketInstances: any[] = [];
  function createFakeSocket() {
    const listeners = new Map<string, ((...a: any[]) => void)[]>();
    const socket: any = {
      on: vi.fn((event: string, handler: (...a: any[]) => void) => {
        const arr = listeners.get(event) || [];
        arr.push(handler);
        listeners.set(event, arr);
      }),
      off: vi.fn((event: string, handler: (...a: any[]) => void) => {
        const arr = (listeners.get(event) || []).filter((h) => h !== handler);
        listeners.set(event, arr);
      }),
      emit: vi.fn(),
      disconnect: vi.fn(),
    };
    socketInstances.push(socket);
    return socket;
  }
  const ioMock = vi.fn(() => createFakeSocket());

  return {
    electronMock,
    ioMock,
    netRequestMock,
    netRequests,
    queueNetResponse,
    windows,
    partitions,
    defaultSession,
    ipcHandlers,
    appHandlers,
    dialog,
    shell,
    socketInstances,
  };
}

function stubCjsModule(specifier: string, exports: unknown) {
  const resolved = cjsRequire.resolve(specifier);
  cjsRequire.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
    children: [],
    paths: [],
  } as any;
  return resolved;
}

export async function loadMain() {
  const harness = createMainHarness();
  stubCjsModule('electron', harness.electronMock);
  stubCjsModule('socket.io-client', { io: harness.ioMock });
  clearOwnModuleCache();

  cjsRequire(mainCjsPath);

  // Let `app.whenReady().then(createWindow)` (a microtask chain) settle.
  await Promise.resolve();
  await Promise.resolve();

  return harness;
}

// Restores real Node module resolution for `electron` / `socket.io-client`
// and drops the loaded `main.cjs` instance, so later, unrelated test files
// sharing this worker never see the stubs.
export function unloadMain() {
  clearOwnModuleCache();
  delete cjsRequire.cache[cjsRequire.resolve('electron')];
  delete cjsRequire.cache[cjsRequire.resolve('socket.io-client')];
}

export function fakeEvent(senderId: number, senderOverrides: Record<string, any> = {}) {
  return { sender: { id: senderId, send: vi.fn(), ...senderOverrides } };
}
