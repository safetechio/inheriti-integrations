const { handle } = require('../lib/ipc-guard.cjs');
const {
  subscribeBusinessSocket,
  unsubscribeBusinessSocket,
  reconnectBusinessSocket,
} = require('../lib/business-socket.cjs');

function register(runtimeReady, runtime) {
  handle('socket:subscribe', async (event, request) => {
    await runtimeReady;
    return subscribeBusinessSocket(runtime, event.sender, request);
  });
  handle('socket:unsubscribe', (_event, request) => unsubscribeBusinessSocket(request));
  handle('socket:reconnect', async () => {
    await runtimeReady;
    return reconnectBusinessSocket(runtime);
  });
}

module.exports = { register };
