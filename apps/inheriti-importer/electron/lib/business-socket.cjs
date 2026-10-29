const { io } = require('socket.io-client');

const API_ORIGIN = process.env.INHERITI_API_ORIGIN || '';
const SOCKET_EVENTS = new Set(['tenant_changed', 'master_key_delivered']);

let businessSocket = null;
let socketCapture = null;
let socketPending = null;
let socketEpoch = 0;
const socketSubscriptions = new Map();

function disconnectBusinessSocket() {
  ++socketEpoch;
  if (businessSocket) businessSocket.disconnect();
  businessSocket = null;
  socketCapture = null;
  socketSubscriptions.clear();
}

async function ensureBusinessSocket(runtime) {
  if (businessSocket && runtime.isCurrent(socketCapture)) return businessSocket;
  if (socketPending) return socketPending;
  const pending = createBusinessSocket(runtime);
  socketPending = pending;
  try { return await pending; }
  finally { if (socketPending === pending) socketPending = null; }
}

async function createBusinessSocket(runtime) {
  if (businessSocket) disconnectBusinessSocket();
  if (!API_ORIGIN) throw new Error('INHERITI_API_ORIGIN is not configured');
  const epoch = socketEpoch;
  const capture = runtime.capture();
  if (!capture.subject) throw new Error('AUTH_SIGNED_OUT');
  const token = await runtime.getAccessToken(capture);
  if (!token || !runtime.isCurrent(capture) || epoch !== socketEpoch)
    throw new Error('AUTH_CONTEXT_CHANGED');
  socketCapture = capture;
  const socket = io(API_ORIGIN, {
    autoConnect: false,
    reconnection: true,
    path: '/socket.io',
    transports: ['polling', 'websocket'],
    auth: async (callback) => {
      try {
        const refreshed = await runtime.getAccessToken(capture);
        if (!refreshed || !runtime.isCurrent(capture)) throw new Error('AUTH_CONTEXT_CHANGED');
        callback({ token: refreshed });
      } catch {
        callback({});
      }
    },
  });
  businessSocket = socket;
  socket.on('connect', () => {
    if (!runtime.isCurrent(capture)) { disconnectBusinessSocket(); return; }
    for (const { eventName, handler, subscribe, payload } of socketSubscriptions.values()) {
      socket.off(eventName, handler);
      socket.on(eventName, handler);
      socket.emit(subscribe, payload);
    }
  });
  socket.on('connect_error', (error) =>
    console.warn('[socket] connect_error:', error?.message || 'unknown error'),
  );
  socket.connect();
  return socket;
}

async function reconnectBusinessSocket(runtime) {
  if (socketCapture && !runtime.isCurrent(socketCapture)) disconnectBusinessSocket();
  if (businessSocket) businessSocket.disconnect();
  ++socketEpoch;
  socketPending = null;
  businessSocket = null;
  socketCapture = null;
  await ensureBusinessSocket(runtime);
}

function socketSubscriptionKey(event, payload) {
  return `${event}:${JSON.stringify(payload || {})}`;
}

async function subscribeBusinessSocket(runtime, sender, request) {
  const eventName = String(request?.event || '');
  const payload = request?.payload;
  if (!SOCKET_EVENTS.has(eventName) || !payload || typeof payload !== 'object') {
    throw new Error('Unsupported socket subscription');
  }
  const socket = await ensureBusinessSocket(runtime);
  if (!runtime.isCurrent(socketCapture)) throw new Error('AUTH_CONTEXT_CHANGED');
  const key = socketSubscriptionKey(eventName, payload);
  if (socketSubscriptions.has(key)) return;
  const capture = socketCapture;
  const handler = (data) => {
    if (runtime.isCurrent(capture)) sender.send('socket:event', { event: eventName, data });
  };
  const subscribe =
    eventName === 'tenant_changed' ? 'subscribe_to_tenant' : 'subscribe_to_master_key_session';
  socketSubscriptions.set(key, { eventName, payload, handler, subscribe });
  socket.on(eventName, handler);
  if (socket.connected) socket.emit(subscribe, payload);
}

function unsubscribeBusinessSocket(request) {
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

module.exports = {
  subscribeBusinessSocket,
  unsubscribeBusinessSocket,
  reconnectBusinessSocket,
  disconnectBusinessSocket,
};
