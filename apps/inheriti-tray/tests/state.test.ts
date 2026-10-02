import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ begin: vi.fn(), clear: vi.fn(), keyClear: vi.fn(), complete: vi.fn(), token: vi.fn(), organizations: vi.fn(), context: vi.fn(), create: vi.fn(), teams: vi.fn(), abandon: vi.fn(), acquireKey: vi.fn(), operations: vi.fn(), core: vi.fn(), editOperations: vi.fn() }));

vi.mock('../src/modules/launcher/main/protected-checkpoint.js', () => ({ ProtectedCheckpoint: class {
  isAvailable() { return true; }
  getItem() { return null; }
  setItem() {}
  removeItem() {}
} }));

vi.mock('@safetech/inheriti-elements-core/node', () => ({
  BUSINESS_DEPLOYMENTS: {
    local: { apiUrl: 'http://business.localhost:3400/integrations/', issuer: 'https://default-issuer.test/', environment: 'TEST' },
    dev: { apiUrl: 'https://example.test/', issuer: 'https://issuer.test/', environment: 'TEST' },
    stg: { apiUrl: 'https://stg.example.test/', issuer: 'https://stg.issuer.test/', environment: 'TEST' },
    prod: { apiUrl: 'https://prod.example.test/', issuer: 'https://prod.issuer.test/', environment: 'LIVE' },
  },
  BUSINESS_INTERACTIVE_CLIENT_ID: 'interactive',
  businessUiRpId: () => undefined,
  createNodeIntegrationCore: mock.core,
  createOrganizationKeys: () => ({ resolve: mock.acquireKey, clear: mock.keyClear }),
  createNodeInbox: () => ({ listParticipants: vi.fn(), createConversation: vi.fn(), listConversations: vi.fn(), listMessages: vi.fn(), sendText: vi.fn(), openText: vi.fn() }),
  quickPlanAssetCatalog: [{ id: 'PLAIN-TEXT', category: 'GENERAL-DATA', fields: ['text'] }],
  createQuickPlanOperations: mock.operations,
  createPlanEditOperations: mock.editOperations,
  createNodePlanEventListener: () => ({ listener: {}, close: vi.fn() }),
}));

import { TraySession } from '../src/modules/launcher/main/state.js';
import { TrayPlanEdit } from '../src/modules/quick-plan/main/plan-edit.js';
import { TrayInboxIdentity } from '../src/modules/inbox/main/identity.js';

const asset = (text: string) => ({ type: 'PLAIN-TEXT' as const, meta: { name: 'Note' }, secret: { text } });

describe('TraySession', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mock.core.mockImplementation(() => ({ auth: { beginAuthorizationCode: mock.begin, clear: mock.clear, completeAuthorizationCode: mock.complete, getAccessToken: mock.token }, listOrganizations: mock.organizations }));
    mock.organizations.mockResolvedValue([]);
    mock.teams.mockResolvedValue({ teams: [] });
    mock.acquireKey.mockResolvedValue('a'.repeat(64));
    mock.operations.mockReturnValue({ createContext: mock.context, create: mock.create, teams: mock.teams, abandon: mock.abandon, acquireKey: mock.acquireKey });
    mock.editOperations.mockReturnValue({ list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }) });
  });

  it.each(['local', 'dev', 'stg', 'prod'] as const)('requests only identity scopes for %s Business sign-in', (deployment) => {
    new TraySession(deployment);
    expect(mock.core).toHaveBeenCalledWith(expect.objectContaining({
      business: true,
      configuration: expect.objectContaining({ scopes: ['openid', 'profile'] }),
    }));
  });

  it.each(['dev', 'prod'] as const)('uses the bound callback URI throughout %s sign-in', async (deployment) => {
    const session = new TraySession(deployment);
    const configuration = mock.core.mock.calls[0]![0].configuration;
    let redirectUri = '';
    mock.begin.mockImplementation(async () => {
      redirectUri = configuration.redirectUri;
      return { authorizationUrl: `https://issuer.test/authorize?redirect_uri=${encodeURIComponent(redirectUri)}` };
    });
    mock.complete.mockResolvedValue({});
    await session.signIn(() => {}, async (authorizationUrl) => {
      expect(new URL(authorizationUrl).searchParams.get('redirect_uri')).toBe(redirectUri);
      expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:[1-9]\d*\/oauth\/callback$/);
      await fetch(`${redirectUri}?code=code&state=state`);
    });
    expect(mock.core).toHaveBeenCalledTimes(1);
    expect(configuration.redirectUri).toBe(redirectUri);
    expect(mock.complete).toHaveBeenCalledWith(`${redirectUri}?code=code&state=state`);
    expect(session.state().status).toBe('signed-in');
  });

  it('uses local API and issuer overrides across core, creation, and edit', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-1', name: 'One' }]);
    const apiUrl = 'http://localhost:3000/integrations/';
    const issuer = 'https://keycloak.example.test/realms/test';
    const session = new TraySession('local', { apiUrl, issuer });
    await session.restore();
    await session.loadEditablePlans(() => {});
    expect(mock.core).toHaveBeenCalledWith(expect.objectContaining({ apiUrl, configuration: expect.objectContaining({ issuer }) }));
    expect(mock.operations).toHaveBeenCalledWith(expect.objectContaining({ apiUrl }));
    expect(mock.editOperations).toHaveBeenCalledWith(expect.objectContaining({ apiUrl }));
    new TraySession('dev', { apiUrl, issuer });
    expect(mock.core).toHaveBeenLastCalledWith(expect.objectContaining({ apiUrl: 'https://example.test/', configuration: expect.objectContaining({ issuer: 'https://issuer.test/' }) }));
  });

  it('waits for a canceled sign-in before clearing shared credentials', async () => {
    let release!: (value: { authorizationUrl: string }) => void;
    mock.begin.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    mock.clear.mockResolvedValue(undefined);
    const session = new TraySession('dev');
    const openBrowser = vi.fn().mockResolvedValue(undefined);
    const signingIn = session.signIn(() => {}, openBrowser);
    await vi.waitFor(() => expect(mock.begin).toHaveBeenCalledTimes(1));
    const signingOut = session.signOut();
    expect(mock.clear).not.toHaveBeenCalled();
    release({ authorizationUrl: 'https://issuer.test/authorize' });
    await signingIn;
    await signingOut;
    expect(openBrowser).not.toHaveBeenCalled();
    expect(mock.complete).not.toHaveBeenCalled();
    expect(mock.clear).toHaveBeenCalledTimes(1);
    expect(session.state().status).toBe('signed-out');
  });

  it('drains canceled authorization before changing the callback URI on retry', async () => {
    let release!: (value: { authorizationUrl: string }) => void;
    mock.begin.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }))
      .mockRejectedValueOnce(new Error('retry_failed'));
    const session = new TraySession('dev');
    const configuration = mock.core.mock.calls[0]![0].configuration;
    const openBrowser = vi.fn().mockResolvedValue(undefined);
    const first = session.signIn(() => {}, openBrowser);
    await vi.waitFor(() => expect(mock.begin).toHaveBeenCalledTimes(1));
    const firstUri = configuration.redirectUri;
    await session.signOut();
    await first;
    const retry = session.signIn(() => {}, openBrowser);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(configuration.redirectUri).toBe(firstUri);
    expect(mock.begin).toHaveBeenCalledTimes(1);
    release({ authorizationUrl: 'https://issuer.test/authorize' });
    await retry;
    expect(mock.begin).toHaveBeenCalledTimes(2);
    expect(configuration.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:[1-9]\d*\/oauth\/callback$/);
    expect(openBrowser).not.toHaveBeenCalled();
    expect(session.state()).toMatchObject({ status: 'error', message: 'retry_failed' });
  });

  it('rejects an organization absent from discovery', async () => {
    const session = new TraySession('dev');
    await expect(session.select('unlisted')).rejects.toThrow('organization_access_denied');
    expect(session.state().selectedId).toBeUndefined();
  });

  it('discovers authorized organizations and recovers an expired session as signed out', async () => {
    mock.token.mockResolvedValueOnce('access-token').mockRejectedValueOnce(new Error('expired'));
    mock.organizations.mockResolvedValueOnce([{ id: 'org-1', name: 'One' }]);
    const session = new TraySession('dev');
    await session.restore();
    expect(session.state()).toMatchObject({ status: 'signed-in', selectedId: 'org-1' });
    await session.restore();
    expect(session.state().status).toBe('signed-out');
    expect(session.state().organizations).toEqual([]);
  });

  it('retains the server plan ID for a retry and uses a new one after Ready', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-1', name: 'One' }]);
    mock.context.mockResolvedValueOnce({ planId: 'plan-1' }).mockResolvedValueOnce({ planId: 'plan-2' });
    mock.create.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ status: 'READY', planId: 'plan-1' }).mockResolvedValueOnce({ status: 'READY', planId: 'plan-2' });
    const session = new TraySession('dev');
    await session.restore();
    await session.createQuickPlan({ title: 'First', asset: asset('secret') }, () => {});
    expect(session.state().creation).toMatchObject({ status: 'error', planId: 'plan-1' });
    await expect(session.createQuickPlan({ title: 'Changed', asset: asset('secret') }, () => {})).rejects.toThrow('Restore the original details');
    await session.createQuickPlan({ title: 'First', asset: asset('secret') }, () => {});
    expect(session.state().creation).toMatchObject({ status: 'ready', planId: 'plan-1' });
    await session.createQuickPlan({ title: 'Second', asset: asset('other') }, () => {});
    expect(session.state().creation).toMatchObject({ status: 'ready', planId: 'plan-2' });
    expect(mock.context).toHaveBeenCalledTimes(2);
    expect(mock.create.mock.calls.map(([input]) => input.context.planId)).toEqual(['plan-1', 'plan-1', 'plan-2']);
    expect(mock.operations).toHaveBeenCalledTimes(1);
  });

  it('waits for the Organisation Key before creating a plan and can cancel the wait', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-1', name: 'One' }]);
    mock.context.mockResolvedValue({ planId: 'plan-1' });
    mock.create.mockResolvedValue({ status: 'READY', planId: 'plan-1' });
    mock.acquireKey.mockImplementationOnce((signal: AbortSignal, onRelaySession: () => void) => {
      onRelaySession();
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    });
    const session = new TraySession('dev');
    await session.restore();
    const input = { title: 'First', asset: asset('secret') };
    const pending = session.createQuickPlan(input, () => {});
    await vi.waitFor(() => expect(session.state().creation?.status).toBe('awaiting-key'));
    expect(mock.context).not.toHaveBeenCalled();
    expect(mock.create).not.toHaveBeenCalled();
    session.cancelKeyRequest();
    await pending;
    expect(session.state().creation).toBeUndefined();
    await session.createQuickPlan(input, () => {});
    expect(session.state().creation).toMatchObject({ status: 'ready', planId: 'plan-1' });
  });

  it('clears a completed creation on lock while preserving an uncertain retry', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-1', name: 'One' }]);
    mock.context.mockResolvedValueOnce({ planId: 'plan-1' }).mockResolvedValueOnce({ planId: 'plan-2' });
    mock.create.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ status: 'READY', planId: 'plan-1' });
    const session = new TraySession('dev');
    await session.restore();
    const input = { title: 'Secret', asset: asset('secret') };
    await session.createQuickPlan(input, () => {});
    session.clearOnLock();
    expect(session.state().creation).toMatchObject({ status: 'error', planId: 'plan-1' });
    await session.createQuickPlan(input, () => {});
    session.clearOnLock();
    expect(session.state().creation).toBeUndefined();
    expect(mock.context).toHaveBeenCalledTimes(1);
  });

  it('clears a creation that becomes ready after lock', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-1', name: 'One' }]);
    mock.context.mockResolvedValue({ planId: 'plan-1' });
    let release!: (result: { status: string; planId: string }) => void;
    mock.create.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const session = new TraySession('dev');
    await session.restore();
    const pending = session.createQuickPlan({ title: 'Secret', asset: asset('secret') }, () => {});
    await vi.waitFor(() => expect(mock.create).toHaveBeenCalledTimes(1));
    session.clearOnLock();
    release({ status: 'READY', planId: 'plan-1' });
    await pending;
    expect(session.state().creation).toBeUndefined();
  });

  it('retains an uncertain creation that fails after lock', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-1', name: 'One' }]);
    mock.context.mockResolvedValue({ planId: 'plan-1' });
    let reject!: (error: Error) => void;
    mock.create.mockReturnValueOnce(new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
    const session = new TraySession('dev');
    await session.restore();
    const input = { title: 'Secret', asset: asset('secret') };
    const pending = session.createQuickPlan(input, () => {});
    await vi.waitFor(() => expect(mock.create).toHaveBeenCalledTimes(1));
    session.clearOnLock();
    reject(new Error('network'));
    await pending;
    expect(session.state().creation).toMatchObject({ status: 'error', planId: 'plan-1' });
    mock.create.mockResolvedValueOnce({ status: 'READY', planId: 'plan-1' });
    await session.createQuickPlan(input, () => {});
    expect(mock.context).toHaveBeenCalledTimes(1);
  });

  it('abandoning a failed creation lets a corrected entry use a new server plan ID', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-1', name: 'One' }]);
    mock.context.mockResolvedValueOnce({ planId: 'plan-1' }).mockResolvedValueOnce({ planId: 'plan-2' });
    mock.create.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ status: 'READY', planId: 'plan-2' });
    const session = new TraySession('dev');
    await session.restore();
    await session.createQuickPlan({ title: 'Original', asset: asset('old') }, () => {});
    expect(session.state().creation).toMatchObject({ status: 'error', planId: 'plan-1' });
    session.abandonCreation();
    expect(session.state().creation).toBeUndefined();
    expect(mock.abandon).toHaveBeenCalledWith('plan-1');
    await session.createQuickPlan({ title: 'Corrected', asset: asset('new') }, () => {});
    expect(session.state().creation).toMatchObject({ status: 'ready', planId: 'plan-2' });
    expect(mock.create.mock.calls.map(([input]) => input.context.planId)).toEqual(['plan-1', 'plan-2']);
  });

  it('does not abandon an in-flight creation', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-1', name: 'One' }]);
    let release!: (value: { planId: string }) => void;
    mock.context.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    mock.create.mockResolvedValueOnce({ status: 'READY', planId: 'plan-1' });
    const session = new TraySession('dev');
    await session.restore();
    const pending = session.createQuickPlan({ title: 'First', asset: asset('secret') }, () => {});
    expect(() => session.abandonCreation()).toThrow('creation_in_progress');
    release({ planId: 'plan-1' });
    await pending;
    expect(session.state().creation).toMatchObject({ status: 'ready', planId: 'plan-1' });
  });

  it('loads authorized teams and passes the selected team to the creator', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-1', name: 'One' }]);
    mock.teams.mockResolvedValue({ teams: [{ id: 'team-1', name: 'One team' }] });
    mock.context.mockResolvedValue({ planId: 'plan-1' });
    mock.create.mockResolvedValue({ status: 'READY', planId: 'plan-1' });
    const session = new TraySession('dev');
    await session.restore();
    expect(session.state().teams).toEqual([{ id: 'team-1', name: 'One team' }]);
    await expect(session.createQuickPlan({ title: 'Shared', teamId: 'unknown', asset: asset('secret') }, () => {})).rejects.toThrow('selected team');
    await session.createQuickPlan({ title: 'Shared', teamId: 'team-1', asset: asset('secret') }, () => {});
    expect(mock.create).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'team-1', context: { planId: 'plan-1' } }), expect.any(Function));
    expect(session.state().creation).toMatchObject({ status: 'ready', teamId: 'team-1' });
  });

  it('keeps quick-plan creation on the current organization when edit rejects a switch', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-a', name: 'A' }, { id: 'org-b', name: 'B' }]);
    mock.context.mockResolvedValue({ planId: 'plan-1' });
    mock.create.mockResolvedValue({ status: 'READY', planId: 'plan-1' });
    const session = new TraySession('dev');
    await session.restore();
    await session.select('org-a');
    vi.spyOn(TrayPlanEdit.prototype, 'selectOrganization').mockRejectedValueOnce(new Error('edit_recovery_required'));

    await expect(session.select('org-b')).rejects.toThrow('edit_recovery_required');
    expect(session.state().selectedId).toBe('org-a');
    await session.createQuickPlan({ title: 'Secret', asset: asset('secret') }, () => {});
    expect(mock.operations).toHaveBeenCalledTimes(1);
    expect(mock.operations).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-a' }));
  });

  it('clears organization keys and Inbox identity before a rejected organization switch', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-a', name: 'A' }, { id: 'org-b', name: 'B' }]);
    const session = new TraySession('dev');
    await session.restore();
    await session.select('org-a');
    mock.keyClear.mockClear();
    const clearIdentity = vi.spyOn(TrayInboxIdentity.prototype, 'clear');
    vi.spyOn(TrayPlanEdit.prototype, 'selectOrganization').mockImplementationOnce(async () => {
      expect(mock.keyClear).toHaveBeenCalledTimes(1);
      expect(clearIdentity).toHaveBeenCalledTimes(1);
      throw new Error('edit_recovery_required');
    });

    await expect(session.select('org-b')).rejects.toThrow('edit_recovery_required');
    expect(session.state().selectedId).toBe('org-a');
    await session.select('org-b');
    expect(session.state().selectedId).toBe('org-b');
    expect(mock.keyClear).toHaveBeenCalledTimes(2);
    clearIdentity.mockRestore();
  });

  it('keeps plan edit on the current organization when creation blocks a switch', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-a', name: 'A' }, { id: 'org-b', name: 'B' }]);
    mock.context.mockResolvedValue({ planId: 'plan-1' });
    mock.create.mockRejectedValue(new Error('network'));
    const session = new TraySession('dev');
    await session.restore();
    await session.select('org-a');
    await session.createQuickPlan({ title: 'Secret', asset: asset('secret') }, () => {});
    const selectEdit = vi.spyOn(TrayPlanEdit.prototype, 'selectOrganization');

    await expect(session.select('org-b')).rejects.toThrow('creation_abandon_required');
    expect(session.state().selectedId).toBe('org-a');
    expect(selectEdit).not.toHaveBeenCalled();
    selectEdit.mockRestore();
  });

  it('rejects a selection while another is loading and allows retry afterward', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-a', name: 'A' }, { id: 'org-b', name: 'B' }]);
    let releaseA!: (value: { teams: { id: string; name: string }[] }) => void;
    mock.teams.mockReturnValueOnce(new Promise((resolve) => { releaseA = resolve; }))
      .mockResolvedValueOnce({ teams: [{ id: 'team-b', name: 'B team' }] });
    const session = new TraySession('dev');
    await session.restore();
    const selectingA = session.select('org-a');
    await vi.waitFor(() => expect(mock.teams).toHaveBeenCalledTimes(1));
    await expect(session.select('org-b')).rejects.toThrow('organization_selection_in_progress');
    expect(session.state().selectedId).toBeUndefined();
    expect(() => session.createQuickPlan({ title: 'Secret', asset: asset('secret') }, () => {})).toThrow('organization_selection_in_progress');
    releaseA({ teams: [{ id: 'team-a', name: 'A team' }] });
    await selectingA;
    expect(session.state()).toMatchObject({ selectedId: 'org-a', teams: [{ id: 'team-a', name: 'A team' }] });
    await session.select('org-b');
    expect(session.state()).toMatchObject({ selectedId: 'org-b', teams: [{ id: 'team-b', name: 'B team' }] });
    expect(mock.teams).toHaveBeenCalledTimes(2);
  });
});
