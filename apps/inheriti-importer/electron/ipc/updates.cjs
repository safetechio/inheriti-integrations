const { handle } = require('../lib/ipc-guard.cjs');
const { availableUpdate, installUpdate } = require('../lib/updates.cjs');

function register(sessionsReady) {
  handle('update:check', () => availableUpdate());
  handle('update:install', (_event, id) => installUpdate(id));
}

module.exports = { register };
