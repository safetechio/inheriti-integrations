import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const listeners: Record<string, ((...args: any[]) => any) | undefined> = {};
const fillBatch = vi.fn(async (_batch: unknown, _initiator?: string) => [{ selector: 'login.username', targetId: 'target-auto', code: 'filled' }]);
const fillField = vi.fn(async () => ({ kind: 'DONE', message: 'Filled.' }));
const clearSession = vi.fn(async () => { mockProfiles = mockProfiles.filter((profile) => !profile.active); mockGeneration += 1; });
const clearAllSessions = vi.fn(async () => { mockProfiles = []; mockGeneration += 1; });
const clearAuth = vi.fn(async (_profileId?: string) => undefined);
const signInMock = vi.fn(async (_auth?: unknown, _signal?: AbortSignal) => undefined);
const shutdownReveal = vi.fn(async () => undefined);
const abortPlanAccess = vi.fn(async (_planId: string, _expectedRevealId?: string) => ({ kind: 'DONE', message: 'Access aborted.' }));
const cancelPending = vi.fn(async (_planId: string) => ({ kind: 'DONE', message: 'Request canceled.' }));
const reconcileReveal = vi.fn(async (_planId: string) => ({ kind: 'WARNING', message: 'Access still open',
  detail: '', code: 'active_access_open', planId: _planId, revealId: '22222222-2222-4222-8222-222222222222' }));
let revealState: Record<string, unknown> = { kind: 'IDLE' };
let businessMode = false;
let profileApiUrl: string | undefined;
const hasMasterKey = vi.fn(async (_ref: unknown) => false);
const loadCachedKey = vi.fn(async (_ref: unknown): Promise<Uint8Array | undefined> => undefined);
const loadPlansMock = vi.fn(async () => ({ kind: 'EMPTY' }));
const listOrganizationsMock = vi.fn(async (_profileId?: string) => businessOrganizations);
let businessOrganizations = [{ id: 'org-a', name: 'Alpha' }, { id: 'org-b', name: 'Beta' }];
const selectedOrganizations: Record<string, string> = {};
const coreOrganizations: Array<string | undefined> = [];
const listedOrganizations: Array<string | undefined> = [];
const planListInputs: unknown[] = [];
const localValues: Record<string, unknown> = {};
type MockProfile = { id: string; issuer: string; environment: string; authorizedParty: string;
  subject: string; expiresAt: number; active: boolean; needsSignIn?: boolean };
let mockProfiles: MockProfile[] = [{ id: 'account-a', issuer: 'https://safeid.test', environment: 'TEST',
  authorizedParty: 'chrome-test', subject: 'user-a', expiresAt: Date.now() + 60_000, active: true }];
let mockGeneration = 0;
let pauseSnapshot: (() => Promise<void>) | undefined;
let pauseForProfile: ((id: string) => Promise<void>) | undefined;
const revokedProfiles = new Set<string>();
const coreProfiles: Array<string | undefined> = [];
function storageArea(values: Record<string, unknown>) {
  return {
    get: vi.fn(async (keys: string | string[]) => Object.fromEntries((typeof keys === 'string' ? [keys] : keys)
      .filter((key) => key in values).map((key) => [key, values[key]]))),
    set: vi.fn(async (next: Record<string, unknown>) => { Object.assign(values, next); }),
    remove: vi.fn(async (keys: string | string[]) => { for (const key of typeof keys === 'string' ? [keys] : keys) delete values[key]; }),
  };
}

const discovered = [
  { targetId: 'target-type', origin: 'https://example.test', navigationId: 'nav-1', semantic: 'username',
    label: 'Account', autocomplete: '', inputType: 'text', name: 'account', elementId: 'account' },
  { targetId: 'target-auto', origin: 'https://example.test', navigationId: 'nav-1', semantic: 'username',
    label: 'Login', autocomplete: 'username', inputType: 'text', name: 'login', elementId: 'login' },
];
let workspaceFields = discovered;
let overlayFields = discovered;
let planFieldNames: Array<'username' | 'email' | 'password'> = ['username'];

vi.mock('../src/background/reveal.js', () => ({
  ChromeRevealController: class {
    current() { return revealState; }
    cancel() { return { kind: 'RUNNING', message: 'Canceling reveal…' }; }
    abortPlanAccess = abortPlanAccess;
    cancelPending = cancelPending;
    cancelBatchForTab() {}
    cancelBatchOnTabChange() {}
    ownsBatchInOtherWindow() { return false; }
    cancelActiveBatch() {}
    cancelBatchForOrigin() {}
    reconcile = reconcileReveal;
    async closeAbandoned() {}
    async shutdown() { await shutdownReveal(); }
    async recoverAbandoned() {}
    async resume() { return { kind: 'IDLE' }; }
    async fillBatch(batch: unknown, initiator?: string) { return fillBatch(batch, initiator); }
    fill = fillField;
    async fields() { return { kind: 'READY', planId: 'plan-1', fields: [] }; }
  },
  isRevealDeadline: () => false,
}));
vi.mock('../src/background/session-store.js', () => ({
  SessionStorageOperatorSessionStore: class {
    bind() {}
    clear = clearSession;
    clearAll = clearAllSessions;
    async load() { return { principal: { issuer: 'https://safeid.test', subject: 'user-a', environment: 'TEST',
      authorizedParty: 'chrome-test', sessionId: 'session-a' } }; }
    async snapshot() {
      const pause = pauseSnapshot;
      pauseSnapshot = undefined;
      if (pause !== undefined) await pause();
      return { session: await this.load(), generation: mockGeneration };
    }
    async profiles() { return mockProfiles; }
    async forProfile(id: string) { await pauseForProfile?.(id); return { profileId: id,
      load: async () => ({ accessToken: 'operator-token', expiresAt: Date.now() + 60_000 }) }; }
    async beginEnrollment() { return this; }
    async activate(id: string) { if (mockProfiles.find((profile) => profile.active)?.id !== id) mockGeneration += 1;
      mockProfiles = mockProfiles.map((profile) => ({
      id: profile.id, issuer: profile.issuer, environment: profile.environment, authorizedParty: profile.authorizedParty,
      subject: profile.subject, expiresAt: profile.expiresAt, active: profile.id === id,
      ...(profile.needsSignIn === undefined ? {} : { needsSignIn: profile.needsSignIn }),
    })); return true; }
    async remove(id: string) { mockProfiles = mockProfiles.filter((profile) => profile.id !== id); mockGeneration += 1; }
    async bumpGeneration() { mockGeneration += 1; }
  },
}));
vi.mock('../src/background/session-key-vault.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/background/session-key-vault.js')>();
  return { operatorSessionIdentity: original.operatorSessionIdentity,
    SessionStorageKeyVault: class { load = loadCachedKey; } };
});
vi.mock('../src/background/plans.js', () => ({
  createCore: (_configuration: unknown, _sessions: { profileId?: string }, _transport: unknown, organizationId?: string) => {
    coreOrganizations.push(organizationId);
    coreProfiles.push(_sessions.profileId);
    return {
    auth: { clear: async () => clearAuth(_sessions.profileId) },
    forgetMasterKey: vi.fn(async () => undefined),
    hasMasterKey,
    getAccessToken: async () => 'operator-token',
    listOrganizations: async () => {
      if (_sessions.profileId && revokedProfiles.has(_sessions.profileId)) {
        mockProfiles = mockProfiles.map((profile) => profile.id === _sessions.profileId
          ? { id: profile.id, issuer: profile.issuer, environment: profile.environment,
            authorizedParty: profile.authorizedParty, subject: profile.subject, expiresAt: profile.expiresAt,
            active: false, needsSignIn: true } : profile);
        mockGeneration += 1;
        throw { status: 401 };
      }
      return listOrganizationsMock(_sessions.profileId);
    },
    listPlans: async (input?: unknown) => {
      listedOrganizations.push(organizationId);
      planListInputs.push(input);
      return { items: [{ id: 'plan-1', name: 'Exact plan' }, { id: 'plan-2', name: 'Fallback plan' }] };
    },
    getPlan: async (planId: string) => ({ assets: [{ id: `asset-${planId}`, code: 'login', name: 'Login', type: 'USER-PSWD',
      isBinary: false, fieldNames: planFieldNames, matchOrigins: planId === 'plan-1' ? ['https://example.test'] : [] }] }),
  }; },
  loadPlans: loadPlansMock,
  loadPlanAssets: async () => [],
}));
vi.mock('../src/shared/stored-configuration.js', () => ({
  readStoredConfiguration: async () => ({}),
  readBusinessOrganization: async (_local: unknown, key: string) => selectedOrganizations[key],
  writeBusinessOrganization: async (_local: unknown, key: string, id?: string) => {
    if (id === undefined) delete selectedOrganizations[key]; else selectedOrganizations[key] = id;
  },
}));
vi.mock('../src/shared/configuration.js', () => ({ resolveConfiguration: () => ({
  apiUrl: profileApiUrl, issuer: 'https://safeid.test', environment: 'TEST', clientId: 'chrome-test',
  ...(businessMode ? {} : { applicationId: 'standalone-test' }),
}) }));
vi.mock('../src/background/auth.js', () => ({ signIn: signInMock, chooseAnotherSafeIdAccount: vi.fn(async () => undefined) }));

beforeAll(async () => {
  Object.assign(globalThis, { chrome: {
    storage: { session: storageArea({}), local: storageArea(localValues) },
    action: { onClicked: { addListener: (listener: (...args: any[]) => any) => { listeners.action = listener; } } },
    tabs: {
      query: vi.fn(async () => [{ id: 7, windowId: 2, url: 'https://example.test/login' }]),
      sendMessage: vi.fn(async (_tabId: number, message: { type?: string }) => message.type === 'inheriti-overlay-discover-targets'
        ? overlayFields.map(({ targetId, origin, navigationId, semantic, label }) => ({ targetId, origin, navigationId, semantic, label }))
        : undefined),
      onUpdated: { addListener: (listener: (...args: any[]) => any) => { listeners.updated = listener; } },
      onActivated: { addListener: (listener: (...args: any[]) => any) => { listeners.activated = listener; } },
      onRemoved: { addListener: (listener: (...args: any[]) => any) => { listeners.removed = listener; } },
      remove: vi.fn(async () => undefined),
      onCreated: { addListener: (listener: (...args: any[]) => any) => { listeners.created = listener; } },
    },
    sidePanel: { open: vi.fn(async () => undefined) },
    alarms: { onAlarm: { addListener: vi.fn() }, create: vi.fn(async () => undefined), clear: vi.fn(async () => true) },
    permissions: {
      request: vi.fn(async () => true),
      contains: vi.fn(async ({ origins }: { origins: string[] }) => origins[0] === 'https://example.test/*'),
      getAll: vi.fn(async () => ({ origins: ['https://example.test/*'] })),
      remove: vi.fn(async () => true),
      onRemoved: { addListener: vi.fn() },
    },
    runtime: {
      onMessage: { addListener: (listener: (...args: any[]) => any) => { listeners.message = listener; } },
      onConnect: { addListener: (listener: (...args: any[]) => any) => { listeners.connect = listener; } },
    },
    declarativeNetRequest: { getDynamicRules: vi.fn(async () => []), updateDynamicRules: vi.fn(async () => undefined) },
    idle: { setDetectionInterval: vi.fn(), onStateChanged: { addListener: vi.fn() } },
    webNavigation: { onBeforeNavigate: { addListener: (listener: (...args: any[]) => any) => { listeners.beforeNavigate = listener; } } },
    downloads: { onCreated: { addListener: vi.fn() }, cancel: vi.fn(), erase: vi.fn() },
    notifications: { create: vi.fn(async () => undefined) }, browsingData: { remove: vi.fn(async () => undefined) },
    cookies: { getAll: vi.fn(async () => []), remove: vi.fn(async () => undefined) },
    scripting: {
      getRegisteredContentScripts: vi.fn(async () => []), registerContentScripts: vi.fn(async () => undefined),
      unregisterContentScripts: vi.fn(async () => undefined),
      executeScript: vi.fn(async ({ func }: { func?: Function }) => {
      if (func === undefined) return [];
      if (func.name === 'discoverPageFields') return [{ frameId: 0, result: {
        origin: 'https://example.test', navigationId: 'nav-1', fields: workspaceFields,
      } }];
      if (func.name === 'pickPageField') return [{ frameId: 0, result: discovered[1] }];
      return [{ frameId: 0, result: null }];
    }) },
    identity: { getRedirectURL: () => 'https://extension.test/oauth' },
  } });
  await import('../src/background/service-worker/main.js');
  await listeners.action!({ id: 7, windowId: 2, url: 'https://example.test/login' });
});

beforeEach(() => {
  hasMasterKey.mockReset().mockResolvedValue(false);
  loadCachedKey.mockReset().mockResolvedValue(undefined);
  loadPlansMock.mockClear();
  fillBatch.mockClear(); fillField.mockClear(); clearSession.mockClear(); clearAllSessions.mockClear(); clearAuth.mockClear(); signInMock.mockClear(); shutdownReveal.mockClear(); abortPlanAccess.mockClear(); cancelPending.mockClear(); reconcileReveal.mockClear();
  listOrganizationsMock.mockReset().mockImplementation(async () => businessOrganizations);
  mockProfiles = [{ id: 'account-a', issuer: 'https://safeid.test', environment: 'TEST',
    authorizedParty: 'chrome-test', subject: 'user-a', expiresAt: Date.now() + 60_000, active: true }];
  mockGeneration = 0;
  pauseSnapshot = undefined;
  pauseForProfile = undefined;
  revokedProfiles.clear(); coreProfiles.length = 0;
  revealState = { kind: 'IDLE' };
  businessMode = false; workspaceFields = discovered; overlayFields = discovered; planFieldNames = ['username']; planListInputs.length = 0;
  profileApiUrl = undefined;
});

function request(message: unknown): Promise<any> {
  return new Promise((resolve) => { expect(listeners.message!(message, {}, resolve)).toBe(true); });
}

function overlayRequest(message: unknown, sender: Record<string, unknown> = {
  tab: { id: 7, url: 'https://example.test/login' }, frameId: 0, url: 'https://example.test/login',
}): Promise<any> {
  return new Promise((resolve) => { expect(listeners.message!(message, sender, resolve)).toBe(true); });
}

describe('service worker access routing', () => {
  it('shares the active Core when concurrent requests construct it', async () => {
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let calls = 0;
    pauseForProfile = async (id) => {
      if (id === 'account-a' && ++calls === 1) { entered(); await waiting; }
    };
    const first = request({ type: 'load-plans' });
    await started;
    const second = request({ type: 'load-plans' });
    release();
    expect((await Promise.all([first, second])).every((result) => result.ok)).toBe(true);
    expect(coreProfiles.filter((id) => id === 'account-a')).toHaveLength(1);
  });

  it('shares active auth while organization discovery overlaps another Core request', async () => {
    businessMode = true;
    selectedOrganizations[JSON.stringify(['https://safeid.test', 'TEST', 'user-a'])] = 'org-a';
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    listOrganizationsMock.mockImplementationOnce(async () => { entered(); await waiting; return businessOrganizations; });
    const discovering = request({ type: 'load-plans' });
    await started;
    expect(await request({ type: 'load-plan-assets', planId: 'plan-1' }))
      .toMatchObject({ ok: true, assets: [] });
    release();
    expect((await discovering).ok).toBe(true);
    expect(coreProfiles.filter((id) => id === 'account-a')).toHaveLength(1);
    delete selectedOrganizations[JSON.stringify(['https://safeid.test', 'TEST', 'user-a'])];
  });

  it('shows profile name and email only for authenticated Business accounts', async () => {
    businessMode = true;
    profileApiUrl = 'https://business.test/integrations/';
    mockProfiles.push({ id: 'account-b', issuer: 'https://safeid.test', environment: 'TEST',
      authorizedParty: 'chrome-test', subject: 'user-b', expiresAt: 0, active: false, needsSignIn: true });
    const fetchProfile = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true,
      json: async () => ({ result: { firstName: 'Alice', lastName: 'Smith', email: 'a@business.test' } }) } as Response);
    const result = await request({ type: 'load-plans' });
    expect(result.ok).toBe(true);
    expect(result.state.accounts).toMatchObject([
      { id: 'account-a', label: 'Alice Smith', email: 'a@business.test' },
      { id: 'account-b', needsSignIn: true },
    ]);
    expect(result.state.accounts[1].email).toBeUndefined();
    expect(fetchProfile).toHaveBeenCalledWith(new URL('https://business.test/integrations/v1/importer/profile'),
      { headers: { Authorization: 'Bearer operator-token', 'x-elements-environment': 'TEST' }, signal: expect.any(AbortSignal) });
    expect(fetchProfile).toHaveBeenCalledTimes(1);
    fetchProfile.mockRestore();
  });

  it('shows the selected Business organisation role when available', async () => {
    businessMode = true;
    profileApiUrl = 'https://business.test/integrations/';
    selectedOrganizations[JSON.stringify(['https://safeid.test', 'TEST', 'user-a'])] = 'org-a';
    const fetchProfile = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => ({ ok: true,
      json: async () => String(input).endsWith('/v1/organizations')
        ? { result: { items: [{ id: 'org-a', roleName: 'Owner' }] } }
        : { result: { firstName: 'Alice', lastName: 'Smith', email: 'a@business.test' } },
    }) as Response);
    const result = await request({ type: 'load-plans' });
    expect(result.state.accounts?.[0]).toMatchObject({ label: 'Alice Smith', email: 'a@business.test', role: 'Owner' });
    expect(fetchProfile).toHaveBeenCalledTimes(2);
    fetchProfile.mockRestore();
    delete selectedOrganizations[JSON.stringify(['https://safeid.test', 'TEST', 'user-a'])];
  });

  it('serializes concurrent inactive-profile refresh discovery', async () => {
    businessMode = true;
    mockProfiles.push({ id: 'account-b', issuer: 'https://safeid.test', environment: 'TEST',
      authorizedParty: 'chrome-test', subject: 'user-b', expiresAt: 0, active: false });
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let token = 'old';
    let oldTokenExchanges = 0;
    listOrganizationsMock.mockImplementation(async (id) => {
      if (id !== 'account-b') return businessOrganizations;
      if (token === 'old') {
        oldTokenExchanges += 1;
        if (oldTokenExchanges > 1) {
          mockProfiles = mockProfiles.map((profile) => profile.id === 'account-b'
            ? { id: profile.id, issuer: profile.issuer, environment: profile.environment,
              authorizedParty: profile.authorizedParty, subject: profile.subject, expiresAt: profile.expiresAt,
              active: profile.active, needsSignIn: true } : profile);
          throw { status: 401 };
        }
        entered();
        await waiting;
        token = 'rotated';
      }
      return businessOrganizations;
    });
    const first = request({ type: 'load-plans' });
    await started;
    const second = request({ type: 'load-plans' });
    await vi.waitFor(() => expect(listOrganizationsMock.mock.calls
      .filter(([id]) => id === 'account-a')).toHaveLength(4));
    expect(oldTokenExchanges).toBe(1);
    release();
    const results = await Promise.all([first, second]);
    expect(oldTokenExchanges).toBe(1);
    expect(results.every((result) => result.ok && result.state.accounts
      .some((account: { id: string; needsSignIn: boolean }) => account.id === 'account-b' && !account.needsSignIn))).toBe(true);
    expect(mockProfiles.find((profile) => profile.id === 'account-b')?.needsSignIn).toBeFalsy();
  });

  it('switches A to B and back while clearing old page work', async () => {
    mockProfiles.push({ id: 'account-b', issuer: 'https://safeid.test', environment: 'TEST',
      authorizedParty: 'chrome-test', subject: 'user-b', expiresAt: Date.now() + 60_000, active: false });
    const loaded = await request({ type: 'load-access-workspace', planId: 'plan-1' });
    expect(loaded.ok).toBe(true);
    const registrations = vi.mocked(chrome.scripting.registerContentScripts).mock.calls.length;
    expect(await request({ type: 'switch-account', accountId: 'account-b' }))
      .toMatchObject({ ok: true, state: { accounts: [
        { id: 'account-a', active: false }, { id: 'account-b', active: true },
      ] } });
    expect(coreProfiles).toContain('account-b');
    expect(vi.mocked(chrome.scripting.registerContentScripts).mock.calls.length).toBeGreaterThan(registrations);
    expect(await request({ type: 'set-access-mapping', mapping: {
      protectedField: loaded.protectedFields[0], pageTarget: loaded.pageTargets[0], source: 'MANUAL',
    } })).toEqual({ ok: false, error: 'stale-page-context' });
    expect(await request({ type: 'switch-account', accountId: 'account-a' }))
      .toMatchObject({ ok: true, state: { accounts: [
        { id: 'account-a', active: true }, { id: 'account-b', active: false },
      ] } });
    expect(shutdownReveal).toHaveBeenCalledTimes(2);
  });

  it('blocks switching while an earlier account request is pending', async () => {
    mockProfiles.push({ id: 'account-b', issuer: 'https://safeid.test', environment: 'TEST',
      authorizedParty: 'chrome-test', subject: 'user-b', expiresAt: Date.now() + 60_000, active: false });
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { started = resolve; });
    loadPlansMock.mockImplementationOnce(async () => { started(); await waiting; return { kind: 'EMPTY' }; });
    const oldRequest = request({ type: 'load-plans' });
    await entered;
    let blocked: unknown;
    expect(listeners.message!({ type: 'switch-account', accountId: 'account-b' }, {},
      (response: unknown) => { blocked = response; })).toBe(false);
    expect(blocked).toEqual({ ok: false, error: 'operation-busy' });
    expect(mockProfiles.find((profile) => profile.active)?.id).toBe('account-a');
    release();
    await expect(oldRequest).resolves.toMatchObject({ ok: true, state: { kind: 'EMPTY' } });
    expect((await request({ type: 'switch-account', accountId: 'account-b' })).ok).toBe(true);
  });

  it('allows switching while a token-free key status read is pending', async () => {
    mockProfiles.push({ id: 'account-b', issuer: 'https://safeid.test', environment: 'TEST',
      authorizedParty: 'chrome-test', subject: 'user-b', expiresAt: Date.now() + 60_000, active: false });
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { started = resolve; });
    loadCachedKey.mockImplementationOnce(async () => { started(); await waiting; return new Uint8Array(32); });
    const oldStatus = request({ type: 'get-master-key-status' });
    await entered;
    expect(coreProfiles).toEqual([]);
    expect((await request({ type: 'switch-account', accountId: 'account-b' })).ok).toBe(true);
    expect(coreProfiles).not.toContain('account-a');
    release();
    expect(await oldStatus).toEqual({ ok: false, error: 'stale-page-context' });
    expect(mockProfiles.find((profile) => profile.active)?.id).toBe('account-b');
  });

  it('serializes concurrent switch and removal at message admission', async () => {
    businessMode = true;
    mockProfiles.push({ id: 'account-b', issuer: 'https://safeid.test', environment: 'TEST',
      authorizedParty: 'chrome-test', subject: 'user-b', expiresAt: Date.now() + 60_000, active: false });
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    listOrganizationsMock.mockImplementationOnce(async () => { entered(); await waiting; return businessOrganizations; });
    const switching = request({ type: 'switch-account', accountId: 'account-b' });
    await started;
    let blocked: unknown;
    expect(listeners.message!({ type: 'remove-account', accountId: 'account-a' }, {},
      (response: unknown) => { blocked = response; })).toBe(false);
    expect(blocked).toEqual({ ok: false, error: 'operation-busy' });
    release();
    await switching;
    expect(mockProfiles).toHaveLength(2);
    expect(mockProfiles.find((profile) => profile.active)?.id).toBe('account-b');
  });

  it('blocks switching during A fill, then activates B after it finishes', async () => {
    mockProfiles.push({ id: 'account-b', issuer: 'https://safeid.test', environment: 'TEST',
      authorizedParty: 'chrome-test', subject: 'user-b', expiresAt: Date.now() + 60_000, active: false });
    const tab = { id: 7, windowId: 2, url: 'https://example.test/login' };
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    vi.mocked(chrome.tabs.query).mockImplementationOnce(async () => { entered(); await waiting; return [tab]; });
    fillField.mockImplementationOnce(async () => {
      expect(mockProfiles.find((profile) => profile.active)?.id).toBe('account-a');
      return { kind: 'DONE', message: 'Filled.' };
    });
    const oldFill = request({ type: 'fill-field', planId: 'plan-1', selector: 'login.username' });
    await started;
    let blocked: unknown;
    expect(listeners.message!({ type: 'switch-account', accountId: 'account-b' }, {},
      (response: unknown) => { blocked = response; })).toBe(false);
    expect(blocked).toEqual({ ok: false, error: 'operation-busy' });
    expect(mockProfiles.find((profile) => profile.active)?.id).toBe('account-a');
    release();
    await expect(oldFill).resolves.toMatchObject({ ok: true, reveal: { kind: 'DONE' } });
    expect((await request({ type: 'switch-account', accountId: 'account-b' })).ok).toBe(true);
    expect(fillField).toHaveBeenCalledOnce();
    expect(mockProfiles.find((profile) => profile.active)?.id).toBe('account-b');
  });

  it('rejects stale second-panel actions until it reloads the active generation', async () => {
    mockProfiles.push({ id: 'account-b', issuer: 'https://safeid.test', environment: 'TEST',
      authorizedParty: 'chrome-test', subject: 'user-b', expiresAt: Date.now() + 60_000, active: false });
    const oldGeneration = (await request({ type: 'load-plans' })).state.generation;
    expect((await request({ type: 'switch-account', accountId: 'account-b', expectedGeneration: oldGeneration })).ok).toBe(true);
    expect(await request({ type: 'fill-field', planId: 'plan-1', selector: 'login.username',
      expectedGeneration: oldGeneration })).toEqual({ ok: false, error: 'stale-page-context' });
    expect(await request({ type: 'remove-account', accountId: 'account-b', expectedGeneration: oldGeneration }))
      .toEqual({ ok: false, error: 'stale-page-context' });
    expect(fillField).not.toHaveBeenCalled();
    expect(mockProfiles.find((profile) => profile.active)?.id).toBe('account-b');
    const currentGeneration = (await request({ type: 'load-plans' })).state.generation;
    expect(currentGeneration).toBeGreaterThan(oldGeneration);
    expect((await request({ type: 'get-master-key-status', expectedGeneration: currentGeneration })).ok).toBe(true);
  });

  it('invalidates another panel after a same-account organization change', async () => {
    businessMode = true;
    const oldGeneration = (await request({ type: 'load-plans' })).state.generation;
    const selected = await request({ type: 'select-organization', organizationId: 'org-b',
      expectedGeneration: oldGeneration });
    expect(selected.state.generation).toBeGreaterThan(oldGeneration);
    expect(await request({ type: 'fill-field', planId: 'plan-1', selector: 'login.username',
      expectedGeneration: oldGeneration })).toEqual({ ok: false, error: 'stale-page-context' });
    expect(await request({ type: 'select-organization', organizationId: 'org-a',
      expectedGeneration: oldGeneration })).toEqual({ ok: false, error: 'stale-page-context' });
    expect(fillField).not.toHaveBeenCalled();
    expect((await request({ type: 'load-plans' })).state).toMatchObject({
      organizationId: 'org-b', generation: selected.state.generation,
    });
  });

  it('rejects foreign and forged account destinations before activation', async () => {
    businessMode = true;
    mockProfiles.push({ id: 'account-b', issuer: 'https://safeid.test', environment: 'TEST',
      authorizedParty: 'chrome-test', subject: 'user-b', expiresAt: Date.now() + 60_000, active: false });
    mockProfiles.push({ id: 'foreign', issuer: 'https://safeid.test', environment: 'LIVE',
      authorizedParty: 'chrome-test', subject: 'user-c', expiresAt: Date.now() + 60_000, active: false });
    expect(await request({ type: 'switch-account', accountId: 'foreign' }))
      .toEqual({ ok: false, error: 'plan-request-failed' });
    expect(await request({ type: 'select-account-organization', accountId: 'account-b', organizationId: 'forged' }))
      .toEqual({ ok: false, error: 'plan-request-failed' });
    expect(mockProfiles.find((profile) => profile.active)?.id).toBe('account-a');
    expect((await request({ type: 'load-plans' })).state.accounts).toEqual(expect.not.arrayContaining([
      expect.objectContaining({ id: 'foreign' }),
    ]));
  });

  it('rejects a cross-account destination message aimed at the already-active account', async () => {
    businessMode = true;
    const generation = (await request({ type: 'load-plans' })).state.generation;
    expect(await request({ type: 'select-account-organization', accountId: 'account-a',
      organizationId: 'org-b', expectedGeneration: generation }))
      .toEqual({ ok: false, error: 'plan-request-failed' });
    expect(mockGeneration).toBe(generation);
    expect(mockProfiles.find((profile) => profile.active)?.id).toBe('account-a');
  });

  it('keeps A usable and marks revoked B for sign-in', async () => {
    businessMode = true;
    mockProfiles.push({ id: 'account-b', issuer: 'https://safeid.test', environment: 'TEST',
      authorizedParty: 'chrome-test', subject: 'user-b', expiresAt: Date.now() + 60_000, active: false });
    revokedProfiles.add('account-b');
    const result = await request({ type: 'switch-account', accountId: 'account-b' });
    expect(result.state.accounts).toContainEqual(expect.objectContaining({ id: 'account-b', needsSignIn: true }));
    expect(mockProfiles.find((profile) => profile.active)?.id).toBe('account-a');
  });

  it('asks for sign-in when a selected saved account has no usable session', async () => {
    businessMode = true;
    mockProfiles.push({ id: 'account-b', issuer: 'https://safeid.test', environment: 'TEST',
      authorizedParty: 'chrome-test', subject: 'user-b', expiresAt: Date.now() + 60_000, active: false });
    loadPlansMock.mockResolvedValueOnce({ kind: 'SIGNED_OUT' });
    const result = await request({ type: 'switch-account', accountId: 'account-b' });
    expect(result.state).toMatchObject({ kind: 'ERROR', code: 'operator_reauthentication_required' });
    expect(mockProfiles.find((profile) => profile.active)?.id).toBe('account-a');
  });

  it('retains a credential-cleared B row without querying it or losing A', async () => {
    businessMode = true;
    mockProfiles.push({ id: 'account-b', issuer: 'https://safeid.test', environment: 'TEST',
      authorizedParty: 'chrome-test', subject: 'user-b', expiresAt: Date.now() - 1, active: false,
      needsSignIn: true });
    const state = (await request({ type: 'load-plans' })).state;
    expect(state.accounts).toContainEqual(expect.objectContaining({ id: 'account-b', needsSignIn: true }));
    expect(coreProfiles).not.toContain('account-b');
    expect(mockProfiles.find((profile) => profile.active)?.id).toBe('account-a');
  });

  it('removes one account without clearing the other, then Secure Logoff clears all', async () => {
    mockProfiles.push({ id: 'account-b', issuer: 'https://safeid.test', environment: 'TEST',
      authorizedParty: 'chrome-test', subject: 'user-b', expiresAt: Date.now() + 60_000, active: false });
    const registrations = vi.mocked(chrome.scripting.registerContentScripts).mock.calls.length;
    expect(await request({ type: 'remove-account', accountId: 'account-b' }))
      .toMatchObject({ ok: true, state: { accounts: [{ id: 'account-a', active: true }] } });
    expect(vi.mocked(chrome.scripting.registerContentScripts).mock.calls.length).toBeGreaterThan(registrations);
    expect(clearAuth).toHaveBeenCalledWith('account-b');
    expect(clearAllSessions).not.toHaveBeenCalled();
    await request({ type: 'guard:secure-logoff' });
    expect(mockProfiles).toEqual([]);
    expect(clearAuth).toHaveBeenCalledWith('account-a');
  });

  it('keeps another saved account available after removing the active account', async () => {
    businessMode = true;
    mockProfiles.push({ id: 'account-b', issuer: 'https://safeid.test', environment: 'TEST',
      authorizedParty: 'chrome-test', subject: 'user-b', expiresAt: Date.now() + 60_000, active: false });
    const removed = await request({ type: 'remove-account', accountId: 'account-a' });
    expect(removed).toMatchObject({ ok: true, state: { accounts: [{ id: 'account-b', active: false }] } });
    expect(clearAuth).toHaveBeenCalledWith('account-a');
    expect(clearAllSessions).not.toHaveBeenCalled();
    expect(await request({ type: 'switch-account', accountId: 'account-b' }))
      .toMatchObject({ ok: true, state: { accounts: [{ id: 'account-b', active: true }] } });
  });

  it('reads cached key status without reloading plans and reflects acquisition and clearing', async () => {
    expect(await request({ type: 'get-master-key-status' })).toEqual({ ok: true, keyStatus: { owner: 'Application', loaded: false } });
    expect(loadCachedKey).toHaveBeenLastCalledWith({ system: 'INHERITI_ELEMENTS', contextId: 'standalone-test' });
    loadCachedKey.mockResolvedValue(new Uint8Array(32));
    expect(await request({ type: 'get-master-key-status' })).toEqual({ ok: true, keyStatus: { owner: 'Application', loaded: true } });
    loadCachedKey.mockResolvedValue(undefined);
    expect((await request({ type: 'get-master-key-status' })).keyStatus.loaded).toBe(false);
    expect(loadPlansMock).not.toHaveBeenCalled();
    expect(coreProfiles).toEqual([]);
  });

  it('checks the selected organization key without fetching the plan list', async () => {
    businessMode = true;
    await request({ type: 'select-organization', organizationId: 'org-b' });
    loadPlansMock.mockClear();
    loadCachedKey.mockResolvedValue(new Uint8Array(32));
    expect(await request({ type: 'get-master-key-status' })).toEqual({ ok: true, keyStatus: { owner: 'Organization', loaded: true } });
    expect(loadCachedKey).toHaveBeenLastCalledWith({ system: 'INHERITI_BUSINESS', contextId: 'org-b' });
    expect(loadPlansMock).not.toHaveBeenCalled();
    for (const key of Object.keys(selectedOrganizations)) delete selectedOrganizations[key];
  });
  it('reconciles a valid plan UUID before returning overlay reveal state', async () => {
    const planId = '04912bb5-4d0c-410a-bde8-b341eaf13883';
    const result = await overlayRequest({ type: 'overlay-reveal-state', planId });
    expect(reconcileReveal).toHaveBeenCalledWith(planId);
    expect(result).toMatchObject({ ok: true, reveal: { kind: 'WARNING', planId } });
  });

  it('selects Business organizations per identity and invalidates the held core on switch or stale choice', async () => {
    businessMode = true;
    businessOrganizations = [{ id: 'org-a', name: 'Alpha' }, { id: 'org-b', name: 'Beta' }];
    const choice = await request({ type: 'load-plans' });
    expect(choice.state).toMatchObject({ kind: 'SELECT_ORGANIZATION', organizations: businessOrganizations });

    const firstSelection = await request({ type: 'select-organization', organizationId: 'org-b' });
    expect(firstSelection.error).toBeUndefined();
    expect(firstSelection).toMatchObject({ ok: true, state: { kind: 'EMPTY', organizationId: 'org-b' } });
    expect(coreOrganizations).toContain('org-b');
    await request({ type: 'load-page-first-candidates' });
    expect(listedOrganizations.at(-1)).toBe('org-b');
    expect((await request({ type: 'select-organization', organizationId: 'org-a' })).state)
      .toMatchObject({ kind: 'EMPTY', organizationId: 'org-a' });
    expect(coreOrganizations).toContain('org-a');
    await request({ type: 'load-page-first-candidates' });
    expect(listedOrganizations.at(-1)).toBe('org-a');
    expect(shutdownReveal).toHaveBeenCalledTimes(2);

    businessOrganizations = [{ id: 'org-b', name: 'Beta' }];
    expect((await request({ type: 'load-plans' })).state).toMatchObject({
      kind: 'SELECT_ORGANIZATION', reason: 'The saved organisation is no longer available.',
    });
    expect((await request({ type: 'load-plans' })).state).toMatchObject({ kind: 'EMPTY', organizationId: 'org-b' });
    businessOrganizations = [];
    expect((await request({ type: 'load-plans' })).state.kind).toBe('SELECT_ORGANIZATION');
    businessMode = false;
  });

  it('invalidates an in-flight sign-in before Secure Logoff releases the lifecycle lock', async () => {
    let finishSignIn!: () => void;
    signInMock.mockImplementationOnce(async (_auth, signal) => {
      await new Promise<void>((resolve) => { finishSignIn = resolve; });
      if (signal?.aborted) throw Object.assign(new Error('login_cancelled'), { code: 'login_cancelled' });
    });

    const signingIn = request({ type: 'sign-in' });
    await vi.waitFor(() => expect(signInMock).toHaveBeenCalledOnce());
    await expect(request({ type: 'guard:secure-logoff' })).resolves.toMatchObject({ ok: true });
    finishSignIn();

    await expect(signingIn).resolves.toEqual({ ok: false, error: 'stale-page-context' });
    expect(clearAllSessions).toHaveBeenCalledOnce();
  });

  it('does not start OAuth when Secure Logoff wins a paused sign-in preflight', async () => {
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    pauseSnapshot = async () => { entered(); await waiting; };
    const signingIn = request({ type: 'sign-in', expectedGeneration: 0 });
    await started;
    await request({ type: 'guard:secure-logoff' });
    release();
    await expect(signingIn).resolves.toEqual({ ok: false, error: 'stale-page-context' });
    expect(signInMock).not.toHaveBeenCalled();
    expect(mockProfiles).toEqual([]);
  });

  it('lets Guard denial win for an already-open untrusted tab', async () => {
    await request({ type: 'guard:set-protection', enabled: true });
    await expect(request({ type: 'inspect-active-page' })).resolves.toEqual({ ok: false, error: 'guard-denied' });
    const target = { targetId: 'target-auto', tabId: 7, frameId: 0, origin: 'https://example.test',
      navigationId: 'nav-1', semantic: 'username', label: 'Login' };
    await expect(overlayRequest({ type: 'overlay-load-candidates', target }))
      .resolves.toEqual({ ok: false, error: 'stale-page-context' });
    await request({ type: 'guard:set-protection', enabled: false });
  });
  it('starts from a direct click on the real page field and returns only its asset candidates', async () => {
    const response = await request({ type: 'start-page-first-picker' });
    expect(response.pageTargets).toEqual([expect.objectContaining({ targetId: 'target-auto', label: 'Login' })]);
    expect(response.candidates).toHaveLength(2);
    expect(planListInputs).toContainEqual({ assetType: 'USER-PSWD' });
    expect(response.candidates.every((candidate: any) => candidate.suggestion.mapping.pageTarget.targetId === 'target-auto')).toBe(true);
    expect(fillBatch).not.toHaveBeenCalled();
  });

  it('offers page-field-first candidates across plans and fixes selection to one plan', async () => {
    const candidates = await request({ type: 'load-page-first-candidates' });
    expect(candidates.ok).toBe(true);
    expect(planListInputs).toContainEqual({ assetType: 'USER-PSWD' });
    expect(candidates.pageTargets).toHaveLength(2);
    expect(candidates.candidates.map((candidate: any) => [candidate.planName, candidate.suggestion.reason]))
      .toEqual([
        ['Exact plan', 'exact-origin'], ['Exact plan', 'exact-origin'],
        ['Fallback plan', 'inferred-semantic'], ['Fallback plan', 'inferred-semantic'],
      ]);
    const selectedCandidate = candidates.candidates.find((candidate: any) => candidate.planName === 'Exact plan'
      && candidate.suggestion.mapping.pageTarget.targetId === 'target-auto');
    const selected = await request({ type: 'select-page-first-candidate',
      mapping: selectedCandidate.suggestion.mapping, planName: selectedCandidate.planName });
    expect(selected.batch.identity.planId).toBe('plan-1');
    expect(selected.batch.mappings).toEqual([expect.objectContaining({
      source: 'MANUAL', protectedField: expect.objectContaining({ planId: 'plan-1' }),
    })]);
    expect(JSON.stringify(selected)).not.toContain('value');
    expect(fillBatch).not.toHaveBeenCalled();
  });

  it('loads metadata and returns exact deterministic suggestions', async () => {
    await request({ type: 'discard-access-workspace' });
    const response = await request({ type: 'load-access-workspace', planId: 'plan-1' });
    expect(response.ok).toBe(true);
    expect(response.protectedFields[0]).toMatchObject({ planId: 'plan-1', selector: 'login.username' });
    expect(response.pageTargets.map((target: { targetId: string }) => target.targetId))
      .toEqual(['target-auto', 'target-type']);
    expect(response.suggestions).toEqual([{
      mapping: {
        protectedField: response.protectedFields[0],
        pageTarget: response.pageTargets[0],
        source: 'SUGGESTED',
      },
      confidence: 'HIGH',
      reason: 'autocomplete',
    }]);
    expect(JSON.stringify(response)).not.toContain('value');
  });

  it('opens a plan without treating an empty page as changed', async () => {
    await request({ type: 'discard-access-workspace' });
    workspaceFields = [];
    const response = await request({ type: 'load-access-workspace', planId: 'plan-1' });
    expect(response).toMatchObject({ ok: true, pageTargets: [], suggestions: [] });
    expect(response.protectedFields).toHaveLength(1);
    await request({ type: 'discard-access-workspace' });
  });

  it('accepts only draft-owned mappings and rejects a tampered reveal batch', async () => {
    const loaded = await request({ type: 'load-access-workspace', planId: 'plan-1' });
    const mapping = { protectedField: loaded.protectedFields[0], pageTarget: loaded.pageTargets[0], source: 'SUGGESTED' };
    const saved = await request({ type: 'set-access-mapping', mapping });
    expect(saved.batch.mappings).toEqual([mapping]);

    await expect(request({ type: 'reveal-and-autofill', batch: {
      ...saved.batch, identity: { ...saved.batch.identity, planId: 'other-plan' },
    } })).resolves.toEqual({ ok: false, error: 'invalid-access-batch' });
    expect(fillBatch).not.toHaveBeenCalled();

    await expect(request({ type: 'reveal-and-autofill', batch: saved.batch })).resolves.toEqual({
      ok: true, results: [{ selector: 'login.username', targetId: 'target-auto', code: 'filled' }],
    });
    expect(fillBatch).toHaveBeenCalledTimes(1);
    expect(fillBatch).toHaveBeenCalledWith(saved.batch, 'PANEL');
  });

  it('invalidates the draft on sign-out', async () => {
    const loaded = await request({ type: 'load-access-workspace', planId: 'plan-1' });
    await request({ type: 'sign-out' });
    await expect(request({ type: 'set-access-mapping', mapping: {
      protectedField: loaded.protectedFields[0], pageTarget: loaded.pageTargets[0], source: 'MANUAL',
    } })).resolves.toEqual({ ok: false, error: 'stale-page-context' });
    expect(clearSession).toHaveBeenCalledOnce();
    expect(clearAuth).toHaveBeenCalledOnce();
  });

  it('invalidates selected fields on a same-URL page reload', async () => {
    const loaded = await request({ type: 'load-access-workspace', planId: 'plan-1' });
    const mapping = { protectedField: loaded.protectedFields[0], pageTarget: loaded.pageTargets[0], source: 'MANUAL' };
    expect((await request({ type: 'set-access-mapping', mapping })).batch.mappings).toHaveLength(1);
    listeners.beforeNavigate!({ tabId: 7, frameId: 0, url: 'https://example.test/login' });
    await expect(request({ type: 'set-access-mapping', mapping }))
      .resolves.toEqual({ ok: false, error: 'stale-page-context' });
  });

  it('discards an access workspace without requiring or returning page metadata', async () => {
    const loaded = await request({ type: 'load-access-workspace', planId: 'plan-1' });
    await expect(request({ type: 'discard-access-workspace' }))
      .resolves.toEqual({ ok: true, discarded: true });
    await expect(request({ type: 'set-access-mapping', mapping: {
      protectedField: loaded.protectedFields[0], pageTarget: loaded.pageTargets[0], source: 'MANUAL',
    } })).resolves.toEqual({ ok: false, error: 'stale-page-context' });
  });

  it('revalidates an overlay target against its exact sender before returning metadata candidates', async () => {
    await request({ type: 'discard-access-workspace' });
    const target = { targetId: 'target-auto', tabId: 7, frameId: 0, origin: 'https://example.test',
      navigationId: 'nav-1', semantic: 'username', label: 'Login' };
    const response = await overlayRequest({ type: 'overlay-load-candidates', target });
    expect(response.ok).toBe(true);
    expect(planListInputs).toContainEqual({ assetType: 'USER-PSWD' });
    expect(response.candidates).toHaveLength(2);
    expect(JSON.stringify(response)).not.toContain('value');
    expect(fillBatch).not.toHaveBeenCalled();
  });

  it('aborts an unfinished access only after an explicit, authorized overlay request', async () => {
    businessMode = true;
    await expect(overlayRequest({ type: 'overlay-abort-plan-access', planId: 'invalid' }))
      .resolves.toEqual({ ok: false, error: 'invalid-access-batch' });
    expect(abortPlanAccess).not.toHaveBeenCalled();
    const planId = '04912bb5-4d0c-410a-bde8-b341eaf13883';
    await expect(overlayRequest({ type: 'overlay-abort-plan-access', planId }))
      .resolves.toEqual({ ok: true, reveal: { kind: 'DONE', message: 'Access aborted.' } });
    expect(abortPlanAccess).toHaveBeenCalledWith(planId);
  });

  it.each(['overlay-abort-plan-access', 'overlay-cancel-pending-access'])
  ('clears the inline selection after %s succeeds', async (type) => {
    const planId = '04912bb5-4d0c-410a-bde8-b341eaf13883';
    const loaded = await request({ type: 'load-access-workspace', planId });
    const mapping = { protectedField: loaded.protectedFields[0], pageTarget: loaded.pageTargets[0], source: 'MANUAL' };
    expect((await request({ type: 'set-access-mapping', mapping })).batch.mappings).toHaveLength(1);
    expect((await overlayRequest({ type, planId })).reveal.kind).toBe('DONE');
    await expect(request({ type: 'set-access-mapping', mapping }))
      .resolves.toEqual({ ok: false, error: 'stale-page-context' });
  });

  it('revalidates against the content script that owns the opaque target', async () => {
    workspaceFields = [
      { ...discovered[1]!, targetId: 'other-world-1' },
      { ...discovered[1]!, targetId: 'other-world-2' },
    ];
    const target = { targetId: 'target-auto', tabId: 7, frameId: 0, origin: 'https://example.test',
      navigationId: 'nav-1', semantic: 'username', label: 'Login' };

    const candidates = await overlayRequest({ type: 'overlay-load-candidates', target });
    expect(candidates).toMatchObject({ ok: true, pageTargets: [target] });
    await expect(overlayRequest({ type: 'overlay-select-candidate',
      mapping: candidates.candidates[0].suggestion.mapping, planName: candidates.candidates[0].planName }))
      .resolves.toMatchObject({ ok: true, batch: { mappings: [{ pageTarget: target }] } });
  });

  it('shares the worker-owned draft from overlay to side panel without starting a reveal', async () => {
    await request({ type: 'discard-access-workspace' });
    const target = { targetId: 'target-auto', tabId: 7, frameId: 0, origin: 'https://example.test',
      navigationId: 'nav-1', semantic: 'username', label: 'Login' };
    const candidates = await overlayRequest({ type: 'overlay-load-candidates', target });
    const candidate = candidates.candidates.find((one: any) => one.planName === 'Exact plan');
    const selected = await overlayRequest({ type: 'overlay-select-candidate',
      mapping: candidate.suggestion.mapping, planName: candidate.planName });
    const panel = await request({ type: 'load-access-workspace', planId: 'plan-1' });

    expect(selected.batch.mappings).toHaveLength(1);
    expect(panel.batch).toEqual(selected.batch);
    expect(fillBatch).not.toHaveBeenCalled();
  });

  it('switches plans from the overlay by replacing old mappings', async () => {
    await request({ type: 'discard-access-workspace' });
    const target = { targetId: 'target-auto', tabId: 7, frameId: 0, origin: 'https://example.test',
      navigationId: 'nav-1', semantic: 'username', label: 'Login' };
    const first = await overlayRequest({ type: 'overlay-load-candidates', target });
    const selectedFirst = await overlayRequest({ type: 'overlay-select-candidate',
      mapping: first.candidates.find((one: any) => one.planName === 'Exact plan').suggestion.mapping,
      planName: 'Exact plan' });
    expect(selectedFirst.batch.identity.planId).toBe('plan-1');
    const allPlans = await overlayRequest({ type: 'overlay-load-candidates', target });
    const other = allPlans.candidates.find((one: any) => one.planName === 'Fallback plan');
    expect(other).toBeDefined();
    const switched = await overlayRequest({ type: 'overlay-select-candidate',
      mapping: other.suggestion.mapping, planName: other.planName });
    expect(switched.batch.identity.planId).toBe('plan-2');
    expect(switched.batch.mappings.every((mapping: any) => mapping.protectedField.planId === 'plan-2')).toBe(true);
  });

  it('maps the other unambiguous fields from the selected credential asset', async () => {
    await request({ type: 'discard-access-workspace' });
    planFieldNames = ['email', 'password'];
    overlayFields = [
      { targetId: 'target-email', origin: 'https://example.test', navigationId: 'nav-1', semantic: 'email', label: 'Email',
        autocomplete: 'email', inputType: 'email', name: 'email', elementId: 'email' },
      { targetId: 'target-password', origin: 'https://example.test', navigationId: 'nav-1', semantic: 'password', label: 'Password',
        autocomplete: 'current-password', inputType: 'password', name: 'password', elementId: 'password' },
    ];
    const target = { targetId: 'target-email', tabId: 7, frameId: 0, origin: 'https://example.test',
      navigationId: 'nav-1', semantic: 'email', label: 'Email' };
    const candidates = await overlayRequest({ type: 'overlay-load-candidates', target });
    const candidate = candidates.candidates.find((one: any) => one.planName === 'Exact plan');
    const selected = await overlayRequest({ type: 'overlay-select-candidate',
      mapping: candidate.suggestion.mapping, planName: candidate.planName });

    expect(candidate.assetFieldNames).toEqual(['email', 'password']);
    expect(selected.batch.mappings.map((mapping: any) => [mapping.protectedField.fieldName, mapping.pageTarget.targetId]))
      .toEqual([['email', 'target-email'], ['password', 'target-password']]);
    expect(fillBatch).not.toHaveBeenCalled();
  });

  it('binds an overlay-created batch to the exact authorized iframe', async () => {
    await request({ type: 'discard-access-workspace' });
    const target = { targetId: 'target-auto', tabId: 7, frameId: 3, origin: 'https://example.test',
      navigationId: 'nav-1', semantic: 'username', label: 'Login' };
    const sender = { tab: { id: 7, url: 'https://example.test/login' }, frameId: 3, url: 'https://example.test/embedded-login' };
    const candidates = await overlayRequest({ type: 'overlay-load-candidates', target }, sender);
    const candidate = candidates.candidates.find((one: any) => one.planName === 'Exact plan');
    const selected = await overlayRequest({ type: 'overlay-select-candidate',
      mapping: candidate.suggestion.mapping, planName: candidate.planName }, sender);

    expect(selected.ok).toBe(true);
    expect(selected.batch.identity).toMatchObject({ tabId: 7, frameId: 3, origin: 'https://example.test' });
    expect(selected.batch.mappings[0].pageTarget.frameId).toBe(3);
    expect(fillBatch).not.toHaveBeenCalled();
  });

  it.each([
    [{ tab: { id: 8 }, frameId: 0, url: 'https://example.test/login' }, 'wrong tab'],
    [{ tab: { id: 7 }, frameId: 1, url: 'https://example.test/login' }, 'wrong frame'],
    [{ tab: { id: 7 }, frameId: 0, url: 'https://evil.example/login' }, 'wrong origin'],
  ])('rejects overlay messages from a %s sender', async (sender) => {
    const target = { targetId: 'target-auto', tabId: 7, frameId: 0, origin: 'https://example.test',
      navigationId: 'nav-1', semantic: 'username', label: 'Login' };
    await expect(overlayRequest({ type: 'overlay-load-candidates', target }, sender as never))
      .resolves.toEqual({ ok: false, error: 'stale-page-context' });
  });
});
