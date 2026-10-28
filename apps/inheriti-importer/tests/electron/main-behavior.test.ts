import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { fakeEvent, loadMain, unloadMain } from './support/main-harness';

const ORIGIN = 'https://api.inheriti.test';

beforeEach(() => {
  process.env.INHERITI_API_ORIGIN = ORIGIN;
  process.env.SAFEID_URL = 'https://safeid.inheriti.test';
  process.env.SAFEID_REALM = 'inheriti';
  process.env.SAFEID_CLIENT_ID = 'importer';
});

afterEach(() => {
  delete process.env.INHERITI_API_ORIGIN;
  delete process.env.SAFEID_URL;
  delete process.env.SAFEID_REALM;
  delete process.env.SAFEID_CLIENT_ID;
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
  it('omits empty and expired cookies from the manually attached request header', async () => {
    const harness = await loadMain();
    const partition = harness.partitions.get(harness.activePartition)!;
    await partition.cookies.set({ name: 'token', value: 'business-session' });
    await partition.cookies.set({ name: 'browserSession', value: '' });
    await partition.cookies.set({
      name: 'expiredSession',
      value: 'stale',
      expirationDate: Math.floor(Date.now() / 1000) - 1,
    });
    harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: true }) });
    const event = fakeEvent(harness.windows[0].webContents.id);

    await harness.ipcHandlers.get('api:request')!(event, {
      method: 'GET',
      path: '/integrations/tester-access',
    });

    expect(harness.netRequests[0].request.headers.Cookie).toBe('token=business-session');
  });

  it('delivers only an encrypted Organization Key through the development relay bridge', async () => {
    const harness = await loadMain();
    const partition = harness.electronMock.session.fromPartition(harness.activePartition);
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

  it('sends a bearer-only relay before login with an isolated cookie jar', async () => {
    const harness = await loadMain({ signedIn: false });
    harness.queueNetResponse({ status: 201, body: JSON.stringify({ result: null }) });
    const event = fakeEvent(harness.windows[0].webContents.id);
    await harness.ipcHandlers.get('development:deliverMasterKey')!(event, {
      organizationId: 'org-1',
      sessionId: 'session-1',
      relayToken: 'header.payload.signature',
      encryptedMasterKey: 'encrypted-value',
    });
    expect(harness.netRequests[0].request.headers.Authorization).toBe(
      'Bearer header.payload.signature',
    );
    expect(harness.netRequests[0].request.headers.Cookie).toBeUndefined();
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

    const partition = harness.partitions.get(harness.activePartition)!;
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

describe('main.cjs account destinations', () => {
  it('queries each saved account in its own session and returns only destination fields', async () => {
    const harness = await loadMain({ savedSubjects: ['account-a', 'account-b'] });
    const event = fakeEvent(harness.windows[0].webContents.id);
    const [a, b] = harness.savedProfiles;
    await harness.partitions.get(a.partition)!.cookies.set({ name: 'token', value: 'token-a' });
    await harness.partitions.get(b.partition)!.cookies.set({ name: 'token', value: 'token-b' });
    harness.queueNetResponse({
      status: 200,
      body: JSON.stringify({ result: { items: [{ id: 'org-a', name: 'A', secret: 'hidden' }] } }),
    });
    harness.queueNetResponse({
      status: 200,
      body: JSON.stringify({ result: { items: [{ id: 'org-b', name: 'B', token: 'hidden' }] } }),
    });

    expect(await harness.ipcHandlers.get('auth:destinations')!(event)).toEqual([
      {
        accountKey: a.key,
        subject: 'account-a',
        status: 'ready',
        organizations: [{ id: 'org-a', name: 'A' }],
      },
      {
        accountKey: b.key,
        subject: 'account-b',
        status: 'ready',
        organizations: [{ id: 'org-b', name: 'B' }],
      },
    ]);
    expect(harness.netRequests.map((request) => request.url)).toEqual([
      `${ORIGIN}/organizations`,
      `${ORIGIN}/organizations`,
    ]);
    expect(harness.netRequests.map((request) => request.request.headers.Cookie)).toEqual([
      'token=token-a',
      'token=token-b',
    ]);
    expect((await harness.ipcHandlers.get('auth:accounts')!(event))[0].active).toBe(true);
  });

  it('omits organizations for an expired account', async () => {
    const harness = await loadMain({ savedSubjects: ['account-a', 'account-b'] });
    const event = fakeEvent(harness.windows[0].webContents.id);
    harness.queueNetResponse({ status: 401, body: JSON.stringify({ error: 'expired' }) });
    harness.queueNetResponse({
      status: 200,
      body: JSON.stringify({ result: { items: [{ id: 'org-b', name: 'B' }] } }),
    });

    expect(await harness.ipcHandlers.get('auth:destinations')!(event)).toEqual([
      {
        accountKey: harness.savedProfiles[0].key,
        subject: 'account-a',
        status: 'sign_in_required',
        organizations: [],
      },
      {
        accountKey: harness.savedProfiles[1].key,
        subject: 'account-b',
        status: 'ready',
        organizations: [{ id: 'org-b', name: 'B' }],
      },
    ]);
  });

  it('discards a result when its saved context is removed before the response', async () => {
    const harness = await loadMain();
    const event = fakeEvent(harness.windows[0].webContents.id);
    harness.queueNetResponse({
      hold: true,
      status: 200,
      body: JSON.stringify({ result: { items: [{ id: 'old-org', name: 'Old' }] } }),
    });
    const pending = harness.ipcHandlers.get('auth:destinations')!(event);
    await vi.waitFor(() => expect(harness.heldResponses).toHaveLength(1));
    harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: { token: 'csrf' } }) });
    harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: {} }) });
    await harness.ipcHandlers.get('auth:remove')!(event, harness.savedProfiles[0].key);
    harness.releaseHeldResponse();
    expect(await pending).toEqual([]);
  });

  it('discards a result when its saved context is replaced before the response', async () => {
    const harness = await loadMain();
    const event = fakeEvent(harness.windows[0].webContents.id);
    harness.queueNetResponse({
      hold: true,
      status: 200,
      body: JSON.stringify({ result: { items: [{ id: 'old-org', name: 'Old' }] } }),
    });
    const pending = harness.ipcHandlers.get('auth:destinations')!(event);
    await vi.waitFor(() => expect(harness.heldResponses).toHaveLength(1));
    const sessions = createRequire(import.meta.url)('../../electron/lib/api-session.cjs');
    await sessions.retainContext(sessions.stagedContext('test-user'), false);
    harness.releaseHeldResponse();
    expect(await pending).toEqual([]);
  });

  it('rechecks an early account result after a later account finishes', async () => {
    const harness = await loadMain({ savedSubjects: ['account-a', 'account-b'] });
    const event = fakeEvent(harness.windows[0].webContents.id);
    harness.queueNetResponse({
      status: 200,
      body: JSON.stringify({ result: { items: [{ id: 'org-a', name: 'A' }] } }),
    });
    harness.queueNetResponse({
      hold: true,
      status: 200,
      body: JSON.stringify({ result: { items: [{ id: 'org-b', name: 'B' }] } }),
    });
    const pending = harness.ipcHandlers.get('auth:destinations')!(event);
    await vi.waitFor(() => expect(harness.heldResponses).toHaveLength(1));
    harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: { token: 'csrf' } }) });
    harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: {} }) });
    await harness.ipcHandlers.get('auth:remove')!(event, harness.savedProfiles[0].key);
    harness.releaseHeldResponse();
    expect(await pending).toEqual([
      {
        accountKey: harness.savedProfiles[1].key,
        subject: 'account-b',
        status: 'ready',
        organizations: [{ id: 'org-b', name: 'B' }],
      },
    ]);
  });
});

describe('main.cjs auth lifecycle', () => {
  const fsSync = createRequire(import.meta.url)('node:fs');

  async function finishLogin(
    harness: Awaited<ReturnType<typeof loadMain>>,
    channel = 'auth:login',
  ) {
    const event = fakeEvent(harness.windows[0].webContents.id);
    const pending = harness.ipcHandlers.get(channel)!(event);
    // The callback can reject before fetch resolves; attach a handler immediately.
    void pending.catch(() => {});
    await vi.waitFor(() => expect(harness.shell.openExternal).toHaveBeenCalledOnce());
    const authorization = new URL(harness.shell.openExternal.mock.calls[0][0]);
    const callback = new URL(authorization.searchParams.get('redirect_uri')!);
    callback.searchParams.set('state', authorization.searchParams.get('state')!);
    callback.searchParams.set('code', 'authorization-code');
    const response = await fetch(callback);
    return { pending, response };
  }

  function queueLogin(
    harness: Awaited<ReturnType<typeof loadMain>>,
    subject: string,
    cookieHeaders: string[] = [
      `token=${subject}; Path=/`,
      `refreshToken=${subject}-refresh; Path=/`,
    ],
  ) {
    const claims = Buffer.from(JSON.stringify({ sub: subject })).toString('base64url');
    harness.queueNetResponse({
      status: 200,
      body: JSON.stringify({ access_token: 'access-token', id_token: `x.${claims}.x` }),
    });
    harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: { token: 'csrf' } }) });
    harness.queueNetResponse({
      status: 200,
      headers: { 'set-cookie': cookieHeaders },
      body: JSON.stringify({ result: { session: { id: subject } } }),
    });
    harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: true }) });
  }

  it('asks the provider for a fresh login', async () => {
    const harness = await loadMain();
    const event = fakeEvent(harness.windows[0].webContents.id);
    const pending = harness.ipcHandlers.get('auth:add')!(event);
    void pending.catch(() => {});
    await vi.waitFor(() => expect(harness.shell.openExternal).toHaveBeenCalledOnce());
    expect(new URL(harness.shell.openExternal.mock.calls[0][0]).searchParams.get('prompt')).toBe(
      'login',
    );
    await harness.ipcHandlers.get('auth:cancel')!(event);
    await expect(pending).rejects.toThrow('AUTH_CANCELLED');
  });

  it('reserves OAuth before listen and lets sign-out cancel a delayed flow', async () => {
    const http = createRequire(import.meta.url)('node:http');
    const createServer = http.createServer;
    let releaseListen: (() => void) | undefined;
    const spy = vi.spyOn(http, 'createServer').mockImplementation((...args: any[]) => {
      const server = createServer(...args);
      const listen = server.listen.bind(server);
      server.listen = ((...listenArgs: any[]) => {
        releaseListen = () => {
          listen(...listenArgs);
        };
        return server;
      }) as typeof server.listen;
      return server;
    });
    try {
      const harness = await loadMain();
      const event = fakeEvent(harness.windows[0].webContents.id);
      const login = harness.ipcHandlers.get('auth:login')!;
      const first = login(event);
      void first.catch(() => {});
      await vi.waitFor(() => expect(releaseListen).toBeTypeOf('function'));
      await expect(login(event)).rejects.toThrow('AUTH_IN_PROGRESS');
      harness.queueNetResponse({
        status: 200,
        body: JSON.stringify({ result: { token: 'csrf' } }),
      });
      harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: {} }) });
      await expect(harness.ipcHandlers.get('auth:logoutAll')!(event)).resolves.toEqual({
        remoteRevocationFailed: false,
      });
      await expect(first).rejects.toThrow('AUTH_CANCELLED');
      releaseListen!();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(harness.shell.openExternal).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('does not let an old accepted callback consume a newer OAuth flow', async () => {
    const http = createRequire(import.meta.url)('node:http');
    const createServer = http.createServer;
    let created = 0;
    let releaseOld: (() => void) | undefined;
    const spy = vi.spyOn(http, 'createServer').mockImplementation((handler: any) => {
      const index = ++created;
      return createServer((request: any, response: any) => {
        if (index === 1) {
          releaseOld = () => handler(request, response);
          return;
        }
        handler(request, response);
      });
    });
    try {
      const harness = await loadMain();
      const event = fakeEvent(harness.windows[0].webContents.id);
      const add = harness.ipcHandlers.get('auth:add')!;
      const cancel = harness.ipcHandlers.get('auth:cancel')!;
      const old = add(event);
      void old.catch(() => {});
      await vi.waitFor(() => expect(harness.shell.openExternal).toHaveBeenCalledTimes(1));
      const authorization = new URL(harness.shell.openExternal.mock.calls[0][0]);
      const callback = new URL(authorization.searchParams.get('redirect_uri')!);
      callback.searchParams.set('state', authorization.searchParams.get('state')!);
      callback.searchParams.set('code', 'old-code');
      const oldResponse = fetch(callback);
      await vi.waitFor(() => expect(releaseOld).toBeTypeOf('function'));
      await cancel(event);
      await expect(old).rejects.toThrow('AUTH_CANCELLED');
      const newer = add(event);
      void newer.catch(() => {});
      await vi.waitFor(() => expect(harness.shell.openExternal).toHaveBeenCalledTimes(2));
      releaseOld!();
      expect((await oldResponse).status).toBe(409);
      expect(harness.netRequests).toHaveLength(0);
      await cancel(event);
      await expect(newer).rejects.toThrow('AUTH_CANCELLED');
    } finally {
      spy.mockRestore();
    }
  });

  it('processes an OAuth callback only once while the first exchange is pending', async () => {
    const harness = await loadMain();
    const event = fakeEvent(harness.windows[0].webContents.id);
    const pending = harness.ipcHandlers.get('auth:add')!(event);
    void pending.catch(() => {});
    await vi.waitFor(() => expect(harness.shell.openExternal).toHaveBeenCalledOnce());
    const authorization = new URL(harness.shell.openExternal.mock.calls[0][0]);
    const callback = new URL(authorization.searchParams.get('redirect_uri')!);
    callback.searchParams.set('state', authorization.searchParams.get('state')!);
    callback.searchParams.set('code', 'authorization-code');
    const claims = Buffer.from(JSON.stringify({ sub: 'account-b' })).toString('base64url');
    harness.queueNetResponse({
      hold: true,
      status: 200,
      body: JSON.stringify({ access_token: 'access-token', id_token: `x.${claims}.x` }),
    });
    harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: { token: 'csrf' } }) });
    harness.queueNetResponse({
      status: 200,
      headers: {
        'set-cookie': ['token=account-b; Path=/', 'refreshToken=account-b-refresh; Path=/'],
      },
      body: JSON.stringify({ result: { session: { id: 'account-b' } } }),
    });
    harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: true }) });
    const first = fetch(callback);
    await vi.waitFor(() => expect(harness.heldResponses).toHaveLength(1));
    const second = await fetch(callback);
    expect(second.status).toBe(409);
    harness.releaseHeldResponse();
    expect((await first).status).toBe(200);
    await expect(pending).resolves.toMatchObject({ subject: 'account-b' });
    expect(harness.netRequests.filter((request) => request.url.endsWith('/token'))).toHaveLength(1);
  });

  it('settles pending OAuth before sign-out all can complete', async () => {
    const harness = await loadMain();
    const event = fakeEvent(harness.windows[0].webContents.id);
    const pending = harness.ipcHandlers.get('auth:add')!(event);
    void pending.catch(() => {});
    await vi.waitFor(() => expect(harness.shell.openExternal).toHaveBeenCalledOnce());
    const authorization = new URL(harness.shell.openExternal.mock.calls[0][0]);
    const callback = new URL(authorization.searchParams.get('redirect_uri')!);
    callback.searchParams.set('state', authorization.searchParams.get('state')!);
    callback.searchParams.set('code', 'authorization-code');
    const claims = Buffer.from(JSON.stringify({ sub: 'account-b' })).toString('base64url');
    harness.queueNetResponse({
      hold: true,
      status: 200,
      body: JSON.stringify({ access_token: 'access-token', id_token: `x.${claims}.x` }),
    });
    harness.queueNetResponse({
      status: 200,
      body: JSON.stringify({ result: { token: 'csrf-a' } }),
    });
    harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: {} }) });
    const callbackResponse = fetch(callback);
    await vi.waitFor(() => expect(harness.heldResponses).toHaveLength(1));
    const signOut = harness.ipcHandlers.get('auth:logoutAll')!(event);
    await expect(pending).rejects.toThrow('AUTH_CANCELLED');
    await expect(signOut).resolves.toEqual({ remoteRevocationFailed: false });
    harness.releaseHeldResponse();
    expect((await callbackResponse).status).toBe(400);
    expect(await harness.ipcHandlers.get('auth:accounts')!(event)).toEqual([]);
  });

  it('rejects Add Account for the active subject before Business login', async () => {
    const harness = await loadMain();
    const active = harness.partitions.get(harness.activePartition)!;
    await active.cookies.set({ name: 'token', value: 'old-session' });
    const claims = Buffer.from(JSON.stringify({ sub: 'test-user' })).toString('base64url');
    harness.queueNetResponse({
      status: 200,
      body: JSON.stringify({ access_token: 'access-token', id_token: `x.${claims}.x` }),
    });
    const { pending, response } = await finishLogin(harness, 'auth:add');
    expect(response.status).toBe(400);
    await expect(pending).rejects.toThrow('AUTH_ACCOUNT_ALREADY_ACTIVE');
    expect(harness.netRequests.some((request) => request.url.endsWith('/user/login'))).toBe(false);
    expect(active._cookies.get('token').value).toBe('old-session');
  });

  it('rejects Add Account if its subject became active during OAuth', async () => {
    const harness = await loadMain({ savedSubjects: ['test-user', 'account-b'] });
    const event = fakeEvent(harness.windows[0].webContents.id);
    const b = harness.savedProfiles[1];
    const oldB = harness.partitions.get(b.partition)!;
    await oldB.cookies.set({ name: 'token', value: 'old-b' });
    const add = harness.ipcHandlers.get('auth:add')!(event);
    void add.catch(() => {});
    await vi.waitFor(() => expect(harness.shell.openExternal).toHaveBeenCalledOnce());
    const authorization = new URL(harness.shell.openExternal.mock.calls[0][0]);
    const callback = new URL(authorization.searchParams.get('redirect_uri')!);
    callback.searchParams.set('state', authorization.searchParams.get('state')!);
    callback.searchParams.set('code', 'authorization-code');
    const claims = Buffer.from(JSON.stringify({ sub: 'account-b' })).toString('base64url');
    harness.queueNetResponse({
      status: 200,
      body: JSON.stringify({ access_token: 'access-token', id_token: `x.${claims}.x` }),
    });
    harness.queueNetResponse({
      status: 200,
      body: JSON.stringify({ result: { token: 'candidate-csrf' } }),
    });
    harness.queueNetResponse({
      status: 200,
      headers: {
        'set-cookie': [
          'token=new-b; Path=/',
          'refreshToken=new-b-refresh; Path=/',
          'safeIdToken=new-b-access; Path=/',
          'safeIdRefreshToken=new-b-safeid; Path=/',
        ],
      },
      body: JSON.stringify({ result: { session: { id: 'account-b' } } }),
    });
    harness.queueNetResponse({ hold: true, status: 200, body: JSON.stringify({ result: true }) });
    const callbackResponse = fetch(callback);
    await vi.waitFor(() => expect(harness.heldResponses).toHaveLength(1));
    harness.queueNetResponse({
      status: 200,
      body: JSON.stringify({ result: { id: 'account-b' } }),
    });
    harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: true }) });
    await harness.ipcHandlers.get('auth:activate')!(event, b.key);
    harness.queueNetResponse({
      status: 200,
      body: JSON.stringify({ result: { token: 'revoke-csrf' } }),
    });
    harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: {} }) });
    harness.releaseHeldResponse();
    expect((await callbackResponse).status).toBe(400);
    await expect(add).rejects.toThrow('AUTH_ACCOUNT_ALREADY_ACTIVE');
    expect(oldB._cookies.get('token').value).toBe('old-b');
    const active = (await harness.ipcHandlers.get('auth:accounts')!(event)).find(
      (account: any) => account.active,
    );
    expect(active.subject).toBe('account-b');
  });

  it('revokes only the replaced inactive account family after successful enrollment', async () => {
    const harness = await loadMain({ savedSubjects: ['test-user', 'account-b'] });
    const event = fakeEvent(harness.windows[0].webContents.id);
    const oldB = harness.partitions.get(harness.savedProfiles[1].partition)!;
    await oldB.cookies.set({ name: 'token', value: 'old-b' });
    await oldB.cookies.set({ name: 'refreshToken', value: 'old-b-refresh' });
    await oldB.cookies.set({ name: 'safeIdToken', value: 'old-b-access' });
    await oldB.cookies.set({ name: 'safeIdRefreshToken', value: 'old-b-safeid' });
    queueLogin(harness, 'account-b', [
      'token=new-b; Path=/',
      'refreshToken=new-b-refresh; Path=/',
      'safeIdRefreshToken=new-b-safeid; Path=/',
    ]);
    harness.queueNetResponse({
      status: 200,
      headers: { 'set-cookie': '_csrf=old-b-csrf; Path=/' },
      body: JSON.stringify({ result: { token: 'csrf-old-b' } }),
    });
    harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: {} }) });
    const { pending, response } = await finishLogin(harness, 'auth:add');
    expect(response.status).toBe(200);
    const added = await pending;
    expect(added.subject).toBe('account-b');
    const oldLogout = harness.netRequests.find((request) => request.url.endsWith('/user/logout'))!;
    expect(oldLogout.request.headers.Cookie).toBe('refreshToken=old-b-refresh; _csrf=old-b-csrf');
    expect(oldB._cookies.size).toBe(0);
    const active = (await harness.ipcHandlers.get('auth:accounts')!(event)).find(
      (account: any) => account.active,
    );
    expect(active.subject).toBe('test-user');
  });

  it('rejects an activation whose saved profile was replaced during preflight', async () => {
    const harness = await loadMain({ savedSubjects: ['test-user', 'account-b'] });
    const event = fakeEvent(harness.windows[0].webContents.id);
    const b = harness.savedProfiles[1];
    const oldB = harness.partitions.get(b.partition)!;
    await oldB.cookies.set({ name: 'token', value: 'old-b' });
    await oldB.cookies.set({ name: 'refreshToken', value: 'old-b-refresh' });
    await oldB.cookies.set({ name: 'safeIdRefreshToken', value: 'old-b-safeid' });
    harness.queueNetResponse({
      hold: true,
      status: 200,
      body: JSON.stringify({ result: { id: 'account-b' } }),
    });
    const activation = harness.ipcHandlers.get('auth:activate')!(event, b.key);
    void activation.catch(() => {});
    await vi.waitFor(() => expect(harness.heldResponses).toHaveLength(1));
    queueLogin(harness, 'account-b', [
      'token=new-b; Path=/',
      'refreshToken=new-b-refresh; Path=/',
      'safeIdRefreshToken=new-b-safeid; Path=/',
    ]);
    harness.queueNetResponse({
      status: 200,
      body: JSON.stringify({ result: { token: 'csrf-old-b' } }),
    });
    harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: {} }) });
    const { pending } = await finishLogin(harness, 'auth:add');
    await pending;
    harness.releaseHeldResponse();
    await expect(activation).rejects.toThrow('AUTH_CONTEXT_CHANGED');
    const active = (await harness.ipcHandlers.get('auth:accounts')!(event)).find(
      (account: any) => account.active,
    );
    expect(active.subject).toBe('test-user');
  });

  it('revokes a candidate family when access check rejects login', async () => {
    const harness = await loadMain();
    const claims = Buffer.from(JSON.stringify({ sub: 'account-b' })).toString('base64url');
    harness.queueNetResponse({
      status: 200,
      body: JSON.stringify({ access_token: 'access-token', id_token: `x.${claims}.x` }),
    });
    harness.queueNetResponse({
      status: 200,
      body: JSON.stringify({ result: { token: 'csrf-b' } }),
    });
    harness.queueNetResponse({
      status: 200,
      headers: {
        'set-cookie': [
          'token=new-b; Path=/',
          'refreshToken=new-b-refresh; Path=/',
          'safeIdToken=new-b-access; Path=/',
          'safeIdRefreshToken=new-b-safeid; Path=/',
        ],
      },
      body: JSON.stringify({ result: { session: { id: 'account-b' } } }),
    });
    harness.queueNetResponse({
      status: 403,
      body: JSON.stringify({ error: 'integration_tester_required' }),
    });
    harness.queueNetResponse({
      status: 200,
      headers: { 'set-cookie': '_csrf=candidate-csrf; Path=/' },
      body: JSON.stringify({ result: { token: 'csrf-candidate' } }),
    });
    harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: {} }) });
    const { pending, response } = await finishLogin(harness, 'auth:add');
    expect(response.status).toBe(400);
    await expect(pending).rejects.toThrow('integration tester');
    const logout = harness.netRequests.find((request) => request.url.endsWith('/user/logout'))!;
    expect(logout.request.headers.Cookie).toBe('refreshToken=new-b-refresh; _csrf=candidate-csrf');
    const candidate = Array.from(harness.partitions.entries()).find(([name]) =>
      name.startsWith('inheriti-api-login-'),
    )![1];
    expect(candidate._cookies.size).toBe(0);
  });

  it('keeps the old account if a staged cookie write fails', async () => {
    const harness = await loadMain();
    const active = harness.partitions.get(harness.activePartition)!;
    await active.cookies.set({ name: 'token', value: 'old-session' });
    harness.failAccountCookieSetAt(2);
    queueLogin(harness, 'test-user', [
      'token=new-session; Path=/',
      'refreshToken=new-refresh; Path=/',
    ]);
    const { pending, response } = await finishLogin(harness, 'auth:login');
    expect(response.status).toBe(400);
    await expect(pending).rejects.toThrow('cookie_write_failed');
    expect(active._cookies.get('token').value).toBe('old-session');
    const staged = Array.from(harness.partitions.entries()).find(
      ([name]) => name.startsWith(`persist:inheriti-api-`) && name !== harness.activePartition,
    )![1];
    expect(staged._cookies.size).toBe(0);
    expect(
      (
        await harness.ipcHandlers.get('auth:accounts')!(
          fakeEvent(harness.windows[0].webContents.id),
        )
      ).filter((account: any) => account.active),
    ).toHaveLength(1);
  });

  it('keeps the old account if registry persistence fails', async () => {
    const harness = await loadMain();
    const active = harness.partitions.get(harness.activePartition)!;
    await active.cookies.set({ name: 'token', value: 'old-session' });
    queueLogin(harness, 'test-user');
    const write = fsSync.writeFileSync;
    const spy = vi
      .spyOn(fsSync, 'writeFileSync')
      .mockImplementation((file: string, ...args: any[]) => {
        if (String(file).includes('importer-accounts.json'))
          throw new Error('registry_write_failed');
        return write(file, ...args);
      });
    try {
      const { pending, response } = await finishLogin(harness, 'auth:login');
      expect(response.status).toBe(400);
      await expect(pending).rejects.toThrow('registry_write_failed');
      expect(active._cookies.get('token').value).toBe('old-session');
      const staged = Array.from(harness.partitions.entries()).find(
        ([name]) => name.startsWith('persist:inheriti-api-') && name !== harness.activePartition,
      )![1];
      expect(staged._cookies.size).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('does not let a delayed old response overwrite duplicate-login cookies', async () => {
    const harness = await loadMain();
    const event = fakeEvent(harness.windows[0].webContents.id);
    const active = harness.partitions.get(harness.activePartition)!;
    await active.cookies.set({ name: 'token', value: 'old-session' });
    harness.queueNetResponse({
      status: 200,
      hold: true,
      headers: { 'set-cookie': 'token=stale-refresh; Path=/' },
      body: JSON.stringify({ result: {} }),
    });
    const oldRequest = harness.ipcHandlers.get('api:request')!(event, {
      method: 'GET',
      path: '/user/session',
    });
    void oldRequest.catch(() => {});
    await vi.waitFor(() => expect(harness.heldResponses).toHaveLength(1));
    queueLogin(harness, 'test-user', ['token=new-session; Path=/']);
    const { pending } = await finishLogin(harness, 'auth:login');
    await pending;
    const account = (await harness.ipcHandlers.get('auth:accounts')!(event)).find(
      (item: any) => item.active,
    );
    const newPartition = Array.from(harness.partitions.entries()).find(
      ([name]) =>
        name.startsWith(`persist:inheriti-api-${account.key}-`) && name !== harness.activePartition,
    )![1];
    harness.releaseHeldResponse();
    await expect(oldRequest).rejects.toThrow('AUTH_CONTEXT_CHANGED');
    expect(newPartition._cookies.get('token').value).toBe('new-session');
    expect(active._cookies.size).toBe(0);
  });

  it('clears the legacy login without adopting it or touching other storage', async () => {
    const harness = await loadMain({ signedIn: false, legacyCookie: true });
    const legacy = harness.partitions.get('persist:inheriti-api')!;
    expect(legacy.clearStorageData).toHaveBeenCalledWith({ storages: ['cookies'] });
    expect(legacy._cookies.size).toBe(0);
    expect(
      await harness.ipcHandlers.get('auth:session')!(fakeEvent(harness.windows[0].webContents.id)),
    ).toBeNull();
    expect(harness.netRequests).toHaveLength(0);
  });

  it('retains Add Account cookies separately and activates only after server checks', async () => {
    const harness = await loadMain();
    const event = fakeEvent(harness.windows[0].webContents.id);
    const active = harness.partitions.get(harness.activePartition)!;
    await active.cookies.set({ name: 'token', value: 'account-a' });
    const claims = Buffer.from(JSON.stringify({ sub: 'account-b' })).toString('base64url');
    harness.queueNetResponse({
      status: 200,
      body: JSON.stringify({ access_token: 'access-b', id_token: `x.${claims}.x` }),
    });
    harness.queueNetResponse({
      status: 200,
      body: JSON.stringify({ result: { token: 'csrf-b' } }),
    });
    harness.queueNetResponse({
      status: 200,
      headers: {
        'set-cookie': ['token=account-b; Path=/', 'refreshToken=account-b-refresh; Path=/'],
      },
      body: JSON.stringify({ result: { session: { id: 'account-b' } } }),
    });
    harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: true }) });
    const { pending, response } = await finishLogin(harness, 'auth:add');
    expect(response.status).toBe(200);
    const added = await pending;
    expect(added).toMatchObject({ subject: 'account-b', session: { id: 'account-b' } });
    expect(
      (await harness.ipcHandlers.get('auth:accounts')!(event)).find(
        (account: any) => account.active,
      ).subject,
    ).toBe('test-user');
    const bPartition = Array.from(harness.partitions.entries()).find(([name]) =>
      name.startsWith(`persist:inheriti-api-${added.key}-`),
    )![1];
    expect(bPartition._cookies.get('token').value).toBe('account-b');
    expect(active._cookies.get('token').value).toBe('account-a');

    harness.queueNetResponse({
      status: 200,
      body: JSON.stringify({ result: { id: 'account-b' } }),
    });
    harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: true }) });
    await harness.ipcHandlers.get('auth:activate')!(event, added.key);
    expect(
      (await harness.ipcHandlers.get('auth:accounts')!(event)).find(
        (account: any) => account.active,
      ).subject,
    ).toBe('account-b');
    expect(harness.netRequests.at(-2)!.request.headers.Cookie).toContain('token=account-b');
    harness.queueNetResponse({
      status: 200,
      body: JSON.stringify({ result: { token: 'csrf-b-2' } }),
    });
    harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: {} }) });
    await expect(harness.ipcHandlers.get('auth:remove')!(event, added.key)).resolves.toEqual({
      remoteRevocationFailed: false,
    });
    expect(bPartition._cookies.size).toBe(0);
    expect(active._cookies.get('token').value).toBe('account-a');
    expect(
      (await harness.ipcHandlers.get('auth:accounts')!(event)).map(
        (account: any) => account.subject,
      ),
    ).toEqual(['test-user']);
  });

  it('checks Importer access with the new API cookie before accepting login', async () => {
    const harness = await loadMain();
    const claims = Buffer.from(JSON.stringify({ sub: 'user-1' })).toString('base64url');
    harness.queueNetResponse({
      status: 200,
      body: JSON.stringify({ access_token: 'access-token', id_token: `x.${claims}.x` }),
    });
    harness.queueNetResponse({
      status: 200,
      headers: {
        'set-cookie': [
          'browserSession=stale-broker; Path=/',
          'oldBrowserSession=stale-broker; Path=/',
        ],
      },
      body: JSON.stringify({ result: { token: 'csrf' } }),
    });
    harness.queueNetResponse({
      status: 201,
      headers: {
        'set-cookie': [
          'browserSession=; Path=/; Max-Age=0',
          'oldBrowserSession=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
          'token=session-cookie; Path=/',
          'refreshToken=refresh-cookie; Path=/',
          'safeIdToken=safeid-cookie; Path=/',
        ],
      },
      body: JSON.stringify({ result: { session: { id: 'user-1' } } }),
    });
    harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: true }) });

    const { pending, response } = await finishLogin(harness);
    expect(response.status).toBe(200);
    await expect(pending).resolves.toEqual({ id: 'user-1' });
    const check = harness.netRequests.at(-1)!;
    expect(check.url).toBe(`${ORIGIN}/integrations/tester-access`);
    expect(check.request.headers.Cookie).toContain('token=session-cookie');
    expect(check.request.headers.Cookie).not.toContain('browserSession');
    expect(check.request.headers.Cookie).not.toContain('oldBrowserSession');
    const candidate = Array.from(harness.partitions.entries()).find(([name]) =>
      name.startsWith('inheriti-api-login-'),
    )![1];
    expect(candidate.cookies.remove).toHaveBeenCalledTimes(2);
  });

  it('clears the API session and explains denied Importer access', async () => {
    const harness = await loadMain();
    const claims = Buffer.from(JSON.stringify({ sub: 'user-1' })).toString('base64url');
    harness.queueNetResponse({
      status: 200,
      body: JSON.stringify({ access_token: 'access-token', id_token: `x.${claims}.x` }),
    });
    harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: { token: 'csrf' } }) });
    harness.queueNetResponse({
      status: 200,
      headers: { 'set-cookie': 'token=session-cookie; Path=/' },
      body: JSON.stringify({ result: { session: { id: 'user-1' } } }),
    });
    harness.queueNetResponse({
      status: 403,
      body: JSON.stringify({ error: 'integration_tester_required' }),
    });

    const { pending, response } = await finishLogin(harness);
    expect(response.status).toBe(400);
    await expect(pending).rejects.toThrow(
      'You are not an integration tester. Contact developer support.',
    );
    const candidate = Array.from(harness.partitions.entries()).find(([name]) =>
      name.startsWith('inheriti-api-login-'),
    )![1];
    expect(candidate.clearStorageData).toHaveBeenCalledWith({ storages: ['cookies'] });
    expect(candidate._cookies.size).toBe(0);
  });

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
    expect(response.headers.get('content-security-policy')).toContain(
      'img-src data:; font-src data:',
    );
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
    const harness = await loadMain({ signedIn: false });
    const event = fakeEvent(harness.windows[0].webContents.id);
    const logout = harness.ipcHandlers.get('auth:logout')!;
    await expect(logout(event)).resolves.toEqual({ remoteRevocationFailed: false });
    await expect(logout(event)).resolves.toEqual({ remoteRevocationFailed: false });
  });

  it('accepts Business 201 logout and clears the local account cookies', async () => {
    const harness = await loadMain();
    const event = fakeEvent(harness.windows[0].webContents.id);
    const partition = harness.partitions.get(harness.activePartition)!;
    await partition.cookies.set({ name: 'token', value: 'account-a' });
    await partition.cookies.set({ name: 'refreshToken', value: 'account-a-refresh' });
    harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: { token: 'csrf' } }) });
    harness.queueNetResponse({ status: 201, body: JSON.stringify({ result: {} }) });

    await expect(harness.ipcHandlers.get('auth:logout')!(event)).resolves.toEqual({
      remoteRevocationFailed: false,
    });
    expect(harness.netRequests.at(-1)!.url).toBe(`${ORIGIN}/user/logout`);
    expect(partition._cookies.size).toBe(0);
    expect(await harness.ipcHandlers.get('auth:accounts')!(event)).toEqual([]);
  });

  it('finishes local sign-out when remote revocation stalls and ignores its late cookie', async () => {
    const harness = await loadMain();
    const event = fakeEvent(harness.windows[0].webContents.id);
    const partition = harness.partitions.get(harness.activePartition)!;
    await partition.cookies.set({ name: 'token', value: 'account-a' });
    await partition.cookies.set({ name: 'refreshToken', value: 'account-a-refresh' });
    harness.queueNetResponse({
      hold: true,
      status: 200,
      headers: { 'set-cookie': 'token=late-cookie; Path=/' },
      body: JSON.stringify({ result: { token: 'csrf' } }),
    });
    const signOut = harness.ipcHandlers.get('auth:logout')!(event);
    await vi.waitFor(() => expect(harness.heldResponses).toHaveLength(1));
    await expect(signOut).resolves.toEqual({ remoteRevocationFailed: true });
    expect(await harness.ipcHandlers.get('auth:accounts')!(event)).toEqual([]);
    expect(partition._cookies.size).toBe(0);
    harness.releaseHeldResponse();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(partition._cookies.size).toBe(0);
  }, 10000);

  it('does not restore a profile after cookie deletion fails during sign-out', async () => {
    const harness = await loadMain();
    const event = fakeEvent(harness.windows[0].webContents.id);
    const partition = harness.partitions.get(harness.activePartition)!;
    await partition.cookies.set({ name: 'token', value: 'account-a' });
    await partition.cookies.set({ name: 'refreshToken', value: 'account-a-refresh' });
    partition.clearStorageData.mockRejectedValueOnce(new Error('cookie_clear_failed'));
    harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: { token: 'csrf' } }) });
    harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: {} }) });
    await expect(harness.ipcHandlers.get('auth:logout')!(event)).rejects.toThrow(
      'cookie_clear_failed',
    );
    expect(await harness.ipcHandlers.get('auth:accounts')!(event)).toEqual([]);
    const saved = JSON.parse(
      fsSync.readFileSync(`${harness.userData}/importer-accounts.json`, 'utf8'),
    );
    expect(saved.profiles).toEqual([]);
    expect(saved.activeKey).toBeUndefined();
  });

  it('clears local credentials even when remote logout is unavailable', async () => {
    const harness = await loadMain();
    const event = fakeEvent(harness.windows[0].webContents.id);
    const partition = harness.partitions.get(harness.activePartition)!;
    await partition.cookies.set({ name: 'token', value: 'account-a' });
    await partition.cookies.set({ name: 'refreshToken', value: 'account-a-refresh' });
    const result = await harness.ipcHandlers.get('auth:logout')!(event);
    expect(result).toEqual({ remoteRevocationFailed: true });
    expect(partition._cookies.size).toBe(0);
    expect(await harness.ipcHandlers.get('auth:accounts')!(event)).toEqual([]);
  });

  it('disconnects the socket and clears subscriptions on logout', async () => {
    const harness = await loadMain();
    const event = fakeEvent(harness.windows[0].webContents.id);
    const subscribe = harness.ipcHandlers.get('socket:subscribe')!;
    await subscribe(event, { event: 'tenant_changed', payload: { tenantId: 't1' } });
    const socket = harness.socketInstances[0];

    const logout = harness.ipcHandlers.get('auth:logout')!;
    harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: { token: 'csrf' } }) });
    harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: {} }) });
    await logout(event);
    expect(socket.disconnect).toHaveBeenCalled();
    const [, lateEvent] = socket.on.mock.calls.find((call: any[]) => call[0] === 'tenant_changed')!;
    lateEvent({ owner: 'old-account' });
    expect(event.sender.send).not.toHaveBeenCalled();

    await expect(
      subscribe(event, { event: 'tenant_changed', payload: { tenantId: 't1' } }),
    ).rejects.toThrow('AUTH_SIGNED_OUT');
    expect(harness.socketInstances).toHaveLength(1);
  });
});
