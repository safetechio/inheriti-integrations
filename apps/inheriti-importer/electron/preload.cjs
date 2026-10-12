const { contextBridge, ipcRenderer } = require('electron');

/**
 * The only bridge the renderer gets. Every method maps 1:1 to an allowlisted
 * `ipcMain.handle` channel in main.cjs. Tokens, cookies, and the CSRF header
 * never cross this bridge — the main process holds them.
 */
contextBridge.exposeInMainWorld('inheriti', {
  openFiles: () => ipcRenderer.invoke('vault:openFiles'),

  // Typed Business API transport. `request` is a plain serialisable
  // { method, path, query?, body?, skipCsrf? }; the main process attaches the
  // session cookie jar + CSRF and returns { status, body }.
  api: {
    request: (request) => ipcRenderer.invoke('api:request', request),
  },

  development: {
    deliverMasterKey: (request) => ipcRenderer.invoke('development:deliverMasterKey', request),
  },

  socket: {
    subscribe: (request) => ipcRenderer.invoke('socket:subscribe', request),
    unsubscribe: (request) => ipcRenderer.invoke('socket:unsubscribe', request),
    // Tears down and rebuilds the main-process socket with a fresh cookie read.
    // Call before a flow that needs a guaranteed-authenticated room join.
    reconnect: () => ipcRenderer.invoke('socket:reconnect'),
    onEvent: (handler) => {
      const listener = (_event, value) => handler(value);
      ipcRenderer.on('socket:event', listener);
      return () => ipcRenderer.removeListener('socket:event', listener);
    },
  },

  auth: {
    // Runs the Keycloak PKCE flow in a controlled window owned by main,
    // exchanges the SafeID token, and resolves once the Business API session
    // cookie is held by main. Returns the non-secret session descriptor.
    login: () => ipcRenderer.invoke('auth:login'),
    cancel: () => ipcRenderer.invoke('auth:cancel'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    // The current session descriptor, or null.
    session: () => ipcRenderer.invoke('auth:session'),
  },
  updates: {
    check: () => ipcRenderer.invoke('update:check'),
    install: (id) => ipcRenderer.invoke('update:install', id),
  },
});
