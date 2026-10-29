const { contextBridge, ipcRenderer } = require('electron');

/**
 * The only bridge the renderer gets. Every method maps 1:1 to an allowlisted
 * `ipcMain.handle` channel in main.cjs. Operator tokens stay in the main process.
 */
contextBridge.exposeInMainWorld('inheriti', {
  openFiles: () => ipcRenderer.invoke('vault:openFiles'),

  // Typed Business API transport. Main attaches the operator bearer token.
  api: {
    request: (request) => ipcRenderer.invoke('api:request', request),
  },

  development: {
    deliverMasterKey: (request) => ipcRenderer.invoke('development:deliverMasterKey', request),
  },

  socket: {
    subscribe: (request) => ipcRenderer.invoke('socket:subscribe', request),
    unsubscribe: (request) => ipcRenderer.invoke('socket:unsubscribe', request),
    // Reconnects the main-process socket with a fresh operator token.
    reconnect: () => ipcRenderer.invoke('socket:reconnect'),
    onEvent: (handler) => {
      const listener = (_event, value) => handler(value);
      ipcRenderer.on('socket:event', listener);
      return () => ipcRenderer.removeListener('socket:event', listener);
    },
  },

  auth: {
    // Runs the operator authorization code flow in main and returns a
    // non-secret session descriptor.
    login: () => ipcRenderer.invoke('auth:login'),
    add: () => ipcRenderer.invoke('auth:add'),
    accounts: () => ipcRenderer.invoke('auth:accounts'),
    destinations: () => ipcRenderer.invoke('auth:destinations'),
    activate: (key) => ipcRenderer.invoke('auth:activate', key),
    remove: (key) => ipcRenderer.invoke('auth:remove', key),
    logoutAll: () => ipcRenderer.invoke('auth:logoutAll'),
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
