import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const originalLoad = Module._load;
const originalOrigin = process.env.INHERITI_API_ORIGIN;

function withModules<T>(mocks: Record<string, unknown>, load: () => T): T {
  Module._load = function (id: string, parent: unknown, isMain: boolean) {
    return id in mocks ? mocks[id] : originalLoad.call(this, id, parent, isMain);
  };
  try { return load(); }
  finally { Module._load = originalLoad; }
}

afterEach(() => {
  vi.useRealTimers();
  process.env.INHERITI_API_ORIGIN = originalOrigin;
  for (const file of Object.keys(require.cache)) {
    if (file.endsWith('/electron/lib/api-transport.cjs') || file.endsWith('/electron/lib/business-socket.cjs'))
      delete require.cache[file];
  }
});

it('settles stalled and interrupted HTTP requests once and clears their timers', async () => {
  process.env.INHERITI_API_ORIGIN = 'https://api.example';
  vi.useFakeTimers();
  let request: any;
  const net = { request: vi.fn(() => {
    request = Object.assign(new EventEmitter(), { setHeader: vi.fn(), write: vi.fn(), end: vi.fn(),
      abort: vi.fn(() => request.emit('abort')) });
    return request;
  }) };
  const { bearerApiFetch } = withModules({ electron: { net } }, () => require('../../electron/lib/api-transport.cjs'));
  const fetch = () => bearerApiFetch({ method: 'GET', path: '/integrations/v1/organizations', token: 'token', environment: 'TEST' });

  const stalled = fetch();
  const timedOut = expect(stalled).rejects.toThrow('Business API request timed out');
  await vi.advanceTimersByTimeAsync(30_000);
  await timedOut;
  expect(request.abort).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);

  const failed = fetch();
  request.emit('error', new Error('network failed'));
  await expect(failed).rejects.toThrow('network failed');
  expect(vi.getTimerCount()).toBe(0);

  for (const event of ['error', 'aborted', 'close']) {
    const interrupted = fetch();
    const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: {} });
    request.emit('response', response);
    if (event === 'error') response.emit(event, new Error('response failed'));
    else response.emit(event);
    await expect(interrupted).rejects.toThrow();
    response.emit('end');
    expect(vi.getTimerCount()).toBe(0);
  }

  const completed = fetch();
  const response = Object.assign(new EventEmitter(), { statusCode: 201, headers: { ok: 'yes' } });
  request.emit('response', response);
  response.emit('data', Buffer.from('{"ok":true}'));
  response.emit('end');
  response.emit('close');
  await expect(completed).resolves.toEqual({ status: 201, body: { ok: true }, headers: { ok: 'yes' } });
  expect(vi.getTimerCount()).toBe(0);
});

it('clears the timer and aborts when writing the body fails synchronously', async () => {
  process.env.INHERITI_API_ORIGIN = 'https://api.example';
  vi.useFakeTimers();
  const request = Object.assign(new EventEmitter(), { setHeader: vi.fn(),
    write: vi.fn(() => { throw new Error('write failed'); }), end: vi.fn(), abort: vi.fn() });
  const net = { request: vi.fn(() => request) };
  const { bearerApiFetch } = withModules({ electron: { net } }, () => require('../../electron/lib/api-transport.cjs'));
  await expect(bearerApiFetch({ method: 'POST', path: '/integrations/v1/organizations',
    body: { value: 1 }, token: 'token', environment: 'TEST' })).rejects.toThrow('write failed');
  expect(request.abort).toHaveBeenCalledOnce();
  expect(request.end).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('sends only the operator bearer token and selected organization to integration routes', async () => {
  process.env.INHERITI_API_ORIGIN = 'https://api.example';
  let request: any;
  const net = { request: vi.fn(() => {
    request = Object.assign(new EventEmitter(), { headers: {} as Record<string, string>,
      setHeader(name: string, value: string) { this.headers[name] = value; },
      write: vi.fn(), end() {
        const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: {} });
        this.emit('response', response);
        response.emit('data', Buffer.from('{"result":true}'));
        response.emit('end');
      }, });
    return request;
  }) };
  const { bearerApiFetch } = withModules({ electron: { net } }, () => require('../../electron/lib/api-transport.cjs'));
  const response = await bearerApiFetch({ method: 'POST', path: '/integrations/v1/organizations/org-1',
    body: { value: 1 }, token: 'operator-token', environment: 'TEST', organizationId: 'org-1' });
  expect(response.status).toBe(200);
  expect(request.headers).toEqual({ Accept: 'application/json', Authorization: 'Bearer operator-token',
    'x-elements-environment': 'TEST', 'x-organization-id': 'org-1', 'Content-Type': 'application/json' });
  await expect(bearerApiFetch({ method: 'GET', path: '/integrations/v1/../user/profile',
    token: 'operator-token', environment: 'TEST' })).rejects.toThrow('Unsupported Business API path');
  expect(net.request).toHaveBeenCalledTimes(1);
  await bearerApiFetch({ method: 'POST', path: '/integrations/v1/organizations/org-1/master-key-relay',
    body: { sessionId: 'session-1' }, token: 'relay-token', relay: true });
  expect(request.headers).toEqual({ Accept: 'application/json', Authorization: 'Bearer relay-token',
    'Content-Type': 'application/json' });
});

it('refreshes the socket auth token on reconnect and suppresses stale account events', async () => {
  process.env.INHERITI_API_ORIGIN = 'https://api.example';
  let socket: any;
  let options: any;
  const io = vi.fn((_url, selected) => {
    options = selected;
    socket = Object.assign(new EventEmitter(), { connect: vi.fn(), disconnect: vi.fn() });
    return socket;
  });
  const bridge = withModules({ 'socket.io-client': { io } }, () => require('../../electron/lib/business-socket.cjs'));
  let generation = 1;
  let token = 'first';
  const runtime = { capture: () => ({ subject: 'alice', generation }),
    isCurrent: (capture: any) => capture.generation === generation,
    getAccessToken: async () => token };
  const sender = { send: vi.fn() };
  await bridge.subscribeBusinessSocket(runtime, sender, { event: 'tenant_changed', payload: { tenantId: 'org-1' } });
  const emit = vi.spyOn(socket, 'emit');
  const first = await new Promise((resolve) => options.auth(resolve));
  expect(first).toEqual({ token: 'first' });
  token = 'second';
  const refreshed = await new Promise((resolve) => options.auth(resolve));
  expect(refreshed).toEqual({ token: 'second' });
  socket.emit('connect');
  expect(emit).toHaveBeenCalledWith('subscribe_to_tenant', { tenantId: 'org-1' });
  socket.emit('tenant_changed', { id: 'org-1' });
  expect(sender.send).toHaveBeenCalledOnce();
  generation = 2;
  socket.emit('tenant_changed', { id: 'org-1' });
  expect(sender.send).toHaveBeenCalledOnce();
  const stale = await new Promise((resolve) => options.auth(resolve));
  expect(stale).toEqual({});
});

it('opens one socket for concurrent subscriptions and rejects a superseded setup', async () => {
  process.env.INHERITI_API_ORIGIN = 'https://api.example';
  const io = vi.fn(() => Object.assign(new EventEmitter(), { connect: vi.fn(), disconnect: vi.fn() }));
  const bridge = withModules({ 'socket.io-client': { io } }, () => require('../../electron/lib/business-socket.cjs'));
  let release!: (value: string) => void;
  let generation = 1;
  const runtime = { capture: () => ({ subject: 'alice', generation }),
    isCurrent: (capture: any) => capture.generation === generation,
    getAccessToken: () => new Promise<string>((resolve) => { release = resolve; }) };
  const sender = { send: vi.fn() };
  const first = bridge.subscribeBusinessSocket(runtime, sender, { event: 'tenant_changed', payload: { tenantId: 'org-1' } });
  const second = bridge.subscribeBusinessSocket(runtime, sender, { event: 'master_key_delivered', payload: { sessionId: 's-1' } });
  expect(release).toBeTypeOf('function');
  release('operator-token');
  await Promise.all([first, second]);
  expect(io).toHaveBeenCalledOnce();
  bridge.disconnectBusinessSocket();

  const stale = bridge.subscribeBusinessSocket(runtime, sender, { event: 'tenant_changed', payload: { tenantId: 'org-1' } });
  generation = 2;
  release('old-token');
  await expect(stale).rejects.toThrow('AUTH_CONTEXT_CHANGED');
  expect(io).toHaveBeenCalledOnce();
});
