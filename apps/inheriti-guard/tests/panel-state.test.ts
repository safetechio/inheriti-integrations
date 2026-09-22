import { describe, expect, it, vi } from 'vitest';
import { codeOf, messageFor, rowsFor } from '../src/shared/plan-view.js';
import { ChromeConfigurationInvalid, resolveConfiguration } from '../src/shared/configuration.js';

const stored = {
  apiUrl: 'http://127.0.0.1:3201',
  issuer: 'http://127.0.0.1:4564/realms/elements',
  clientId: 'elements-test-chrome',
  applicationId: 'application-1',
  // The Application's own Argon2 salt, which `DERIVED` custody cannot resolve a key without.
  masterKeySalt: 'b'.repeat(64),
};

describe('panel state', () => {
  it('renders signed out, signing in, loading, empty and error as distinct rows', () => {
    const labels = (['SIGNED_OUT', 'SIGNING_IN', 'LOADING', 'EMPTY'] as const)
      .map((kind) => rowsFor({ kind })[0]?.label)
      .concat(rowsFor({ kind: 'ERROR', code: 'elements_api_unavailable' })[0]?.label);
    expect(new Set(labels).size).toBe(5);
    expect(rowsFor({ kind: 'EMPTY', reason: 'no-autofill-plans' })[0]?.label).toBe('No plans support autofill');
  });

  it('gives a placeholder row no plan id, so it cannot be opened as a plan', () => {
    expect(rowsFor({ kind: 'SIGNED_OUT' })[0]?.planId).toBeUndefined();
  });

  it('renders one row per plan, carrying its id', () => {
    const plans = [{ id: 'plan-1', name: 'Vault', status: 'ACTIVE' }];
    expect(rowsFor({ kind: 'PLANS', plans })[0]).toEqual({ label: 'Vault', detail: 'ACTIVE', avatarId: 'plan-1', planId: 'plan-1', draft: false });
  });

  it('does not offer Draft plans for access', () => {
    expect(rowsFor({ kind: 'PLANS', plans: [{ id: 'draft-1', name: 'Unfinished', status: 'DRAFT' }] })[0]).toEqual({
      label: 'Unfinished', detail: 'DRAFT', avatarId: 'draft-1', draft: true,
    });
  });

  it('never shows a runtime error code to an operator', () => {
    expect(codeOf(Object.assign(new Error('x'), { code: 'ERR_INVALID_URL' }))).toBe('plan_request_failed');
    expect(codeOf(new Error('OAuth failed'), 'sign_in_failed')).toBe('sign_in_failed');
    expect(codeOf({ status: 401, code: 'Unauthorized' })).toBe('plan_access_denied');
    expect(codeOf({ status: 503 })).toBe('elements_api_unavailable');
    expect(messageFor('plan_access_denied')).toBe('Could not verify plan access — sign in again');
    expect(codeOf(Object.assign(new Error('x'), { code: 'plan_not_found' }))).toBe('plan_not_found');
    expect(messageFor('sign_in_failed')).toBe('Could not sign in');
    expect(messageFor('ERR_INVALID_URL')).toBe('Something went wrong');
  });
});

describe('chrome configuration', () => {
  it('uses Business without a fabricated Application or standalone key custody', () => {
    const configuration = resolveConfiguration({ ...stored, applicationId: '', masterKeySalt: '' });
    expect(configuration.applicationId).toBeUndefined();
    expect(configuration.masterKeySecret).toBeUndefined();
    expect(configuration.scopes).toEqual(['openid']);
  });

  it('defaults to TEST and asks for the Chrome reveal/autofill contract', () => {
    const configuration = resolveConfiguration(stored);
    expect(configuration.environment).toBe('TEST');
    expect(configuration.scopes).toEqual(['openid', 'plan:list', 'plan:read', 'plan:reveal', 'asset:autofill']);
    expect(configuration.masterKeyCustody).toBe('DERIVED');
  });

  /**
   * A build with no secret still reads plans; it just cannot open one. That is a configuration
   * state the operator can fix, so it must not look like a missing capability at startup.
   */
  it('resolves without the operator secret, which only a reveal needs', () => {
    expect(resolveConfiguration(stored).masterKeySecret).toBeUndefined();
  });

  it('refuses LIVE in a development build', () => {
    expect(() => resolveConfiguration({ ...stored, environment: 'LIVE' })).toThrow(ChromeConfigurationInvalid);
  });

  it('requires every endpoint rather than guessing one', () => {
    for (const missing of ['apiUrl', 'issuer', 'clientId']) {
      expect(() => resolveConfiguration({ ...stored, [missing]: '' })).toThrow(ChromeConfigurationInvalid);
    }
  });
});

describe('loadPlans', () => {
  const coreWith = (overrides: Record<string, unknown>) => ({
    getAccessToken: async () => 'token',
    listPlans: async () => ({ items: [], nextCursor: null }),
    ...overrides,
  }) as never;

  it('is signed out with no token, before any request', async () => {
    const { loadPlans } = await import('../src/background/plans.js');
    await expect(loadPlans(coreWith({ getAccessToken: async () => undefined })))
      .resolves.toEqual({ kind: 'SIGNED_OUT' });
  });

  it('is empty, not an error, when the Application has no plans', async () => {
    const { loadPlans } = await import('../src/background/plans.js');
    await expect(loadPlans(coreWith({}))).resolves.toEqual({ kind: 'EMPTY', reason: 'no-autofill-plans' });
  });

  it('renders real plans, flattening a status the SDK did not recognise', async () => {
    const { loadPlans } = await import('../src/background/plans.js');
    const listPlans = vi.fn(async () => ({ items, nextCursor: null }));
    const items = [
      { id: 'plan-1', name: 'Vault', status: 'ACTIVE' },
      { id: 'plan-2', name: 'Backup', status: { kind: 'UNKNOWN', raw: 'SUSPENDED' } },
    ];
    await expect(loadPlans(coreWith({ listPlans }))).resolves.toEqual({
      kind: 'PLANS',
      plans: [{ id: 'plan-1', name: 'Vault', status: 'ACTIVE' }, { id: 'plan-2', name: 'Backup', status: 'SUSPENDED' }],
    });
    expect(listPlans).toHaveBeenCalledWith({ assetType: 'USER-PSWD' });
  });

  it('maps a failure to a stable code instead of throwing into the panel', async () => {
    const { loadPlans } = await import('../src/background/plans.js');
    const failing = coreWith({ listPlans: async () => { throw Object.assign(new Error('x'), { code: 'plan_not_found' }); } });
    await expect(loadPlans(failing)).resolves.toEqual({ kind: 'ERROR', code: 'plan_not_found' });
  });
});

describe('loadPlanAssets', () => {
  it('projects metadata without protected values and preserves unknown asset types', async () => {
    const { loadPlanAssets } = await import('../src/background/plans.js');
    const core = {
      getPlan: async () => ({
        assets: [
          { id: 'login-1', name: 'Production login', type: 'USER-PSWD', isBinary: false, fieldNames: ['username', 'password'] },
          { id: 'file-1', name: 'Runbook', type: { kind: 'UNKNOWN', raw: 'RUNBOOK' }, isBinary: true, fieldNames: [], fileName: 'runbook.pdf', mimeType: 'application/pdf', size: 2048 },
        ],
      }),
    } as never;

    await expect(loadPlanAssets(core, 'plan-1')).resolves.toEqual([
      { id: 'login-1', name: 'Production login', type: 'USER-PSWD', isBinary: false, fieldNames: ['username', 'password'] },
      { id: 'file-1', name: 'Runbook', type: 'RUNBOOK', isBinary: true, fieldNames: [], fileName: 'runbook.pdf', mimeType: 'application/pdf', size: 2048 },
    ]);
  });
});
