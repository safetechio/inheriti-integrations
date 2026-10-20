const { app, BrowserWindow, dialog, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const { loadEnvironment } = require('./lib/environment.cjs');

// Populates `process.env` before any other module below captures an
// env-derived constant (API_ORIGIN, KEYCLOAK_*) at its own module-load time.
loadEnvironment({ isPackaged: app.isPackaged, electronDir: __dirname });

const { handle } = require('./lib/ipc-guard.cjs');
const { apiSession } = require('./lib/api-session.cjs');
const {
  apiFetch,
  ensureCsrf,
  resetCsrfToken,
  authCookieNames,
} = require('./lib/api-transport.cjs');
const {
  subscribeBusinessSocket,
  unsubscribeBusinessSocket,
  reconnectBusinessSocket,
  disconnectBusinessSocket,
} = require('./lib/business-socket.cjs');
const { loginWithKeycloak, cancelPendingAuth } = require('./lib/keycloak-auth.cjs');
const { createWindow } = require('./lib/window.cjs');
const { availableUpdate, installUpdate } = require('./lib/updates.cjs');

app.whenReady().then(() => {
  if (app.isPackaged) Menu.setApplicationMenu(null);
  createWindow(__dirname);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(__dirname);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Reject any renderer trying to create a webview / new window at the app level.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

handle('vault:openFiles', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Import password database',
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Supported vaults',
        extensions: ['kdbx', '1pux', 'json', 'csv', 'yaml', 'yml', 'env'],
      },
      { name: 'KeePass', extensions: ['kdbx'] },
      { name: '1Password', extensions: ['1pux'] },
      { name: 'Passbolt', extensions: ['json', 'csv'] },
      { name: 'Kubernetes', extensions: ['yaml', 'yml', 'json'] },
      { name: 'HashiCorp Vault', extensions: ['json', 'yaml', 'yml'] },
      { name: 'dotenv', extensions: ['env'] },
      { name: 'Cloud', extensions: ['json'] },
    ],
  });

  if (result.canceled) return [];

  // GTK's file chooser can report the same path twice when a file is
  // double-clicked to select and confirm in one action.
  const filePaths = [...new Set(result.filePaths)];

  return Promise.all(
    filePaths.map(async (filePath) => ({
      name: path.basename(filePath),
      path: filePath,
      data: Array.from(await fs.readFile(filePath)),
    })),
  );
});

// --- Business API transport (renderer never sees cookies/tokens) ---

handle('api:request', async (_event, request) => {
  const method = String(request?.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    throw new Error(`Unsupported method: ${method}`);
  }
  if (typeof request?.path !== 'string' || !request.path.startsWith('/')) {
    throw new Error('request.path must be an absolute API path');
  }

  if (!request.skipCsrf && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    await ensureCsrf();
  }

  const send = () =>
    apiFetch({
      method,
      path: request.path,
      query: request.query,
      body: request.body,
      skipCsrf: request.skipCsrf,
    });

  let response = await send();

  // A rejected CSRF token: refresh once and retry.
  if (response.status === 419 || response.status === 403) {
    resetCsrfToken();
    await ensureCsrf();
    response = await send();
  }

  return response;
});

handle('development:deliverMasterKey', async (_event, request) => {
  if (app.isPackaged) throw new Error('Local Organization Key simulation is unavailable');

  const organizationId = String(request?.organizationId || '');
  const sessionId = String(request?.sessionId || '');
  const relayToken = String(request?.relayToken || '');
  const encryptedMasterKey = String(request?.encryptedMasterKey || '');
  if (!organizationId || organizationId.includes('/')) throw new Error('Invalid organization');
  if (!sessionId || !relayToken || !encryptedMasterKey) {
    throw new Error('Incomplete Organization Key relay payload');
  }
  if (!/^[A-Za-z0-9._-]+$/.test(relayToken) || relayToken.length > 8192) {
    throw new Error('Invalid Organization Key relay token');
  }
  if (encryptedMasterKey.length > 16384) {
    throw new Error('Invalid encrypted Organization Key');
  }

  return apiFetch({
    method: 'POST',
    path: `/organizations/${encodeURIComponent(organizationId)}/master-key-relay`,
    body: { sessionId, encryptedMasterKey },
    skipCsrf: true,
    authorization: `Bearer ${relayToken}`,
  });
});

handle('socket:subscribe', (event, request) => subscribeBusinessSocket(event.sender, request));
handle('socket:unsubscribe', (_event, request) => unsubscribeBusinessSocket(request));
handle('socket:reconnect', () => reconnectBusinessSocket());

// --- Auth (Keycloak PKCE owned by main) ---

handle('auth:login', async () => {
  return loginWithKeycloak();
});

handle('auth:cancel', async () => {
  cancelPendingAuth();
});

handle('auth:logout', async () => {
  resetCsrfToken();
  disconnectBusinessSocket();
  await apiSession().clearStorageData({ storages: ['cookies'] });
});

handle('auth:session', async () => {
  try {
    const res = await apiFetch({ method: 'GET', path: '/user/session' });
    console.info('[auth] session check:', res.status, 'cookies:', await authCookieNames());
    return res.status === 200 ? (res.body?.result ?? null) : null;
  } catch {
    console.info('[auth] session check failed, cookies:', await authCookieNames());
    return null;
  }
});

handle('update:check', () => availableUpdate());
handle('update:install', (_event, id) => installUpdate(id));
