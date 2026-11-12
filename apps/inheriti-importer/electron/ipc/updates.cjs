const { handle } = require('../lib/ipc-guard.cjs');
const { availableUpdate, installUpdate, reopenUpdate } = require('../lib/updates.cjs');

function register(runtimeReady, runtime) {
  handle('update:check', async () => {
    await runtimeReady;
    return availableUpdate(runtime);
  });
  handle('update:install', async (_event, id) => {
    await runtimeReady;
    return installUpdate(id, runtime);
  });
  handle('update:reopen', async () => {
    await runtimeReady;
    return reopenUpdate();
  });
}

module.exports = { register };
