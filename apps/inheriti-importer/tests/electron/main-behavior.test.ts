import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeEvent, loadMain, unloadMain } from './support/main-harness';

const ORIGIN = 'https://api.inheriti.test';

beforeEach(() => {
  process.env.INHERITI_API_ORIGIN = ORIGIN;
  process.env.KEYCLOAK_URL = 'https://keycloak.inheriti.test';
  process.env.KEYCLOAK_REALM = 'inheriti';
  process.env.KEYCLOAK_CLIENT_ID = 'importer';
});

afterEach(() => {
  delete process.env.INHERITI_API_ORIGIN;
  delete process.env.KEYCLOAK_URL;
  delete process.env.KEYCLOAK_REALM;
  delete process.env.KEYCLOAK_CLIENT_ID;
  unloadMain();
});

describe('main.cjs security policies', () => {
  it('sets a restrictive CSP header on every response', async () => {
    const harness = await loadMain();
    const handler = harness.defaultSession.webRequest.onHeadersReceived.mock.calls[0][0];
    const callback = vi.fn();
    handler({ responseHeaders: { 'X-Existing': ['1'] } }, callback);
    const applied = callback.mock.calls[0][0];
    const csp = applied.responseHeaders['Content-Security-Policy'][0];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'");
    expect(applied.responseHeaders['X-Existing']).toEqual(['1']);
  });

  it('denies navigation away from the app origin and opens it externally instead', async () => {
    const harness = await loadMain();
    const win = harness.windows[0];
    const willNavigate = win.webContents.on.mock.calls.find(
      (c: any[]) => c[0] === 'will-navigate',
    )[1];

    const deniedEvent = { preventDefault: vi.fn() };
    willNavigate(deniedEvent, 'https://evil.example.com/');
    expect(deniedEvent.preventDefault).toHaveBeenCalled();
    expect(harness.shell.openExternal).toHaveBeenCalledWith('https://evil.example.com/');

    const allowedEvent = { preventDefault: vi.fn() };
    willNavigate(allowedEvent, 'http://127.0.0.1:5173/some-route');
    expect(allowedEvent.preventDefault).not.toHaveBeenCalled();
  });

  it('denies opening in-app popups and routes them to the OS browser', async () => {
    const harness = await loadMain();
    const win = harness.windows[0];
    const openHandler = win.webContents.setWindowOpenHandler.mock.calls[0][0];
    const result = openHandler({ url: 'https://external.example.com/' });
    expect(result).toEqual({ action: 'deny' });
    expect(harness.shell.openExternal).toHaveBeenCalledWith('https://external.example.com/');
  });

  it('rejects IPC calls from a sender the app did not create', async () => {
    const harness = await loadMain();
    const untrusted = fakeEvent(999999);
    const handler = harness.ipcHandlers.get('api:request')!;
    expect(() => handler(untrusted, { method: 'GET', path: '/user/session' })).toThrow(
      'Untrusted IPC sender',
    );
  });

  it('accepts IPC calls from the window this process created', async () => {
    const harness = await loadMain();
    harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: { id: '1' } }) });
    const trusted = fakeEvent(harness.windows[0].webContents.id);
    const handler = harness.ipcHandlers.get('api:request')!;
    const response = await handler(trusted, { method: 'GET', path: '/user/session' });
    expect(response.status).toBe(200);
  });
});

describe('main.cjs Business API transport', () => {
  it('delivers only an encrypted Organization Key through the development relay bridge', async () => {
    const harness = await loadMain();
    const partition = harness.electronMock.session.fromPartition('persist:inheriti-api');
    await partition.cookies.set({ name: 'token', value: 'business-session' });
    harness.queueNetResponse({ status: 201, body: JSON.stringify({ result: null }) });
    const trusted = fakeEvent(harness.windows[0].webContents.id);
    const handler = harness.ipcHandlers.get('development:deliverMasterKey')!;

    const response = await handler(trusted, {
      organizationId: 'org-1',
      sessionId: 'session-1',
      relayToken: 'header.payload.signature',
      encryptedMasterKey: 'encrypted-value',
    });

    expect(response.status).toBe(201);
    const request = harness.netRequests.at(-1)!;
    expect(request.url).toBe(`${ORIGIN}/organizations/org-1/master-key-relay`);
    expect(request.request.headers.Authorization).toBe('Bearer header.payload.signature');
    expect(request.request.headers.Cookie).toBeUndefined();
    expect(request.request.headers['x-csrf-token']).toBeUndefined();
    expect(request.request.written).toEqual([
      JSON.stringify({ sessionId: 'session-1', encryptedMasterKey: 'encrypted-value' }),
    ]);
  });

  it('rejects malformed local relay tokens before making a request', async () => {
    const harness = await loadMain();
    const trusted = fakeEvent(harness.windows[0].webContents.id);
    const handler = harness.ipcHandlers.get('development:deliverMasterKey')!;

    await expect(
      handler(trusted, {
        organizationId: 'org-1',
        sessionId: 'session-1',
        relayToken: 'invalid token',
        encryptedMasterKey: 'encrypted-value',
      }),
    ).rejects.toThrow('Invalid Organization Key relay token');
    expect(harness.netRequests).toHaveLength(0);
  });

  it('persists Set-Cookie headers from a response into the isolated session', async () => {
    const harness = await loadMain();
    harness.queueNetResponse({
      status: 200,
      headers: {
        'set-cookie': ['token=abc123; Path=/; HttpOnly', 'refreshToken=xyz; Max-Age=3600'],
      },
      body: JSON.stringify({ result: {} }),
    });
    const trusted = fakeEvent(harness.windows[0].webContents.id);
    const handler = harness.ipcHandlers.get('api:request')!;
    await handler(trusted, { method: 'GET', path: '/user/session' });

    const partition = harness.partitions.get('persist:inheriti-api')!;
    const setCalls = partition.cookies.set.mock.calls.map((c: any[]) => c[0]);
    const token = setCalls.find((c: any) => c.name === 'token');
    const refresh = setCalls.find((c: any) => c.name === 'refreshToken');
    expect(token).toMatchObject({ name: 'token', value: 'abc123', path: '/', httpOnly: true });
    expect(refresh).toMatchObject({ name: 'refreshToken', value: 'xyz' });
    expect(refresh.expirationDate).toBeGreaterThan(Date.now() / 1000);
  });

  it('fetches the CSRF token once for concurrent requests (single-flight)', async () => {
    const harness = await loadMain();
    harness.queueNetResponse({
      status: 200,
      body: JSON.stringify({ result: { token: 'csrf-1' } }),
    });
    harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: {} }) });
    harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: {} }) });

    const trusted = fakeEvent(harness.windows[0].webContents.id);
    const handler = harness.ipcHandlers.get('api:request')!;
    await Promise.all([
      handler(trusted, { method: 'POST', path: '/plans', body: {} }),
      handler(trusted, { method: 'POST', path: '/plans', body: {} }),
    ]);

    const csrfCalls = harness.netRequests.filter((r) => r.url.includes('/csrf'));
    expect(csrfCalls).toHaveLength(1);
  });

  it('refreshes the CSRF token and retries exactly once on a 419/403', async () => {
    const harness = await loadMain();
    harness.queueNetResponse({
      status: 200,
      body: JSON.stringify({ result: { token: 'csrf-1' } }),
    }); // initial CSRF
    harness.queueNetResponse({ status: 419, body: JSON.stringify({ message: 'stale csrf' }) }); // rejected write
    harness.queueNetResponse({
      status: 200,
      body: JSON.stringify({ result: { token: 'csrf-2' } }),
    }); // refreshed CSRF
    harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: { id: '1' } }) }); // retried write

    const trusted = fakeEvent(harness.windows[0].webContents.id);
    const handler = harness.ipcHandlers.get('api:request')!;
    const response = await handler(trusted, { method: 'POST', path: '/plans', body: {} });

    expect(response.status).toBe(200);
    const writeRequests = harness.netRequests.filter((r) => r.url.endsWith('/plans'));
    expect(writeRequests).toHaveLength(2);
    expect(writeRequests[0].request.headers['x-csrf-token']).toBe('csrf-1');
    expect(writeRequests[1].request.headers['x-csrf-token']).toBe('csrf-2');
  });
});

describe('main.cjs socket bridge', () => {
  it('subscribes once per event/payload and forwards data to the sender', async () => {
    const harness = await loadMain();
    harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: [] }) }); // cookie lookup for socket connect uses session cookies.get, no net call needed

    const senderId = harness.windows[0].webContents.id;
    const event = fakeEvent(senderId);
    const subscribe = harness.ipcHandlers.get('socket:subscribe')!;
    const request = { event: 'tenant_changed', payload: { tenantId: 't1' } };

    await subscribe(event, request);
    await subscribe(event, request); // duplicate subscription must be a no-op

    const socket = harness.socketInstances[0];
    // `socket.on` also registers the internal `connect`/`connect_error`
    // handlers from `ensureBusinessSocket()`; only one of these must be the
    // actual subscription forwarder, registered exactly once (dedup).
    const tenantCalls = socket.on.mock.calls.filter((c: any[]) => c[0] === 'tenant_changed');
    expect(tenantCalls).toHaveLength(1);
    expect(socket.emit).toHaveBeenCalledWith('subscribe_to_tenant', { tenantId: 't1' });

    const [, forward] = tenantCalls[0];
    forward({ some: 'payload' });
    expect(event.sender.send).toHaveBeenCalledWith('socket:event', {
      event: 'tenant_changed',
      data: { some: 'payload' },
    });
  });

  it('unsubscribes cleanly and tolerates unsubscribing twice', async () => {
    const harness = await loadMain();
    const senderId = harness.windows[0].webContents.id;
    const event = fakeEvent(senderId);
    const subscribe = harness.ipcHandlers.get('socket:subscribe')!;
    const unsubscribe = harness.ipcHandlers.get('socket:unsubscribe')!;
    const request = { event: 'master_key_delivered', payload: { sessionId: 's1' } };

    await subscribe(event, request);
    const socket = harness.socketInstances[0];

    await unsubscribe(event, request);
    expect(socket.off).toHaveBeenCalledTimes(1);
    expect(socket.emit).toHaveBeenCalledWith('unsubscribe_from_master_key_session', {
      sessionId: 's1',
    });

    await expect(unsubscribe(event, request)).resolves.toBeUndefined();
    expect(socket.off).toHaveBeenCalledTimes(1);
  });

  it('leaves the tenant room with the API command after a release', async () => {
    const harness = await loadMain();
    const event = fakeEvent(harness.windows[0].webContents.id);
    const request = { event: 'tenant_changed', payload: { tenantId: 'org-1' } };
    await harness.ipcHandlers.get('socket:subscribe')!(event, request);
    await harness.ipcHandlers.get('socket:unsubscribe')!(event, request);

    expect(harness.socketInstances[0].emit).toHaveBeenCalledWith('unsubscribe_to_tenant', {
      tenantId: 'org-1',
    });
  });

  it('rejects an unsupported subscription event', async () => {
    const harness = await loadMain();
    const event = fakeEvent(harness.windows[0].webContents.id);
    const subscribe = harness.ipcHandlers.get('socket:subscribe')!;
    await expect(subscribe(event, { event: 'not_allowed', payload: {} })).rejects.toThrow(
      'Unsupported socket subscription',
    );
  });

  it('socket:reconnect tears down the stale connection and rejoins active rooms on a fresh one', async () => {
    const harness = await loadMain();
    const event = fakeEvent(harness.windows[0].webContents.id);
    const subscribe = harness.ipcHandlers.get('socket:subscribe')!;
    const reconnect = harness.ipcHandlers.get('socket:reconnect')!;

    // A socket that connected before login (or whose cookie has since rotated)
    // looks "connected" forever — socket.io never re-reads extraHeaders on its
    // own reconnects. Starting a relay must force a brand-new authenticated
    // connection rather than trust the old one.
    await subscribe(event, { event: 'master_key_delivered', payload: { sessionId: 's1' } });
    const staleSocket = harness.socketInstances[0];

    await reconnect(event);

    expect(staleSocket.disconnect).toHaveBeenCalled();
    expect(harness.socketInstances).toHaveLength(2);

    const freshSocket = harness.socketInstances[1];
    const [, freshConnectHandler] = freshSocket.on.mock.calls.find(
      (c: any[]) => c[0] === 'connect',
    )!;
    freshConnectHandler();

    expect(freshSocket.on).toHaveBeenCalledWith('master_key_delivered', expect.any(Function));
    expect(freshSocket.emit).toHaveBeenCalledWith('subscribe_to_master_key_session', {
      sessionId: 's1',
    });
  });

  it('replays room-join commands for every active subscription on reconnect', async () => {
    const harness = await loadMain();
    const event = fakeEvent(harness.windows[0].webContents.id);
    const subscribe = harness.ipcHandlers.get('socket:subscribe')!;

    // A master-key relay subscriber that survives a dropped connection must not
    // go silently deaf: the server only knows about the room join for the
    // connection that sent it, so a reconnect (sleep/wake, network blip, proxy
    // idle-timeout) needs the join replayed or an in-flight Organization Key
    // relay from SafeKey Mobile never reaches this client.
    await subscribe(event, { event: 'tenant_changed', payload: { tenantId: 't1' } });
    await subscribe(event, { event: 'master_key_delivered', payload: { sessionId: 's1' } });

    const socket = harness.socketInstances[0];
    socket.emit.mockClear();

    const [, reconnectHandler] = socket.on.mock.calls.find((c: any[]) => c[0] === 'connect')!;
    reconnectHandler();

    expect(socket.emit).toHaveBeenCalledWith('subscribe_to_tenant', { tenantId: 't1' });
    expect(socket.emit).toHaveBeenCalledWith('subscribe_to_master_key_session', {
      sessionId: 's1',
    });
  });
});

describe('main.cjs auth lifecycle', () => {
  it('renders the branded callback card on sign-in failure', async () => {
    const harness = await loadMain();
    const event = fakeEvent(harness.windows[0].webContents.id);
    const pending = harness.ipcHandlers.get('auth:login')!(event);
    const rejected = expect(pending).rejects.toThrow('access_denied');
    await vi.waitFor(() => expect(harness.shell.openExternal).toHaveBeenCalledOnce());
    const authorization = new URL(harness.shell.openExternal.mock.calls[0][0]);
    const callback = new URL(authorization.searchParams.get('redirect_uri')!);
    callback.searchParams.set('state', authorization.searchParams.get('state')!);
    callback.searchParams.set('error', 'access_denied');

    const response = await fetch(callback);
    const html = await response.text();
    expect(response.status).toBe(400);
    expect(response.headers.get('content-security-policy')).toContain('img-src data:; font-src data:');
    expect(html).toContain('Inheriti® Importer');
    expect(html).toContain('Sign-in failed');
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('data:font/ttf;base64,');
    expect(html).not.toContain('{{');
    await rejected;
  });

  it('rejects the pending login with AUTH_CANCELLED when cancelled', async () => {
    const harness = await loadMain();
    const event = fakeEvent(harness.windows[0].webContents.id);
    const login = harness.ipcHandlers.get('auth:login')!;
    const cancel = harness.ipcHandlers.get('auth:cancel')!;

    const pending = login(event);
    // Let the callback HTTP server finish binding before cancelling.
    await new Promise((r) => setTimeout(r, 10));
    await cancel(event);

    await expect(pending).rejects.toThrow('AUTH_CANCELLED');
  });

  it('is idempotent when logging out twice with no active session', async () => {
    const harness = await loadMain();
    const event = fakeEvent(harness.windows[0].webContents.id);
    const logout = harness.ipcHandlers.get('auth:logout')!;
    await expect(logout(event)).resolves.toBeUndefined();
    await expect(logout(event)).resolves.toBeUndefined();
  });

  it('disconnects the socket and clears subscriptions on logout', async () => {
    const harness = await loadMain();
    const event = fakeEvent(harness.windows[0].webContents.id);
    const subscribe = harness.ipcHandlers.get('socket:subscribe')!;
    await subscribe(event, { event: 'tenant_changed', payload: { tenantId: 't1' } });
    const socket = harness.socketInstances[0];

    const logout = harness.ipcHandlers.get('auth:logout')!;
    await logout(event);
    expect(socket.disconnect).toHaveBeenCalled();

    // A fresh subscribe after logout must open a new socket, not reuse the old one.
    await subscribe(event, { event: 'tenant_changed', payload: { tenantId: 't1' } });
    expect(harness.socketInstances).toHaveLength(2);
  });
});
