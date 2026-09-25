import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChromeRevealController } from '../src/background/reveal.js';
import { deriveMasterKey } from '@safetech/inheriti-core-sdk/crypto';
import { FakeElementsApi } from '@safetech/inheriti-elements-test-kit';
import { createCore } from '../src/background/plans.js';
import { resolveConfiguration } from '../src/shared/configuration.js';
import type { BrowserIntegrationCore } from '@safetech/inheriti-elements-core/browser';
import type { AccessBatch } from '../src/shared/access-contract.js';

const values = new Map<string, unknown>();
const storage = {
  get: vi.fn(async (key: string) => values.has(key) ? { [key]: values.get(key) } : {}),
  set: vi.fn(async (entries: Record<string, unknown>) => { Object.entries(entries).forEach(([key, value]) => values.set(key, value)); }),
  remove: vi.fn(async (key: string) => { values.delete(key); }),
} as unknown as chrome.storage.StorageArea;
const executeScript = vi.fn(async (): Promise<Array<{ result?: unknown }>> => [{ result: undefined }]);
const alarmCreate = vi.fn(async () => undefined);
const alarmClear = vi.fn(async () => true);

beforeEach(() => {
  values.clear();
  vi.clearAllMocks();
  Object.assign(globalThis, {
    chrome: {
      scripting: { executeScript },
      tabs: {
        get: vi.fn(async () => ({ id: 7, windowId: 17, url: 'https://db.example.test/login' })),
        query: vi.fn(async () => [{ id: 7, windowId: 17, url: 'https://db.example.test/login' }]),
      },
      alarms: { create: alarmCreate, clear: alarmClear },
      identity: { getRedirectURL: (path: string) => `https://host.chromiumapp.org/${path}` },
    },
  });
});

const plan = {
  assets: [
    { id: 'login-id', code: 'prod-db', name: 'Production database', isBinary: false,
      fieldNames: ['username', 'password', 'recoveryCode'], matchOrigins: ['https://db.example.test'] },
    { id: 'other-id', code: 'other', name: 'Other login', isBinary: false,
      fieldNames: ['email'], matchOrigins: ['https://other.example.test'] },
    { id: 'seed-id', code: 'seed', name: 'Seed', isBinary: false,
      fieldNames: ['seedPhrase'], matchOrigins: ['https://db.example.test'] },
  ],
};

const batch: AccessBatch = {
  identity: { planId: 'plan-1', tabId: 7, frameId: 0, origin: 'https://db.example.test', navigationId: 'nav-1' },
  mappings: [
    {
      protectedField: { planId: 'plan-1', assetId: 'login-id', assetCode: 'prod-db', assetName: 'Production database',
        assetType: '', fieldName: 'username', selector: 'prod-db.username', matchesOrigin: true },
      pageTarget: { targetId: 'target-user', tabId: 7, frameId: 0, origin: 'https://db.example.test',
        navigationId: 'nav-1', semantic: 'username', label: 'Username' }, source: 'SUGGESTED',
    },
    {
      protectedField: { planId: 'plan-1', assetId: 'login-id', assetCode: 'prod-db', assetName: 'Production database',
        assetType: '', fieldName: 'password', selector: 'prod-db.password', matchesOrigin: true },
      pageTarget: { targetId: 'target-password', tabId: 7, frameId: 0, origin: 'https://db.example.test',
        navigationId: 'nav-1', semantic: 'password', label: 'Password' }, source: 'MANUAL',
    },
  ],
};

function core(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    getPlan: vi.fn(async () => plan),
    getActivePlanReveal: vi.fn(async () => null),
    reveals: { close: vi.fn(async () => undefined) },
    withReveal: vi.fn(async (_planId, options, work) => {
      options.onSession({ id: 'reveal-1', stage: 'AUTHORIZED', expiresAt: '2030-01-01T00:00:00.000Z' });
      return work({
        session: { id: 'reveal-1', expiresAt: '2030-01-01T00:00:00.000Z' },
        field: vi.fn(async () => 'alice'),
      });
    }),
    ...overrides,
  };
}

function asCore(value: Record<string, unknown>): BrowserIntegrationCore {
  return value as unknown as BrowserIntegrationCore;
}

/**
 * Exactly what `chrome.storage.session` holds for a configured extension. `DERIVED` custody is the
 * Application's, not the host's: Elements records it when the Application is created and locks it
 * once a plan exists, so the salt travels with it and only the secret is the operator's.
 */
const STORED_CONFIGURATION = {
  apiUrl: 'https://elements.example.test',
  issuer: 'https://issuer.example.test',
  clientId: 'chrome-host',
  applicationId: 'application-1',
  environment: 'TEST',
  masterKeyCustody: 'DERIVED',
  masterKeySalt: 'b'.repeat(64),
  masterKeySecret: 'operator-passphrase',
};

const sessions = { load: async () => undefined, save: async () => undefined, clear: async () => undefined };

/** The service worker's own composition, with only the transport substituted. */
function productionCore(api: FakeElementsApi, overrides: Record<string, unknown> = {}): BrowserIntegrationCore {
  return createCore(resolveConfiguration({ ...STORED_CONFIGURATION, ...overrides }), sessions, api.fetch);
}

/**
 * The key the host will actually derive, so the fixture seals its material under the same one the
 * extension's own `PassphraseMasterKeySource` produces from the stored secret and the Application's
 * salt. Nothing here is substituted for the host's custody — it is re-derived alongside it.
 */
function hostDerivedMasterKey(): Promise<string> {
  return deriveMasterKey(STORED_CONFIGURATION.masterKeySecret, STORED_CONFIGURATION.masterKeySalt);
}

describe('Chrome reveal controller', () => {
  it('does not start a reveal when cancellation lands during target preflight', async () => {
    let finishPreflight!: (value: Array<{ result: string }>) => void;
    executeScript.mockImplementationOnce(() => new Promise((resolve) => { finishPreflight = resolve; }));
    const instance = core({ abortPlanAccess: vi.fn(async () => ({ aborted: false })) });
    const controller = new ChromeRevealController(async () => asCore(instance), storage);
    const filling = controller.fillBatch(batch);
    await vi.waitFor(() => expect(executeScript).toHaveBeenCalledOnce());
    await controller.abortPlanAccess('plan-1');
    finishPreflight([{ result: 'ready' }]);
    await expect(filling).resolves.toEqual(batch.mappings.map((mapping) => ({
      selector: mapping.protectedField.selector, targetId: mapping.pageTarget.targetId, code: 'canceled',
    })));
    expect(instance.withReveal).not.toHaveBeenCalled();
  });

  it('does not start a field reveal when cancellation lands during plan lookup', async () => {
    let finishLookup!: (value: typeof plan) => void;
    const instance = core({ getPlan: vi.fn(async () => new Promise<typeof plan>((resolve) => { finishLookup = resolve; })),
      abortPlanAccess: vi.fn(async () => ({ aborted: false })) });
    const controller = new ChromeRevealController(async () => asCore(instance), storage);
    const filling = controller.fill({ planId: 'plan-1', selector: 'prod-db.username',
      origin: 'https://db.example.test', tabId: 7 });
    await vi.waitFor(() => expect(instance.getPlan).toHaveBeenCalledOnce());
    await controller.abortPlanAccess('plan-1');
    finishLookup(plan);
    await expect(filling).resolves.toMatchObject({ kind: 'ERROR', message: 'Reveal canceled.' });
    expect(instance.withReveal).not.toHaveBeenCalled();
  });

  it('does not let an old reveal finish a newer SafeKey PRO popup', async () => {
    let finishOld!: () => void;
    let finishNew!: () => void;
    const oldGate = new Promise<void>((resolve) => { finishOld = resolve; });
    const newGate = new Promise<void>((resolve) => { finishNew = resolve; });
    const finishes = [vi.fn(), vi.fn()];
    const withReveal = vi.fn()
      .mockImplementationOnce(async () => oldGate)
      .mockImplementationOnce(async () => newGate);
    const instance = core({ withReveal, abortPlanAccess: vi.fn(async () => ({ aborted: true })) });
    const proOptions = vi.fn(async () => ({ selectCustodianDevice: async () => 'SK_PRO' as const,
      proDevice: { read: vi.fn(), write: vi.fn() }, finish: finishes[proOptions.mock.calls.length - 1]! }));
    const controller = new ChromeRevealController(async () => asCore(instance), storage, () => 'Organisation', proOptions);
    const old = controller.fill({ planId: 'plan-1', selector: 'prod-db.username',
      origin: 'https://db.example.test', tabId: 7 });
    await vi.waitFor(() => expect(withReveal).toHaveBeenCalledTimes(1));
    await controller.abortPlanAccess('plan-1');
    expect(finishes[0]).toHaveBeenCalledOnce();
    const next = controller.fill({ planId: 'plan-1', selector: 'prod-db.username',
      origin: 'https://db.example.test', tabId: 7 });
    await vi.waitFor(() => expect(withReveal).toHaveBeenCalledTimes(2));
    finishOld();
    await old;
    expect(finishes[1]).not.toHaveBeenCalled();
    finishNew();
    await next;
    expect(finishes[1]).toHaveBeenCalledOnce();
  });
  it('does not start a reveal when Secure Logoff lands during target preflight', async () => {
    let finishPreflight!: (value: Array<{ result: string }>) => void;
    executeScript.mockImplementationOnce(() => new Promise((resolve) => { finishPreflight = resolve; }));
    const instance = core();
    const controller = new ChromeRevealController(async () => asCore(instance), storage);

    const filling = controller.fillBatch(batch);
    await vi.waitFor(() => expect(executeScript).toHaveBeenCalledOnce());
    await controller.shutdown();
    finishPreflight([{ result: 'ready' }]);

    await expect(filling).resolves.toEqual([
      { selector: 'prod-db.username', targetId: 'target-user', code: 'canceled' },
      { selector: 'prod-db.password', targetId: 'target-password', code: 'canceled' },
    ]);
    expect(instance.withReveal).not.toHaveBeenCalled();
  });

  it('does not write plaintext when Secure Logoff lands while the revealed field is pending', async () => {
    let finishField!: (value: string) => void;
    const field = vi.fn(() => new Promise<string>((resolve) => { finishField = resolve; }));
    const instance = core({ withReveal: vi.fn(async (_planId, _options, work) => work({
      session: { id: 'reveal-1', expiresAt: '2030-01-01T00:00:00.000Z' }, field,
    })) });
    const controller = new ChromeRevealController(async () => asCore(instance), storage);

    const filling = controller.fill({
      planId: 'plan-1', selector: 'prod-db.username', origin: 'https://db.example.test', tabId: 7,
    });
    await vi.waitFor(() => expect(field).toHaveBeenCalledOnce());
    await controller.shutdown();
    finishField('must-not-be-written');

    await expect(filling).resolves.toEqual({ kind: 'ERROR', message: 'Reveal canceled.' });
    expect(chrome.tabs.query).not.toHaveBeenCalled();
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('rechecks shutdown after active-tab lookup and before the plaintext write', async () => {
    let finishTabQuery!: (tabs: chrome.tabs.Tab[]) => void;
    chrome.tabs.query = vi.fn(() => new Promise((resolve) => { finishTabQuery = resolve; })) as never;
    const instance = core();
    const controller = new ChromeRevealController(async () => asCore(instance), storage);

    const filling = controller.fill({
      planId: 'plan-1', selector: 'prod-db.username', origin: 'https://db.example.test', tabId: 7,
    });
    await vi.waitFor(() => expect(chrome.tabs.query).toHaveBeenCalledOnce());
    await controller.shutdown();
    finishTabQuery([{ id: 7, url: 'https://db.example.test/login' } as chrome.tabs.Tab]);

    await expect(filling).resolves.toEqual({ kind: 'ERROR', message: 'Reveal canceled.' });
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('does not let an old reveal finally clear a newer reveal started after shutdown', async () => {
    let finishOldField!: (value: string) => void;
    let finishNewReveal!: () => void;
    const oldField = vi.fn(() => new Promise<string>((resolve) => { finishOldField = resolve; }));
    let call = 0;
    const withReveal = vi.fn(async (_planId, _options, work) => {
      call += 1;
      if (call === 1) return work({
        session: { id: 'old-reveal', expiresAt: '2030-01-01T00:00:00.000Z' }, field: oldField,
      });
      return new Promise<void>((resolve) => { finishNewReveal = resolve; });
    });
    const instance = core({ withReveal });
    const controller = new ChromeRevealController(async () => asCore(instance), storage);
    const input = { planId: 'plan-1', selector: 'prod-db.username', origin: 'https://db.example.test', tabId: 7 };

    const old = controller.fill(input);
    await vi.waitFor(() => expect(oldField).toHaveBeenCalledOnce());
    await controller.shutdown();
    const newer = controller.fill(input);
    await vi.waitFor(() => expect(withReveal).toHaveBeenCalledTimes(2));
    finishOldField('stale');
    await old;

    expect(controller.current()).toEqual({ kind: 'RUNNING', message: 'Opening the plan.' });
    expect(values.has('inheriti.openReveal')).toBe(true);
    finishNewReveal();
    await newer;
  });

  it('does not resume work admitted before Secure Logoff finishes its plan lookup', async () => {
    values.set('inheriti.openReveal', {
      planId: 'plan-1', deadline: '2030-01-01T00:00:00.000Z',
      intent: { kind: 'FIELD', selector: 'prod-db.username', origin: 'https://db.example.test', tabId: 7 },
    });
    let finishPlan!: (value: typeof plan) => void;
    const getPlan = vi.fn(() => new Promise<typeof plan>((resolve) => { finishPlan = resolve; }));
    const instance = core({ getPlan });
    const controller = new ChromeRevealController(async () => asCore(instance), storage);

    const resuming = controller.resume();
    await vi.waitFor(() => expect(getPlan).toHaveBeenCalledOnce());
    await controller.shutdown();
    finishPlan(plan);

    await expect(resuming).resolves.toEqual({ kind: 'ERROR', message: 'Reveal canceled.' });
    expect(instance.withReveal).not.toHaveBeenCalled();
  });

  it('preflights all targets, then consumes N fields through one reveal and one destination', async () => {
    executeScript
      .mockResolvedValueOnce([{ result: 'ready' }])
      .mockResolvedValueOnce([{ result: 'ready' }])
      .mockResolvedValueOnce([{ result: 'filled' }])
      .mockResolvedValueOnce([{ result: 'filled' }]);
    const consumeFields = vi.fn(async (_requests, destination) => destination([
      { selector: 'prod-db.username', value: 'alice' },
      { selector: 'prod-db.password', value: 'secret' },
    ]));
    const instance = core({ withReveal: vi.fn(async (_planId, options, work) => {
      options.onSession({ id: 'reveal-1', expiresAt: '2030-01-01T00:00:00.000Z' });
      return work({ session: { id: 'reveal-1', expiresAt: '2030-01-01T00:00:00.000Z' }, consumeFields });
    }) });
    const controller = new ChromeRevealController(async () => asCore(instance), storage);

    await expect(controller.fillBatch(batch)).resolves.toEqual([
      { selector: 'prod-db.username', targetId: 'target-user', code: 'filled' },
      { selector: 'prod-db.password', targetId: 'target-password', code: 'filled' },
    ]);
    expect(instance.withReveal).toHaveBeenCalledTimes(1);
    expect(consumeFields).toHaveBeenCalledWith([
      { selector: 'prod-db.username', options: { action: 'AUTOFILL_FIELD', origin: 'https://db.example.test' } },
      { selector: 'prod-db.password', options: { action: 'AUTOFILL_FIELD', origin: 'https://db.example.test' } },
    ], expect.any(Function));
    expect(executeScript).toHaveBeenCalledTimes(4);
    expect([...values.keys()]).toEqual([]);
  });

  it('does not open a reveal when any target fails preflight', async () => {
    executeScript.mockResolvedValueOnce([{ result: 'ready' }]).mockResolvedValueOnce([{ result: 'form-changed' }]);
    const instance = core();
    const controller = new ChromeRevealController(async () => asCore(instance), storage);
    await expect(controller.fillBatch(batch)).resolves.toEqual([
      { selector: 'prod-db.username', targetId: 'target-user', code: 'not-attempted' },
      { selector: 'prod-db.password', targetId: 'target-password', code: 'form-changed' },
    ]);
    expect(instance.withReveal).not.toHaveBeenCalled();
  });

  it('does not write an overlay batch after its origin authorization is revoked', async () => {
    executeScript.mockResolvedValue([{ result: 'ready' }]);
    const consumeFields = vi.fn(async (_requests, destination) => destination([
      { selector: 'prod-db.username', value: 'alice' }, { selector: 'prod-db.password', value: 'secret' },
    ]));
    const instance = core({ withReveal: vi.fn(async (_planId, _options, work) => work({
      session: { id: 'reveal-1', expiresAt: '2030-01-01T00:00:00.000Z' }, consumeFields,
    })) });
    const controller = new ChromeRevealController(async () => asCore(instance), storage,
      () => 'Organisation', undefined, undefined, async () => false);
    await expect(controller.fillBatch(batch, 'OVERLAY')).resolves.toEqual(batch.mappings.map((mapping) => ({
      selector: mapping.protectedField.selector, targetId: mapping.pageTarget.targetId, code: 'authorization-denied',
    })));
    expect(executeScript).toHaveBeenCalledTimes(2);
  });

  it('does not write a batch after the operator switches tabs during approval', async () => {
    executeScript.mockResolvedValue([{ result: 'ready' }]);
    let approve!: () => void;
    const approval = new Promise<void>((resolve) => { approve = resolve; });
    const consumeFields = vi.fn(async (_requests, destination) => destination([
      { selector: 'prod-db.username', value: 'alice' }, { selector: 'prod-db.password', value: 'secret' },
    ]));
    const instance = core({ withReveal: vi.fn(async (_planId, _options, work) => {
      await approval;
      return work({ session: { id: 'reveal-1', expiresAt: '2030-01-01T00:00:00.000Z' }, consumeFields });
    }) });
    const controller = new ChromeRevealController(async () => asCore(instance), storage);
    const filling = controller.fillBatch(batch);
    await vi.waitFor(() => expect(instance.withReveal).toHaveBeenCalledOnce());
    (chrome.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 8, windowId: 17,
      url: 'https://other.example.test' }]);
    controller.cancelBatchOnTabChange(8, 17);
    approve();
    await filling;
    expect(executeScript).toHaveBeenCalledTimes(2);
  });

  it('keeps the batch open when the SafeKey PRO popup activates in another window', async () => {
    executeScript.mockResolvedValueOnce([{ result: 'ready' }]).mockResolvedValueOnce([{ result: 'ready' }])
      .mockResolvedValue([{ result: 'filled' }]);
    let approve!: () => void;
    const approval = new Promise<void>((resolve) => { approve = resolve; });
    const consumeFields = vi.fn(async (_requests, destination) => destination([
      { selector: 'prod-db.username', value: 'alice' }, { selector: 'prod-db.password', value: 'secret' },
    ]));
    const instance = core({ withReveal: vi.fn(async (_planId, _options, work) => {
      await approval;
      return work({ session: { id: 'reveal-1', expiresAt: '2030-01-01T00:00:00.000Z' }, consumeFields });
    }) });
    const controller = new ChromeRevealController(async () => asCore(instance), storage);
    const filling = controller.fillBatch(batch);
    await vi.waitFor(() => expect(instance.withReveal).toHaveBeenCalledOnce());
    controller.cancelBatchOnTabChange(18, 19);
    approve();
    await expect(filling).resolves.toEqual(batch.mappings.map((mapping) => ({
      selector: mapping.protectedField.selector, targetId: mapping.pageTarget.targetId, code: 'filled',
    })));
    expect(executeScript).toHaveBeenCalledTimes(4);
  });

  it('uses the in-page chooser only for an overlay initiated batch', async () => {
    executeScript.mockResolvedValue([{ result: 'ready' }]);
    const proOptions = vi.fn(async () => undefined);
    const controller = new ChromeRevealController(async () => asCore(core()), storage, undefined, proOptions);
    await controller.fillBatch(batch);
    await controller.fillBatch(batch, 'OVERLAY');
    expect(proOptions).toHaveBeenNthCalledWith(1, expect.any(AbortSignal), undefined);
    expect(proOptions).toHaveBeenNthCalledWith(2, expect.any(AbortSignal), batch);
  });

  it('explains an active access owned by another integration', async () => {
    executeScript.mockResolvedValue([{ result: 'ready' }]);
    const instance = core({ withReveal: vi.fn(async () => { throw new Error('merge_process_already_active'); }) });
    const controller = new ChromeRevealController(async () => asCore(instance), storage);
    await controller.fillBatch(batch, 'OVERLAY');
    expect(controller.current()).toEqual({ kind: 'ERROR',
      message: 'Another access is open for this plan. Finish it in the integration where it started, then try again.' });
  });

  it('keeps a released access available for an explicit restart', async () => {
    executeScript.mockResolvedValue([{ result: 'ready' }]);
    const close = vi.fn();
    const revealId = 'b02121ed-cf51-4b91-8062-9072f2e3a2d5';
    const instance = core({ reveals: { close }, getActivePlanReveal: vi.fn(async () => ({ id: revealId })),
      withReveal: vi.fn(async () => { throw Object.assign(new Error('reveal_restart_required'),
      { code: 'reveal_restart_required', revealId }); }) });
    const controller = new ChromeRevealController(async () => asCore(instance), storage);
    await controller.fillBatch(batch, 'OVERLAY');
    expect(controller.current()).toEqual({ kind: 'WARNING', code: 'reveal_restart_required', planId: 'plan-1', revealId,
      message: 'This plan has an open access request. You can cancel it and start again.',
      detail: 'A previous access cannot continue after the browser closed. Restart it to open this plan again; approvals will be requested again.' });
    expect(close).not.toHaveBeenCalled();
  });

  it.each(['STARTING', 'MATERIAL_RELEASED'])('offers conditional cancellation after a generic failure with active %s access', async (stage) => {
    executeScript.mockResolvedValue([{ result: 'ready' }]);
    const revealId = 'b02121ed-cf51-4b91-8062-9072f2e3a2d5';
    const instance = core({ getActivePlanReveal: vi.fn(async () => ({ id: revealId, stage })),
      withReveal: vi.fn(async () => { throw new Error('network_failed SECRET_SHOULD_NOT_LEAK'); }) });
    const controller = new ChromeRevealController(async () => asCore(instance), storage);
    await controller.fillBatch(batch, 'OVERLAY');
    expect(controller.current()).toMatchObject({ kind: 'WARNING', code: 'active_access_open',
      planId: 'plan-1', revealId });
    expect(JSON.stringify(controller.current())).not.toContain('SECRET_SHOULD_NOT_LEAK');
    expect(instance.getActivePlanReveal).toHaveBeenCalledWith('plan-1');
  });

  it('keeps a genuine failure as an error when no access remains active', async () => {
    executeScript.mockResolvedValue([{ result: 'ready' }]);
    const instance = core({ withReveal: vi.fn(async () => { throw new Error('network_failed'); }) });
    const controller = new ChromeRevealController(async () => asCore(instance), storage);
    await controller.fillBatch(batch, 'OVERLAY');
    expect(controller.current()).toEqual({ kind: 'ERROR', message: 'Reveal could not continue. Try again.' });
    expect(instance.getActivePlanReveal).toHaveBeenCalledWith('plan-1');
  });

  it('explains how to free space when SafeKey PRO is full', async () => {
    executeScript.mockResolvedValue([{ result: 'ready' }]);
    const instance = core({ withReveal: vi.fn(async () => { throw new Error('SAFEKEY_NO_SPACE'); }) });
    const controller = new ChromeRevealController(async () => asCore(instance), storage);
    await controller.fillBatch(batch, 'OVERLAY');
    expect(controller.current()).toEqual({ kind: 'ERROR', message: 'SafeKey PRO has no free space. Use SafeKey Desktop Tool to free space, then start a new reveal.' });
  });

  it('reports a stale conditional restart without closing the newer access', async () => {
    const abortPlanAccess = vi.fn(async () => ({ aborted: false }));
    const revealId = '11111111-1111-4111-8111-111111111111';
    const controller = new ChromeRevealController(async () => asCore(core({ abortPlanAccess,
      getActivePlanReveal: vi.fn(async () => ({ id: revealId })) })), storage);
    await expect(controller.abortPlanAccess('plan-1', 'old-reveal')).resolves.toMatchObject({ kind: 'WARNING', revealId });
    expect(abortPlanAccess).toHaveBeenCalledWith('plan-1', 'old-reveal');
  });

  it('stops remaining writes after navigation becomes stale during delivery', async () => {
    executeScript
      .mockResolvedValueOnce([{ result: 'ready' }]).mockResolvedValueOnce([{ result: 'ready' }])
      .mockResolvedValueOnce([{ result: 'page-address-changed' }]);
    const consumeFields = vi.fn(async (_requests, destination) => destination([
      { selector: 'prod-db.username', value: 'alice' }, { selector: 'prod-db.password', value: 'secret' },
    ]));
    const instance = core({ withReveal: vi.fn(async (_planId, _options, work) => work({
      session: { id: 'reveal-1', expiresAt: '2030-01-01T00:00:00.000Z' }, consumeFields,
    })) });
    const controller = new ChromeRevealController(async () => asCore(instance), storage);
    await expect(controller.fillBatch(batch)).resolves.toEqual([
      { selector: 'prod-db.username', targetId: 'target-user', code: 'page-address-changed' },
      { selector: 'prod-db.password', targetId: 'target-password', code: 'not-attempted' },
    ]);
    expect(executeScript).toHaveBeenCalledTimes(3);
    expect(alarmClear).toHaveBeenCalled();
    expect([...values.keys()]).toEqual([]);
  });

  it('preserves per-field outcomes on partial destination failure and closes recovery state', async () => {
    executeScript
      .mockResolvedValueOnce([{ result: 'ready' }]).mockResolvedValueOnce([{ result: 'ready' }])
      .mockResolvedValueOnce([{ result: 'filled' }]).mockRejectedValueOnce(new Error('injection failed'));
    const consumeFields = vi.fn(async (_requests, destination) => destination([
      { selector: 'prod-db.username', value: 'alice' }, { selector: 'prod-db.password', value: 'secret' },
    ]));
    const instance = core({ withReveal: vi.fn(async (_planId, options, work) => {
      options.onSession({ id: 'reveal-1', expiresAt: '2030-01-01T00:00:00.000Z' });
      return work({ session: { id: 'reveal-1', expiresAt: '2030-01-01T00:00:00.000Z' }, consumeFields });
    }) });
    const controller = new ChromeRevealController(async () => asCore(instance), storage);
    await expect(controller.fillBatch(batch)).resolves.toEqual([
      { selector: 'prod-db.username', targetId: 'target-user', code: 'filled' },
      { selector: 'prod-db.password', targetId: 'target-password', code: 'destination-failed' },
    ]);
    expect(alarmClear).toHaveBeenCalled();
    expect([...values.keys()]).toEqual([]);
  });
  it('sorts origin matches first and never offers private recovery material', async () => {
    const controller = new ChromeRevealController(async () => asCore(core()), storage);
    await expect(controller.fields('plan-1', 'https://db.example.test')).resolves.toEqual({
      kind: 'READY',
      planId: 'plan-1',
      fields: [
        { selector: 'prod-db.password', label: 'Production database — password', fieldName: 'password', matchesOrigin: true },
        { selector: 'prod-db.username', label: 'Production database — username', fieldName: 'username', matchesOrigin: true },
        { selector: 'other.email', label: 'Other login — email', fieldName: 'email', matchesOrigin: false },
      ],
    });
  });

  it('opens the reveal the plan calls for, without the panel declaring one', async () => {
    const governedPlan = { ...plan, governance: { mode: 'GOVERNED' } };
    const instance = core({ getPlan: vi.fn(async () => governedPlan) });
    const controller = new ChromeRevealController(async () => asCore(instance), storage);

    await controller.fill({
      planId: 'plan-1', selector: 'prod-db.username', origin: 'https://db.example.test', tabId: 7,
    });

    expect((instance.withReveal as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toMatchObject({ mode: 'GOVERNED' });
  });

  it('passes the Core SafeKey PRO device to a governed reveal and closes the panel operation', async () => {
    const instance = core({ getPlan: vi.fn(async () => ({ ...plan, governance: { mode: 'GOVERNED' } })) });
    const device = { write: vi.fn(), read: vi.fn() };
    const choose = vi.fn(async () => 'SK_PRO' as const);
    const finish = vi.fn();
    const controller = new ChromeRevealController(async () => asCore(instance), storage, () => 'Organisation',
      async () => ({ selectCustodianDevice: choose, proDevice: device, finish }));

    await controller.fill({ planId: 'plan-1', selector: 'prod-db.username', origin: 'https://db.example.test', tabId: 7 });

    expect((instance.withReveal as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toMatchObject({
      mode: 'GOVERNED', selectCustodianDevice: choose, proDevice: device,
    });
    expect(finish).toHaveBeenCalledOnce();
  });

  it('authorizes AUTOFILL_FIELD for the active origin and injects only the selected value after a click', async () => {
    const instance = core();
    const controller = new ChromeRevealController(async () => asCore(instance), storage);
    await expect(controller.fill({
      planId: 'plan-1', selector: 'prod-db.username',
      origin: 'https://db.example.test', tabId: 7,
    })).resolves.toEqual({ kind: 'DONE', message: 'Field filled. Reveal closed.' });

    const work = (instance.withReveal as ReturnType<typeof vi.fn>).mock.calls[0]?.[2];
    expect(work).toBeTypeOf('function');
    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({
      target: { tabId: 7 }, args: ['username', 'alice'],
    }));
    expect([...values.keys()]).toEqual([]);
    expect(alarmCreate).toHaveBeenCalled();
    expect(alarmClear).toHaveBeenCalled();
  });

  it('fills the original browser window while the SafeKey PRO popup has focus', async () => {
    const query = chrome.tabs.query as ReturnType<typeof vi.fn>;
    query.mockImplementation(async (details: chrome.tabs.QueryInfo) => details.windowId === 17
      ? [{ id: 7, windowId: 17, url: 'https://db.example.test/login' }]
      : [{ id: 99, windowId: 99, url: 'chrome-extension://guard/safekey-popup/index.html' }]);
    const controller = new ChromeRevealController(async () => asCore(core()), storage);

    await expect(controller.fill({
      planId: 'plan-1', selector: 'prod-db.username', origin: 'https://db.example.test', tabId: 7,
    })).resolves.toEqual({ kind: 'DONE', message: 'Field filled. Reveal closed.' });
    expect(query).toHaveBeenCalledWith({ active: true, windowId: 17 });
    expect(executeScript).toHaveBeenCalledOnce();
  });

  it('closes a persisted reveal after service-worker eviction without restoring plaintext', async () => {
    const close = vi.fn(async () => undefined);
    values.set('inheriti.openReveal', { revealId: 'abandoned-1', deadline: '2030-01-01T00:00:00.000Z' });
    const controller = new ChromeRevealController(async () => asCore(core({ reveals: { close } })), storage);
    await controller.closeAbandoned();
    expect(close).toHaveBeenCalledWith('abandoned-1', 'CANCELED');
    expect(values.size).toBe(0);
  });

  it('keeps a live reveal a lost worker left behind, and takes it up with the intent that started it', async () => {
    const close = vi.fn(async () => undefined);
    values.set('inheriti.openReveal', {
      planId: 'plan-1',
      deadline: '2030-01-01T00:00:00.000Z',
      revealId: 'open-1',
      message: 'Claim the custodian share in SafeKey Mobile.',
      intent: { kind: 'FIELD', selector: 'prod-db.username', origin: 'https://db.example.test', tabId: 7 },
    });
    const instance = core({ getPlan: vi.fn(async () => ({ ...plan, governance: { mode: 'GOVERNED' } })), reveals: { close } });
    const controller = new ChromeRevealController(async () => asCore(instance), storage);

    await controller.recoverAbandoned();
    expect(controller.current()).toEqual({
      kind: 'RESUMABLE', planId: 'plan-1', message: 'Claim the custodian share in SafeKey Mobile.',
    });
    // The governed access is the thing being resumed, so nothing is closed on the way in.
    expect(close).not.toHaveBeenCalled();

    await expect(controller.resume()).resolves.toEqual({ kind: 'DONE', message: 'Field filled. Reveal closed.' });
    expect((instance.withReveal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe('plan-1');
  });

  it('reconciles an interrupted key release and permits canceling its pending intent', async () => {
    values.set('inheriti.openReveal', {
      planId: 'plan-1', deadline: '2030-01-01T00:00:00.000Z',
      intent: { kind: 'BATCH', batch },
    });
    const instance = core();
    const controller = new ChromeRevealController(async () => asCore(instance), storage);
    expect(await controller.reconcile('plan-1')).toMatchObject({ kind: 'RESUMABLE', planId: 'plan-1' });
    expect(await controller.cancelPending('plan-1')).toMatchObject({ kind: 'DONE' });
    expect(values.has('inheriti.openReveal')).toBe(false);
    expect(instance.getActivePlanReveal).toHaveBeenCalledWith('plan-1');
  });

  it('cancels in one click when the pending request reached the server', async () => {
    const revealId = '11111111-1111-4111-8111-111111111111';
    values.set('inheriti.openReveal', {
      planId: 'plan-1', deadline: '2030-01-01T00:00:00.000Z', intent: { kind: 'BATCH', batch },
    });
    const serverAbort = vi.fn(async () => ({ aborted: true }));
    const instance = core({ getActivePlanReveal: vi.fn(async () => ({ id: revealId })), abortPlanAccess: serverAbort });
    const controller = new ChromeRevealController(async () => asCore(instance), storage);
    expect(await controller.reconcile('plan-1')).toMatchObject({ kind: 'WARNING', planId: 'plan-1', revealId });
    expect(await controller.cancelPending('plan-1')).toMatchObject({ kind: 'DONE' });
    expect(serverAbort).toHaveBeenCalledWith('plan-1', undefined);
    expect(values.has('inheriti.openReveal')).toBe(false);
  });

  it('cancels a request that becomes server-active after the pending card appeared', async () => {
    const revealId = '11111111-1111-4111-8111-111111111111';
    values.set('inheriti.openReveal', { planId: 'plan-1', deadline: '2030-01-01T00:00:00.000Z',
      intent: { kind: 'BATCH', batch } });
    const active = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: revealId });
    const serverAbort = vi.fn(async () => ({ aborted: true }));
    const controller = new ChromeRevealController(async () => asCore(core({
      getActivePlanReveal: active, abortPlanAccess: serverAbort,
    })), storage);
    expect(await controller.reconcile('plan-1')).toMatchObject({ kind: 'RESUMABLE' });
    expect(await controller.cancelPending('plan-1')).toMatchObject({ kind: 'DONE' });
    expect(serverAbort).toHaveBeenCalledWith('plan-1', undefined);
    expect(values.has('inheriti.openReveal')).toBe(false);
  });

  it('persists only relay metadata and cancels it after the reveal worker is replaced', async () => {
    const relayValues = new Map<string, unknown>();
    const relayStorage = {
      get: async (key: string) => relayValues.has(key) ? { [key]: relayValues.get(key) } : {},
      set: async (entries: Record<string, unknown>) => { Object.entries(entries).forEach(([key, value]) => relayValues.set(key, value)); },
      remove: async (key: string) => { relayValues.delete(key); },
    } as chrome.storage.StorageArea;
    const owner = { issuer: 'https://safeid.test', subject: 'user-1', organizationId: 'org-1' };
    const relayId = '11111111-1111-4111-8111-111111111111';
    const instance = core({ withReveal: vi.fn(async (_planId, options) => {
      await options.onRelaySession({ sessionId: relayId, expiresAt: '2030-01-01T00:00:00.000Z' });
      throw new Error('worker-stopped');
    }) });
    const controller = new ChromeRevealController(async () => asCore(instance), storage,
      () => 'Organisation', undefined, { storage: relayStorage, owner: async () => owner });
    await controller.fill({ planId: 'plan-1', selector: 'prod-db.username',
      origin: 'https://db.example.test', tabId: 7 });
    expect(relayValues.get('inheritiGuard.pendingKeyRelay')).toEqual({ ...owner, planId: 'plan-1',
      sessionId: relayId, expiresAt: '2030-01-01T00:00:00.000Z' });
    const cancelMasterKeyRelaySession = vi.fn(async () => undefined);
    const restarted = new ChromeRevealController(async () => asCore(core({ cancelMasterKeyRelaySession })), storage,
      () => 'Organisation', undefined, { storage: relayStorage, owner: async () => owner });
    expect(await restarted.reconcile('plan-1')).toMatchObject({ kind: 'RESUMABLE' });
    expect(await restarted.cancelPending('plan-1')).toMatchObject({ kind: 'DONE' });
    expect(cancelMasterKeyRelaySession).toHaveBeenCalledWith(relayId);
    expect(relayValues.size).toBe(0);
  });

  it('cancels an older plan relay before opening a different plan', async () => {
    const relayId = '11111111-1111-4111-8111-111111111111';
    const owner = { issuer: 'https://safeid.test', subject: 'user-1', organizationId: 'org-1' };
    const relayValues = new Map<string, unknown>([['inheritiGuard.pendingKeyRelay', {
      ...owner, planId: 'plan-1', sessionId: relayId, expiresAt: '2030-01-01T00:00:00.000Z',
    }]]);
    const relayStorage = {
      get: async (key: string) => relayValues.has(key) ? { [key]: relayValues.get(key) } : {},
      set: async (entries: Record<string, unknown>) => { Object.entries(entries).forEach(([key, value]) => relayValues.set(key, value)); },
      remove: async (key: string) => { relayValues.delete(key); },
    } as chrome.storage.StorageArea;
    const cancelMasterKeyRelaySession = vi.fn(async () => undefined);
    const instance = core({ cancelMasterKeyRelaySession });
    const controller = new ChromeRevealController(async () => asCore(instance), storage,
      () => 'Organisation', undefined, { storage: relayStorage, owner: async () => owner });
    await controller.fill({ planId: 'plan-2', selector: 'prod-db.username',
      origin: 'https://db.example.test', tabId: 7 });
    expect(cancelMasterKeyRelaySession).toHaveBeenCalledWith(relayId);
    expect(instance.withReveal).toHaveBeenCalledWith('plan-2', expect.anything(), expect.anything());
    expect(relayValues.size).toBe(0);
  });

  it('reconciles and cancels a running key release after the overlay reply is lost', async () => {
    const instance = core();
    const controller = new ChromeRevealController(async () => asCore(instance), storage);
    const abort = new AbortController();
    Object.assign(controller, { active: abort, state: { kind: 'RUNNING', message: 'Release the Organisation key.' },
      intent: { planId: 'plan-1', deadline: '2030-01-01T00:00:00.000Z', intent: { kind: 'BATCH', batch } } });
    values.set('inheriti.openReveal', { planId: 'plan-1', deadline: '2030-01-01T00:00:00.000Z',
      intent: { kind: 'BATCH', batch } });
    expect(controller.current().kind).toBe('RUNNING');
    expect(await controller.reconcile('plan-1')).toMatchObject({ kind: 'RUNNING' });
    expect(await controller.cancelPending('plan-1')).toMatchObject({ kind: 'DONE' });
    expect(values.has('inheriti.openReveal')).toBe(false);
    expect(abort.signal.aborted).toBe(true);
    expect(controller.current()).toMatchObject({ kind: 'DONE', message: 'Pending request canceled. You can start again.' });
  });

  it('does not cancel a pending request when server access status cannot be checked', async () => {
    values.set('inheriti.openReveal', { planId: 'plan-1', deadline: '2030-01-01T00:00:00.000Z',
      intent: { kind: 'BATCH', batch } });
    const instance = core({ getActivePlanReveal: vi.fn(async () => { throw new Error('offline'); }) });
    const controller = new ChromeRevealController(async () => asCore(instance), storage);
    expect(await controller.cancelPending('plan-1')).toMatchObject({ kind: 'RESUMABLE', planId: 'plan-1' });
    expect(values.has('inheriti.openReveal')).toBe(true);
  });

  it('keeps a running reveal owned when the cancellation status check fails', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const withReveal = vi.fn(async () => { await gate; });
    const instance = core({ withReveal, getActivePlanReveal: vi.fn(async () => { throw new Error('offline'); }) });
    const controller = new ChromeRevealController(async () => asCore(instance), storage);
    const pending = controller.fill({ planId: 'plan-1', selector: 'prod-db.username',
      origin: 'https://db.example.test', tabId: 7 });
    await vi.waitFor(() => expect(withReveal).toHaveBeenCalledOnce());
    expect(await controller.cancelPending('plan-1')).toMatchObject({ kind: 'RESUMABLE', planId: 'plan-1' });
    release();
    await pending;
    expect(values.has('inheriti.openReveal')).toBe(false);
    await expect(controller.fill({ planId: 'plan-1', selector: 'prod-db.username',
      origin: 'https://db.example.test', tabId: 7 })).resolves.toMatchObject({ kind: 'DONE' });
  });

  it('releases the local reveal when relay cancellation fails and retains the relay for retry', async () => {
    const owner = { issuer: 'https://safeid.test', subject: 'user-1', organizationId: 'org-1' };
    const relayId = '11111111-1111-4111-8111-111111111111';
    const relayValues = new Map<string, unknown>([['inheritiGuard.pendingKeyRelay', {
      ...owner, planId: 'plan-1', sessionId: relayId, expiresAt: '2030-01-01T00:00:00.000Z',
    }]]);
    const relayStorage = {
      get: async (key: string) => relayValues.has(key) ? { [key]: relayValues.get(key) } : {},
      set: async (entries: Record<string, unknown>) => { Object.entries(entries).forEach(([key, value]) => relayValues.set(key, value)); },
      remove: async (key: string) => { relayValues.delete(key); },
    } as chrome.storage.StorageArea;
    const cancelMasterKeyRelaySession = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const controller = new ChromeRevealController(async () => asCore(core({ cancelMasterKeyRelaySession })), storage,
      () => 'Organisation', undefined, { storage: relayStorage, owner: async () => owner });
    const abort = new AbortController();
    const recovery = { planId: 'plan-1', deadline: '2030-01-01T00:00:00.000Z', intent: { kind: 'BATCH', batch } };
    Object.assign(controller, { active: abort, state: { kind: 'RUNNING', message: 'Release the Organisation key.' }, intent: recovery });
    values.set('inheriti.openReveal', recovery);
    await expect(controller.cancelPending('plan-1')).rejects.toThrow('offline');
    expect(abort.signal.aborted).toBe(true);
    expect((controller as unknown as { active?: AbortController }).active).toBeUndefined();
    expect(relayValues.has('inheritiGuard.pendingKeyRelay')).toBe(true);
    expect(await controller.cancelPending('plan-1')).toMatchObject({ kind: 'DONE' });
    expect(cancelMasterKeyRelaySession).toHaveBeenCalledTimes(2);
    expect(relayValues.size).toBe(0);
  });

  it('preserves another plan while canceling a stale card', async () => {
    const abort = new AbortController();
    const serverAbort = vi.fn(async () => ({ aborted: true }));
    const controller = new ChromeRevealController(async () => asCore(core({ abortPlanAccess: serverAbort })), storage);
    const recovery = { planId: 'plan-2', deadline: '2030-01-01T00:00:00.000Z',
      intent: { kind: 'BATCH', batch } };
    Object.assign(controller, { active: abort, state: { kind: 'RUNNING', message: 'Opening another plan.' }, intent: recovery });
    values.set('inheriti.openReveal', recovery);
    expect(await controller.cancelPending('plan-1')).toMatchObject({ kind: 'RUNNING' });
    expect(await controller.abortPlanAccess('plan-1')).toMatchObject({ kind: 'RUNNING' });
    expect(serverAbort).not.toHaveBeenCalled();
    expect(abort.signal.aborted).toBe(false);
    expect(values.get('inheriti.openReveal')).toBe(recovery);
    expect(controller.current()).toMatchObject({ kind: 'RUNNING' });
  });

  it('stops an in-memory reveal before canceling its observed server access', async () => {
    const revealId = '11111111-1111-4111-8111-111111111111';
    const abort = new AbortController();
    const serverAbort = vi.fn(async () => { expect(abort.signal.aborted).toBe(true); return { aborted: true }; });
    const controller = new ChromeRevealController(async () => asCore(core({ abortPlanAccess: serverAbort })), storage);
    Object.assign(controller, { active: abort, state: { kind: 'RUNNING', message: 'Opening the plan.' },
      intent: { planId: 'plan-1', deadline: '2030-01-01T00:00:00.000Z', intent: { kind: 'BATCH', batch } } });
    values.set('inheriti.openReveal', { planId: 'plan-1', deadline: '2030-01-01T00:00:00.000Z',
      intent: { kind: 'BATCH', batch } });
    expect(await controller.abortPlanAccess('plan-1', revealId)).toMatchObject({ kind: 'DONE' });
    expect(serverAbort).toHaveBeenCalledWith('plan-1', revealId);
    expect(values.has('inheriti.openReveal')).toBe(false);
  });

  it('blocks a new reveal until server cancellation and local cleanup finish', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const serverAbort = vi.fn(async () => { await gate; return { aborted: true }; });
    const controller = new ChromeRevealController(async () => asCore(core({ abortPlanAccess: serverAbort })), storage);
    const pending = controller.abortPlanAccess('plan-1');
    await vi.waitFor(() => expect(serverAbort).toHaveBeenCalledOnce());
    await expect(controller.fillBatch(batch)).rejects.toMatchObject({ code: 'access-request-failed' });
    release();
    await expect(pending).resolves.toMatchObject({ kind: 'DONE' });
    await expect(controller.fillBatch(batch)).resolves.toBeDefined();
  });

  it('blocks a new reveal while pending-request cleanup is awaiting storage', async () => {
    values.set('inheriti.openReveal', { planId: 'plan-1', deadline: '2030-01-01T00:00:00.000Z',
      intent: { kind: 'BATCH', batch } });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    (storage.remove as ReturnType<typeof vi.fn>).mockImplementationOnce(async (key: string) => {
      await gate;
      values.delete(key);
    });
    const controller = new ChromeRevealController(async () => asCore(core()), storage);
    const pending = controller.cancelPending('plan-1');
    await vi.waitFor(() => expect(storage.remove).toHaveBeenCalledOnce());
    await expect(controller.fillBatch(batch)).rejects.toMatchObject({ code: 'access-request-failed' });
    release();
    await expect(pending).resolves.toMatchObject({ kind: 'DONE' });
    await expect(controller.fillBatch(batch)).resolves.toBeDefined();
  });

  it('closes a reveal whose recovery record is past its deadline instead of offering it', async () => {
    const close = vi.fn(async () => undefined);
    values.set('inheriti.openReveal', {
      planId: 'plan-1', deadline: '2000-01-01T00:00:00.000Z', revealId: 'stale-1',
      intent: { kind: 'FIELD', selector: 'prod-db.username', origin: 'https://db.example.test', tabId: 7 },
    });
    const controller = new ChromeRevealController(async () => asCore(core({ reveals: { close } })), storage);
    await controller.recoverAbandoned();
    expect(close).toHaveBeenCalledWith('stale-1', 'CANCELED');
    expect(values.size).toBe(0);
    expect(controller.current()).toEqual({ kind: 'IDLE' });
  });

  it('surfaces an origin denial without leaking its protocol code', async () => {
    const failing = core({
      withReveal: vi.fn(async () => { throw Object.assign(new Error('denied'), { code: 'action_origin_denied' }); }),
    });
    const controller = new ChromeRevealController(async () => asCore(failing), storage);
    await expect(controller.fill({
      planId: 'plan-1', selector: 'prod-db.password',
      origin: 'https://evil.example.test', tabId: 8,
    })).resolves.toEqual({ kind: 'ERROR', message: 'This page origin is not approved for autofill.' });
  });

  it('shows the dead man\'s switch gate as running, with its own deadline beside the session lifetime', async () => {
    const states: unknown[] = [];
    const instance = core({
      withReveal: vi.fn(async (_planId, options, work) => {
        options.onProgress({
          phase: 'WAITING_FOR_DMS',
          session: {
            id: 'reveal-1', stage: 'WAITING_FOR_DMS',
            expiresAt: '2030-01-01T00:00:00.000Z', dmsExpiresAt: '2030-01-01T00:05:00.000Z',
          },
        });
        states.push(controller.current());
        options.onProgress({
          phase: 'WAITING_FOR_AUTHENTICATION',
          session: { id: 'reveal-1', stage: 'WAITING_FOR_PARTICIPANTS', expiresAt: '2030-01-01T00:00:00.000Z' },
        });
        states.push(controller.current());
        return work({
          session: { id: 'reveal-1', expiresAt: '2030-01-01T00:00:00.000Z' },
          field: vi.fn(async () => 'alice'),
        });
      }),
    });
    const controller = new ChromeRevealController(async () => asCore(instance), storage);

    await controller.fill({
      planId: 'plan-1', selector: 'prod-db.username',
      origin: 'https://db.example.test', tabId: 7,
    });

    expect(states[0]).toEqual({
      kind: 'RUNNING', revealId: 'reveal-1', expiresAt: '2030-01-01T00:00:00.000Z',
      gateExpiresAt: '2030-01-01T00:05:00.000Z',
      message: 'Waiting for the dead man\'s switch until 2030-01-01 00:05 UTC. The designated person can stop this '
        + 'reveal from SafeKey Mobile; otherwise it continues on its own.',
    });
    // The moderator wait is a different gate, so the DMS deadline must not survive into it.
    expect(states[1]).toEqual({
      kind: 'RUNNING', revealId: 'reveal-1', expiresAt: '2030-01-01T00:00:00.000Z',
      // The layer after the switch is the member's own confirmation, not moderation.
      message: 'Authentication request sent to SafeKey Mobile. Confirm it to continue.',
    });
    // Recovery and the deadline alarm stay tied to the reveal session, never to the shorter gate.
    expect(alarmCreate).toHaveBeenCalledWith('inheriti.revealDeadline', {
      when: new Date('2030-01-01T00:00:00.000Z').getTime(),
    });
  });

  it('omits the gate deadline the server did not send', async () => {
    let observed: unknown;
    const instance = core({
      withReveal: vi.fn(async (_planId, options, work) => {
        options.onProgress({
          phase: 'WAITING_FOR_DMS',
          session: { id: 'reveal-1', stage: 'WAITING_FOR_DMS', expiresAt: '2030-01-01T00:00:00.000Z' },
        });
        observed = controller.current();
        return work({
          session: { id: 'reveal-1', expiresAt: '2030-01-01T00:00:00.000Z' },
          field: vi.fn(async () => 'alice'),
        });
      }),
    });
    const controller = new ChromeRevealController(async () => asCore(instance), storage);

    await controller.fill({
      planId: 'plan-1', selector: 'prod-db.username',
      origin: 'https://db.example.test', tabId: 7,
    });

    expect(observed).not.toHaveProperty('gateExpiresAt');
    expect((observed as { message: string }).message).toContain('dead man\'s switch');
  });

  it.each(['WAITING_FOR_AUTHENTICATION', 'WAITING_FOR_MODERATION'] as const)(
    'projects the server governance deadline for %s without replacing session recovery',
    async (phase) => {
      let observed: unknown;
      const instance = core({
        withReveal: vi.fn(async (_planId, options, work) => {
          options.onProgress({
            phase,
            session: {
              id: 'reveal-1', stage: 'WAITING_FOR_PARTICIPANTS',
              expiresAt: '2030-01-01T01:00:00.000Z', governanceExpiresAt: '2030-01-01T00:05:00.000Z',
            },
          });
          observed = controller.current();
          return work({
            session: { id: 'reveal-1', expiresAt: '2030-01-01T01:00:00.000Z' },
            field: vi.fn(async () => 'alice'),
          });
        }),
      });
      const controller = new ChromeRevealController(async () => asCore(instance), storage);

      await controller.fill({
        planId: 'plan-1', selector: 'prod-db.username',
        origin: 'https://db.example.test', tabId: 7,
      });

      expect(observed).toMatchObject({
        kind: 'RUNNING', expiresAt: '2030-01-01T01:00:00.000Z', gateExpiresAt: '2030-01-01T00:05:00.000Z',
      });
      expect(alarmCreate).toHaveBeenCalledWith('inheriti.revealDeadline', {
        when: new Date('2030-01-01T01:00:00.000Z').getTime(),
      });
    },
  );

  // The SDK owns the sequence, so an unfamiliar stage is its call to make, not the panel's; the panel
  // only has to render the phase without leaking a protocol stage into the words.
  it('renders a phase it does not recognise without claiming authentication', async () => {
    let observed: unknown;
    const instance = core({
      withReveal: vi.fn(async (_planId, options, work) => {
        options.onProgress({
          phase: 'CONTINUING',
          session: { id: 'reveal-1', stage: 'WAITING_FOR_SOMETHING_ADDED_LATER', expiresAt: '2030-01-01T00:00:00.000Z' },
        });
        observed = controller.current();
        return work({
          session: { id: 'reveal-1', expiresAt: '2030-01-01T00:00:00.000Z' },
          field: vi.fn(async () => 'alice'),
        });
      }),
    });
    const controller = new ChromeRevealController(async () => asCore(instance), storage);

    await controller.fill({
      planId: 'plan-1', selector: 'prod-db.username',
      origin: 'https://db.example.test', tabId: 7,
    });

    expect((observed as { message: string }).message).toBe('Waiting for this reveal to continue…');
    expect(JSON.stringify(observed)).not.toContain('WAITING_FOR_SOMETHING_ADDED_LATER');
  });

  it('explains a gate reset as a stop with nothing released, not as a generic failure', async () => {
    const instance = core({
      withReveal: vi.fn(async (_planId, options) => {
        options.onProgress({
          phase: 'WAITING_FOR_DMS',
          session: { id: 'reveal-1', stage: 'WAITING_FOR_DMS', expiresAt: '2030-01-01T00:00:00.000Z' },
        });
        options.onProgress({
          phase: 'STOPPED_BY_DMS',
          session: { id: 'reveal-1', stage: 'CANCELED', expiresAt: '2030-01-01T00:00:00.000Z', closedReason: 'DMS_RESET' },
        });
        throw Object.assign(new Error('reveal_authorization_ended:CANCELED'), { code: 'reveal_authorization_ended' });
      }),
    });
    const controller = new ChromeRevealController(async () => asCore(instance), storage);

    await expect(controller.fill({
      planId: 'plan-1', selector: 'prod-db.username',
      origin: 'https://db.example.test', tabId: 7,
    })).resolves.toEqual({
      kind: 'ERROR', message: 'The dead man\'s switch subject stopped this reveal. Nothing was released.',
    });
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('keeps the named moderator rejection in the final autofill state', async () => {
    const instance = core({
      getPlan: vi.fn(async () => ({ ...plan, participants: [{ id: 'm1', displayName: 'Ada',
        lifecycle: 'ACTIVE', relationships: ['MODERATOR'] }] })),
      withReveal: vi.fn(async (_planId, options) => {
        options.onProgress({ phase: 'DENIED', session: { stage: 'DENIED', deniedBy: 'MODERATION',
          moderators: [{ id: 'm1', status: 'REJECTED' }] } });
        throw Object.assign(new Error('reveal_denied'), { code: 'reveal_denied' });
      }),
    });
    const controller = new ChromeRevealController(async () => asCore(instance), storage);

    await controller.fill({ planId: 'plan-1', selector: 'prod-db.username',
      origin: 'https://db.example.test', tabId: 7 });

    expect(controller.current()).toEqual({ kind: 'ERROR',
      message: 'Ada rejected the moderator approval request. Access was denied.' });
  });

  /**
   * The whole Chrome path with nothing mocked below the controller: the service worker's own
   * `createCore`, its own configuration resolution, its own master-key custody, and the real
   * scoped-reveal facade — against material that was genuinely split, encrypted and wrapped. There
   * is no "reveal is unavailable in this build" branch left for this to fall into.
   */
  it('opens a real scoped reveal through the production composition and autofills the field', async () => {
    const api = await FakeElementsApi.create({ applicationId: 'application-1', masterKeyHex: await hostDerivedMasterKey() });
    const production = productionCore(api);
    const controller = new ChromeRevealController(async () => production, storage);

    await expect(controller.fill({
      planId: 'plan-1', selector: 'prod-db.username',
      origin: 'https://db.example.test', tabId: 7,
    })).resolves.toEqual({ kind: 'DONE', message: 'Field filled. Reveal closed.' });

    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({
      target: { tabId: 7 }, args: ['username', 'alice'],
    }));
    expect(api.authorizedActions).toEqual([
      { assetId: 'login-id', fieldName: 'username', action: 'AUTOFILL_FIELD', origin: 'https://db.example.test' },
    ]);
    expect(api.closedWith).toBe('COMPLETED');
    // Plaintext is never persisted, and the recovery record is cleared with the reveal.
    expect([...values.keys()]).toEqual([]);
  });

  /**
   * The honest replacement for the old "unavailable in this build" assertion. The build can reveal;
   * what it cannot do is invent an Application key Elements never held, and it says which one.
   */
  it('asks SafeKey Mobile for a missing Application key', async () => {
    const api = await FakeElementsApi.create({ applicationId: 'application-1', masterKeyHex: await hostDerivedMasterKey() });
    const controller = new ChromeRevealController(async () => productionCore(api, { masterKeySecret: '' }), storage);

    await expect(controller.fill({
      planId: 'plan-1', selector: 'prod-db.username',
      origin: 'https://db.example.test', tabId: 7,
    })).resolves.toEqual({
      kind: 'ERROR',
      message: 'The Application key is not available from SafeKey Mobile for this account.',
    });
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('refuses a salt beside EXTERNAL custody rather than deriving a key nothing was sealed with', () => {
    expect(() => resolveConfiguration({
      ...STORED_CONFIGURATION, masterKeyCustody: 'EXTERNAL', masterKeySalt: 'b'.repeat(64),
    })).toThrow('EXTERNAL custody carries no salt.');
  });

  it('refuses injection when navigation changes the active origin during approval', async () => {
    (chrome.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 7, url: 'https://evil.example.test/phish' },
    ]);
    const controller = new ChromeRevealController(async () => asCore(core()), storage);
    await expect(controller.fill({
      planId: 'plan-1', selector: 'prod-db.username',
      origin: 'https://db.example.test', tabId: 7,
    })).resolves.toEqual({
      kind: 'ERROR', message: 'The page changed before autofill. Reveal again on the current page.',
    });
    expect(executeScript).not.toHaveBeenCalled();
  });
});
