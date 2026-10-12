const { app, BrowserWindow, session, shell } = require('electron');
const path = require('node:path');
const { trustedWebContentsIds } = require('./ipc-guard.cjs');

const DEV_URL = 'http://127.0.0.1:5173';
const DEV_ORIGIN = new URL(DEV_URL).origin;
const API_ORIGIN = process.env.INHERITI_API_ORIGIN || '';

function contentSecurityPolicy() {
  const connect = ["'self'", DEV_ORIGIN, API_ORIGIN].filter(Boolean).join(' ');
  const socketConnect = API_ORIGIN
    ? (() => {
        const origin = new URL(API_ORIGIN).origin;
        return `${origin.replace(/^http/, 'ws')} ${origin.replace(/^http/, 'wss')}`;
      })()
    : '';
  const scripts = app.isPackaged
    ? "'self' 'wasm-unsafe-eval'"
    : "'self' 'unsafe-inline' 'wasm-unsafe-eval'";
  return [
    "default-src 'self'",
    `script-src ${scripts}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connect} ${socketConnect}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function applySecurityPolicies(win) {
  // Strict CSP on every response — authoritative, no <meta> CSP in the renderer.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [contentSecurityPolicy()],
      },
    });
  });

  const allowedOrigin = app.isPackaged ? null : DEV_ORIGIN;

  // Default-deny navigation: only the app's own origin (dev server / packaged file://).
  win.webContents.on('will-navigate', (event, url) => {
    const isFile = url.startsWith('file://');
    if (isFile) return;
    if (allowedOrigin && new URL(url).origin === allowedOrigin) return;
    event.preventDefault();
    void shell.openExternal(url);
  });

  // No in-app popups; external links go to the OS browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Never grant a renderer permission request (camera, geolocation, etc.).
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, done) => done(false));
}

// `electronDir` is `main.cjs`'s own `__dirname`, passed in explicitly rather
// than derived from this file's location, so `dist/`, `.env.*`, and asset
// paths stay correct regardless of where this module lives.
function createWindow(electronDir) {
  const win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#F8FBFF',
    title: 'Inheriti® Importer',
    icon: path.join(
      electronDir,
      app.isPackaged ? '../dist/favicon.png' : '../src/assets/brand/inheriti-favicon.png',
    ),
    webPreferences: {
      preload: path.join(electronDir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
      // Without this, Chromium throttles/skips repainting the renderer once
      // it's occluded or loses OS focus (e.g. DevTools opened as its own
      // window) — committed React state updates land in the DOM but the
      // frame isn't painted until an unrelated input event wakes it up.
      backgroundThrottling: false,
    },
  });

  applySecurityPolicies(win);
  trustedWebContentsIds.add(win.webContents.id);
  win.webContents.once('destroyed', () => trustedWebContentsIds.delete(win.webContents.id));

  if (app.isPackaged) {
    win.loadFile(path.join(electronDir, '../dist/index.html'));
  } else {
    win.loadURL(DEV_URL);
  }
}

module.exports = { DEV_URL, DEV_ORIGIN, createWindow };
