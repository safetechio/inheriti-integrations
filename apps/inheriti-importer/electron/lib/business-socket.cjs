const { io } = require('socket.io-client');
const { apiSession } = require('./api-session.cjs');

const API_ORIGIN = process.env.INHERITI_API_ORIGIN || '';
const SOCKET_EVENTS = new Set(['tenant_changed', 'master_key_delivered']);

let businessSocket = null;
const socketSubscriptions = new Map();

async function ensureBusinessSocket() {
  if (businessSocket) return businessSocket;
  if (!API_ORIGIN) throw new Error('INHERITI_API_ORIGIN is not configured');
  const cookies = await apiSession().cookies.get({ url: API_ORIGIN });
  const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  businessSocket = io(API_ORIGIN, {
    autoConnect: true,
    reconnection: true,
    withCredentials: true,
    path: '/socket.io',
    transports: ['polling', 'websocket'],
    extraHeaders: cookieHeader ? { Cookie: cookieHeader } : undefined,
  });
  businessSocket.on('connect', () => {
    console.info('[socket] connected:', API_ORIGIN);
    // Room membership lives on the connection the server just replaced, so every
    // (re)connect must replay the join commands or a subscriber goes deaf without
    // ever seeing an error — it just waits forever for an event that can no
    // longer reach it (e.g. an Organization Key relay from SafeKey Mobile).
    // `off` first so a same-instance transport-level reconnect (handlers survive)
    // doesn't end up with the handler bound twice.
    for (const { eventName, handler, subscribe, payload } of socketSubscriptions.values()) {
      businessSocket.off(eventName, handler);
      businessSocket.on(eventName, handler);
      businessSocket.emit(subscribe, payload);
    }
  });
  businessSocket.on('connect_error', (error) =>
    console.warn('[socket] connect_error:', error?.message || 'unknown error'),
  );
  return businessSocket;
}

// `extraHeaders` (the auth cookie) is captured once, when the socket is first
// constructed, and socket.io never re-reads it on its own reconnects — so a
// socket that connected before login (or whose cookie has since rotated) can
// sit there looking "connected" forever while being silently unauthenticated
// server-side. Call this right before a flow that depends on a fresh,
// authenticated room join (e.g. starting an Organization Key relay) instead of
// trusting an existing connection to still be good.
async function reconnectBusinessSocket() {
  if (businessSocket) businessSocket.disconnect();
  businessSocket = null;
  await ensureBusinessSocket();
}

function socketSubscriptionKey(event, payload) {
  return `${event}:${JSON.stringify(payload || {})}`;
}

async function subscribeBusinessSocket(sender, request) {
  const eventName = String(request?.event || '');
  const payload = request?.payload;
  if (!SOCKET_EVENTS.has(eventName) || !payload || typeof payload !== 'object') {
    throw new Error('Unsupported socket subscription');
  }
  const socket = await ensureBusinessSocket();
  const key = socketSubscriptionKey(eventName, payload);
  if (socketSubscriptions.has(key)) return;
  const handler = (data) => sender.send('socket:event', { event: eventName, data });
  const subscribe =
    eventName === 'tenant_changed' ? 'subscribe_to_tenant' : 'subscribe_to_master_key_session';
  socketSubscriptions.set(key, { eventName, payload, handler, subscribe });
  socket.on(eventName, handler);
  socket.emit(subscribe, payload);
}

async function unsubscribeBusinessSocket(request) {
  const eventName = String(request?.event || '');
  const payload = request?.payload;
  const key = socketSubscriptionKey(eventName, payload);
  const subscription = socketSubscriptions.get(key);
  if (!subscription || !businessSocket) return;
  businessSocket.off(subscription.eventName, subscription.handler);
  if (eventName === 'tenant_changed') businessSocket.emit('unsubscribe_to_tenant', payload);
  if (eventName === 'master_key_delivered')
    businessSocket.emit('unsubscribe_from_master_key_session', payload);
  socketSubscriptions.delete(key);
}

// Called on logout: the session cookie is gone, so the connection (and
// whatever rooms it had joined) is no longer meaningful.
function disconnectBusinessSocket() {
  if (!businessSocket) return;
  businessSocket.disconnect();
  businessSocket = null;
  socketSubscriptions.clear();
}

module.exports = {
  subscribeBusinessSocket,
  unsubscribeBusinessSocket,
  reconnectBusinessSocket,
  disconnectBusinessSocket,
};
