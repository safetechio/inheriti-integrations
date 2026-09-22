import { describe, expect, it } from 'vitest';
import { FakeElementsApi } from '@safetech/inheriti-elements-test-kit';
import { createBrowserIntegrationCore } from '../src/browser.js';
import { stoppedByDeadManSwitch } from '../src/index.js';
import type { MasterKeyRef, MasterKeyResolver } from '../src/index.js';

const APPLICATION_ID = 'application-1';
const MASTER_KEY = 'a'.repeat(64);

function resolverFor(keyHex: string | undefined): MasterKeyResolver {
  return {
    resolve: async (ref: MasterKeyRef) =>
      ref.system === 'INHERITI_ELEMENTS' && ref.contextId === APPLICATION_ID ? keyHex : undefined,
  };
}

function browserCore(
  api: FakeElementsApi,
  masterKeys: MasterKeyResolver,
  fetchImpl: typeof fetch = api.fetch,
): ReturnType<typeof createBrowserIntegrationCore> {
  return createBrowserIntegrationCore({
    apiUrl: 'https://elements.example.test',
    environment: 'TEST',
    applicationId: APPLICATION_ID,
    masterKeys,
    configuration: {
      issuer: 'https://issuer.example.test',
      clientId: 'chrome-host',
      audience: 'inheriti-elements-api',
      environment: 'TEST',
      redirectUri: 'https://host.chromiumapp.org/',
      scopes: ['openid'],
    },
    fetchImpl,
  });
}

describe('browser integration core composition', () => {
  it('never sends ambient browser cookies through the bearer API transport', async () => {
    const api = await FakeElementsApi.create({ applicationId: APPLICATION_ID, masterKeyHex: MASTER_KEY });
    const credentials: (RequestCredentials | undefined)[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      credentials.push(init?.credentials);
      return api.fetch(input, init);
    };

    await browserCore(api, resolverFor(MASTER_KEY), fetchImpl).getPlan('plan-1');

    expect(credentials).toEqual(['omit']);
  });

  /**
   * The real factory with no injected facade — the shape a Chrome build actually gets — against
   * material that was genuinely split, encrypted and wrapped. This is the test the composition gap
   * used to fail: it previously asserted `withReveal` throws `scoped_reveal_facade_required`.
   */
  it('performs a real scoped reveal: start, wait, release, reconstruct, field access, close', async () => {
    const api = await FakeElementsApi.create({ applicationId: APPLICATION_ID, masterKeyHex: MASTER_KEY });
    const stages: string[] = [];

    const value = await browserCore(api, resolverFor(MASTER_KEY)).withReveal(
      'plan-1',
      { mode: 'DIRECT', onSession: (session) => { stages.push(session.stage); } },
      async (reveal) => {
        expect(reveal.session.id).toBe('reveal-1');
        return reveal.field<string>('prod-db.username', { action: 'AUTOFILL_FIELD', origin: 'https://db.example.test' });
      },
    );

    expect(value).toBe('alice');
    expect(stages).toEqual(['AUTHORIZED']);
    expect(api.reconstructionReported).toBe('SUCCEEDED');
    expect(api.closedWith).toBe('COMPLETED');
    expect(api.authorizedActions).toEqual([
      { assetId: 'login-id', fieldName: 'username', action: 'AUTOFILL_FIELD', origin: 'https://db.example.test' },
    ]);
  });

  it('waits through the governance gates the server reports before material is released', async () => {
    const api = await FakeElementsApi.create({
      applicationId: APPLICATION_ID,
      masterKeyHex: MASTER_KEY,
      governance: 'GOVERNED',
      stagesBeforeAuthorization: [
        { stage: 'WAITING_FOR_DMS', dmsExpiresAt: '2100-01-01T00:05:00.000Z' },
        { stage: 'WAITING_FOR_PARTICIPANTS', approvedModerators: 1, requiredModerators: 2 },
      ],
    });
    const seen: { stage: string; dmsExpiresAt?: string }[] = [];

    const value = await browserCore(api, resolverFor(MASTER_KEY)).withReveal(
      'plan-1',
      { mode: 'GOVERNED', pollIntervalMs: 0, onSession: (session) => { seen.push({ stage: session.stage, ...(session.dmsExpiresAt === undefined ? {} : { dmsExpiresAt: session.dmsExpiresAt }) }); } },
      async (reveal) => reveal.field<string>('prod-db.password'),
    );

    expect(value).toBe('correct-horse');
    // A governed reveal tells the server it holds the shares; a direct one has no merge process to
    // tell. The Chrome host gets that for free by going through the same scoped reveal.
    expect(api.sharesCollected).toBe(true);
    expect(seen).toEqual([
      { stage: 'WAITING_FOR_DMS', dmsExpiresAt: '2100-01-01T00:05:00.000Z' },
      { stage: 'WAITING_FOR_PARTICIPANTS' },
      { stage: 'AUTHORIZED' },
    ]);
  });

  /**
   * Elements never holds the Application key, so a host that cannot produce one must fail by name
   * rather than look like a build without a reveal.
   *
   * Nothing is started, let alone released: the key is resolved before the reveal exists, so a plan
   * that cannot be opened costs no governance approval and no one-shot custodian release. There is
   * consequently no session to close — asserting a close here would be asserting that the ordering
   * is wrong.
   */
  it('names the master key it is missing, and releases no material without it', async () => {
    const api = await FakeElementsApi.create({ applicationId: APPLICATION_ID, masterKeyHex: MASTER_KEY });

    await expect(browserCore(api, resolverFor(undefined))
      .withReveal('plan-1', {}, async () => undefined))
      .rejects.toMatchObject({ name: 'MasterKeyRequired' });

    expect(api.calls.some((call) => call.path.endsWith('/reveals') && call.method === 'POST')).toBe(false);
    expect(api.calls.some((call) => call.path.endsWith('/material') && call.method === 'POST')).toBe(false);
    expect(api.closedWith).toBeUndefined();
  });

  it('composes the plan and workflow ports beside the reveal facade', () => {
    const core = browserCore(
      // Composition only; nothing is called, so the fetch never runs.
      { fetch: async () => new Response('{}') } as unknown as FakeElementsApi,
      resolverFor(MASTER_KEY),
    );
    expect(core.environment).toBe('TEST');
    expect(core.reveals).toBeDefined();
    expect(core.interactions).toBeDefined();
  });
});

describe('dead man\'s switch reset', () => {
  it('is read from the server-owned close reason, never inferred from a bare cancellation', () => {
    expect(stoppedByDeadManSwitch({ stage: 'CANCELED', closedReason: 'DMS_RESET' })).toBe(true);
    expect(stoppedByDeadManSwitch({ stage: 'CANCELED' })).toBe(false);
    expect(stoppedByDeadManSwitch({ stage: 'CANCELED', closedReason: 'CANCELED' })).toBe(false);
    expect(stoppedByDeadManSwitch(undefined)).toBe(false);
  });
});
