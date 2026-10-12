const { ipcMain } = require('electron');

// Only `webContents` created by this app's own `createWindow()` may invoke an
// allowlisted channel — rejects any sender from a devtools-injected frame,
// a webview, or any window this process did not create itself.
const trustedWebContentsIds = new Set();

function assertTrustedSender(event) {
  if (!trustedWebContentsIds.has(event.sender.id)) {
    throw new Error('Untrusted IPC sender');
  }
}

function handle(channel, listener) {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedSender(event);
    return listener(event, ...args);
  });
}

module.exports = { trustedWebContentsIds, handle };
