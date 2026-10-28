const { handle } = require('../lib/ipc-guard.cjs');
const {
  subscribeBusinessSocket,
  unsubscribeBusinessSocket,
  reconnectBusinessSocket,
} = require('../lib/business-socket.cjs');

function register(sessionsReady) {
  handle('socket:subscribe', async (event, request) => {
    await sessionsReady;
    return subscribeBusinessSocket(event.sender, request);
  });
  handle('socket:unsubscribe', (_event, request) => unsubscribeBusinessSocket(request));
  handle('socket:reconnect', async () => {
    await sessionsReady;
    return reconnectBusinessSocket();
  });
}

module.exports = { register };
