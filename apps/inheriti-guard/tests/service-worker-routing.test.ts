import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const listeners: Record<string, ((...args: any[]) => any) | undefined> = {};
const fillBatch = vi.fn(async (_batch: unknown, _initiator?: string) => [{ selector: 'login.username', targetId: 'target-auto', code: 'filled' }]);
const clearSession = vi.fn(async () => undefined);
const signInMock = vi.fn(async (_auth?: unknown, _signal?: AbortSignal) => undefined);
const shutdownReveal = vi.fn(async () => undefined);
const abortPlanAccess = vi.fn(async (_planId: string, _expectedRevealId?: string) => ({ kind: 'DONE', message: 'Access aborted.' }));
const cancelPending = vi.fn(async (_planId: string) => ({ kind: 'DONE', message: 'Request canceled.' }));
const reconcileReveal = vi.fn(async (_planId: string) => ({ kind: 'WARNING', message: 'Access still open',
  detail: '', code: 'active_access_open', planId: _planId, revealId: '22222222-2222-4222-8222-222222222222' }));
let revealState: Record<string, unknown> = { kind: 'IDLE' };
let businessMode = false;
let businessOrganizations = [{ id: 'org-a', name: 'Alpha' }, { id: 'org-b', name: 'Beta' }];
const selectedOrganizations: Record<string, string> = {};
const coreOrganizations: Array<string | undefined> = [];
const listedOrganizations: Array<string | undefined> = [];
const planListInputs: unknown[] = [];
const localValues: Record<string, unknown> = {};
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
    reconcile = reconcileReveal;
    async closeAbandoned() {}
    async shutdown() { await shutdownReveal(); }
    async recoverAbandoned() {}
    async resume() { return { kind: 'IDLE' }; }
    async fillBatch(batch: unknown, initiator?: string) { return fillBatch(batch, initiator); }
    async fields() { return { kind: 'READY', planId: 'plan-1', fields: [] }; }
  },
  isRevealDeadline: () => false,
}));
vi.mock('../src/background/session-store.js', () => ({
  SessionStorageOperatorSessionStore: class {
    clear = clearSession;
    async load() { return { principal: { issuer: 'https://safeid.test', subject: 'user-a', environment: 'TEST' } }; }
  },
}));
vi.mock('../src/background/plans.js', () => ({
  createCore: (_configuration: unknown, _sessions: unknown, _transport: unknown, organizationId?: string) => {
    coreOrganizations.push(organizationId);
    return {
    auth: {},
    forgetMasterKey: vi.fn(async () => undefined),
    getAccessToken: async () => 'operator-token',
    listOrganizations: async () => businessOrganizations,
    listPlans: async (input?: unknown) => {
      listedOrganizations.push(organizationId);
      planListInputs.push(input);
      return { items: [{ id: 'plan-1', name: 'Exact plan' }, { id: 'plan-2', name: 'Fallback plan' }] };
    },
    getPlan: async (planId: string) => ({ assets: [{ id: `asset-${planId}`, code: 'login', name: 'Login', type: 'USER-PSWD',
      isBinary: false, fieldNames: planFieldNames, matchOrigins: planId === 'plan-1' ? ['https://example.test'] : [] }] }),
  }; },
  loadPlans: async () => ({ kind: 'EMPTY' }),
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
  issuer: 'https://safeid.test', environment: 'TEST', ...(businessMode ? {} : { applicationId: 'standalone-test' }),
}) }));
vi.mock('../src/background/auth.js', () => ({ signIn: signInMock }));

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
  await import('../src/background/service-worker.js');
  await listeners.action!({ id: 7, windowId: 2, url: 'https://example.test/login' });
});

beforeEach(() => {
  fillBatch.mockClear(); clearSession.mockClear(); signInMock.mockClear(); shutdownReveal.mockClear(); abortPlanAccess.mockClear(); cancelPending.mockClear(); reconcileReveal.mockClear();
  revealState = { kind: 'IDLE' };
  businessMode = false; workspaceFields = discovered; overlayFields = discovered; planFieldNames = ['username']; planListInputs.length = 0;
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
      kind: 'SELECT_ORGANIZATION', reason: 'The saved organization is no longer available.',
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

    await expect(signingIn).resolves.toEqual({ ok: true, state: { kind: 'ERROR', code: 'login_cancelled' } });
    expect(clearSession.mock.calls.length).toBeGreaterThanOrEqual(2);
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
