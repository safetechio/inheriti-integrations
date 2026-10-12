const { session } = require('electron');

// Dedicated session partition so the Business API cookie jar is isolated from
// the app window's own browsing session and never reachable from the renderer.
const apiSession = () => session.fromPartition('persist:inheriti-api');

module.exports = { apiSession };
