import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ begin: vi.fn(), clear: vi.fn(), keyClear: vi.fn(), complete: vi.fn(), token: vi.fn(), organizations: vi.fn(), context: vi.fn(), create: vi.fn(), teams: vi.fn(), abandon: vi.fn(), acquireKey: vi.fn(), operations: vi.fn(), core: vi.fn(), editOperations: vi.fn(), openInbox: vi.fn(), ackInbox: vi.fn(), changeParticipants: vi.fn(), listenInbox: vi.fn(), stopInbox: vi.fn(), checkpoint: new Map<string, unknown>() }));

vi.mock('../src/modules/launcher/main/protected-checkpoint.js', () => ({ ProtectedCheckpoint: class {
  isAvailable() { return true; }
  getItem(path: string) { return mock.checkpoint.get(path) ?? null; }
  setItem(path: string, value: unknown) { mock.checkpoint.set(path, value); }
  removeItem(path: string) { mock.checkpoint.delete(path); }
  clean(root: string) { for (const path of mock.checkpoint.keys()) if (path.startsWith(root)) mock.checkpoint.delete(path); }
  cleanMany(roots: string[]) { for (const path of mock.checkpoint.keys()) if (roots.some((root) => path.startsWith(root))) mock.checkpoint.delete(path); }
  hasFile() { return true; }
  multiRemove(_root: string, paths: string[]) { for (const path of paths) mock.checkpoint.delete(path); }
  searchItems(root: string, predicate: (value: unknown) => boolean) {
    return [...mock.checkpoint.entries()].filter(([path, value]) => path.includes(root) && predicate(value)).map(([, value]) => value);
  }
} }));

vi.mock('@safetech/inheriti-elements-core/node', () => ({
  INTEGRATION_AUTHORITY: 'business',
  BUSINESS_DEPLOYMENTS: {
    local: { apiUrl: 'http://business.localhost:3400/integrations/', issuer: 'https://default-issuer.test/', environment: 'TEST' },
    dev: { apiUrl: 'https://example.test/', issuer: 'https://issuer.test/', environment: 'TEST' },
    stg: { apiUrl: 'https://stg.example.test/', issuer: 'https://stg.issuer.test/', environment: 'TEST' },
    prod: { apiUrl: 'https://prod.example.test/', issuer: 'https://prod.issuer.test/', environment: 'LIVE' },
  },
  PROTECTED_FILE_FLAGS: { local: false, dev: false, stg: false, prod: false },
  HOST_FEATURE_FLAGS: { local: { planCreation: true, automation: false }, dev: { planCreation: true, automation: false }, stg: { planCreation: true, automation: false }, prod: { planCreation: true, automation: false } },
  BUSINESS_INTERACTIVE_CLIENT_ID: 'interactive',
  MemoryOperatorSessionStore: class {
    private session: unknown;
    async load() { return this.session; }
    async save(session: unknown) { this.session = session; }
    async clear() { this.session = undefined; }
  },
  businessUiRpId: () => undefined,
  createNodeIntegrationCore: mock.core,
  createOrganizationKeys: () => ({ resolve: mock.acquireKey, clear: mock.keyClear, forget: mock.keyClear }),
  createNodeInboxEventListener: (...args: unknown[]) => { mock.listenInbox(...args); return mock.stopInbox; },
  suggestInboxTextAsset: (text: string) => ({ title: 'Saved message', assetType: 'PLAIN-TEXT', assetName: 'Saved message', fields: { text } }),
  quickPlanAssetCatalog: [{ id: 'PLAIN-TEXT', category: 'GENERAL-DATA', fields: ['text'] }],
  createQuickPlanOperations: mock.operations,
  createPlanEditOperations: mock.editOperations,
  createNodePlanEventListener: () => ({ listener: {}, close: vi.fn() }),
}));

vi.mock('@safetech/inheriti-elements-core/inbox', () => ({
  createNodeInbox: () => ({ listParticipants: vi.fn(), createConversation: vi.fn(), changeParticipants: mock.changeParticipants, listConversations: vi.fn(), listMessages: vi.fn(), sendText: vi.fn(), openText: mock.openInbox, ackText: mock.ackInbox }),
}));

import { TraySession } from '../src/modules/launcher/main/state.js';
import { ProtectedCheckpoint } from '../src/modules/launcher/main/protected-checkpoint.js';
import { TrayPlanEdit } from '../src/modules/quick-plan/main/plan-edit.js';
import { TrayQuickPlans } from '../src/modules/quick-plan/main/quick-plans.js';
import { TrayInboxIdentity } from '../src/modules/inbox/main/identity.js';
import { TrayInbox } from '../src/modules/inbox/main/inbox.js';

const asset = (text: string) => ({ type: 'PLAIN-TEXT' as const, meta: { name: 'Note' }, secret: { text } });
const scopedPrincipal = (issuer: string, subject: string, environment = 'TEST') => ({ issuer, subject, audience: 'inheriti-integrations-api',
  authorizedParty: 'interactive', environment });

describe('TraySession', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mock.checkpoint.clear();
    mock.core.mockImplementation(() => ({ auth: { beginAuthorizationCode: mock.begin, clear: mock.clear, completeAuthorizationCode: mock.complete, getAccessToken: mock.token }, listOrganizations: mock.organizations }));
    mock.organizations.mockResolvedValue([]);
    mock.teams.mockResolvedValue({ teams: [] });
    mock.acquireKey.mockResolvedValue('a'.repeat(64));
    mock.operations.mockReturnValue({ createContext: mock.context, create: mock.create, teams: mock.teams, abandon: mock.abandon, acquireKey: mock.acquireKey });
    mock.editOperations.mockReturnValue({ list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }) });
  });

  it('disables protected Inbox file output for every deployment', () => {
    const local = new TraySession('local');
    expect(local.inboxState().protectedFileEnabled).toBe(false);
    expect(() => local.listInboxProtectedFilePlans()).toThrow('protected_file_unavailable');
    const dev = new TraySession('dev');
    expect(dev.inboxState().protectedFileEnabled).toBe(false);
    expect(() => dev.listInboxProtectedFilePlans()).toThrow('protected_file_unavailable');
    expect(() => dev.openInboxProtectedFile({ conversationId: 'a', messageId: 'b', planId: 'c',
      copyId: 'd', envelopeId: 'e', openLimit: 1 })).toThrow('protected_file_unavailable');
  });

  it('validates Chat access on entry, caches it, and cancels it on organization switch', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-1', name: 'One' }, { id: 'org-2', name: 'Two' }]);
    const session = new TraySession('local');
    await session.restore();
    await session.select('org-1');
    expect(mock.acquireKey).not.toHaveBeenCalled();
    await session.prepareInboxAccess(1);
    await session.prepareInboxAccess(2);
    expect(mock.acquireKey).toHaveBeenCalledTimes(1);
    await session.select('org-2');
    mock.acquireKey.mockImplementationOnce((_id: string, signal: AbortSignal) => new Promise<string>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const pending = session.prepareInboxAccess(3);
    const signal = mock.acquireKey.mock.calls[1]?.[1] as AbortSignal;
    expect(signal.aborted).toBe(false);
    session.cancelInboxAccess(2);
    expect(signal.aborted).toBe(false);
    session.cancelInboxAccess(3);
    expect(signal.aborted).toBe(true);
    await expect(pending).rejects.toThrow('aborted');
  });

  it('allows read-only conversation scans only for discovered organizations', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-a', name: 'A' }, { id: 'org-b', name: 'B' }]);
    const session = new TraySession('local');
    await session.restore();
    await session.select('org-a');
    expect(() => session.listOrganizationInboxConversations('org-x')).toThrow('organization_access_denied');
    expect(mock.acquireKey).not.toHaveBeenCalled();
    mock.organizations.mockResolvedValue([{ id: 'org-a', name: 'A' }]);
    await session.refreshOrganizations();
    expect(() => session.listOrganizationInboxConversations('org-b')).toThrow('organization_access_denied');
  });

  it('keeps the inbox authentication generation stable across selection and organization refresh', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-a', name: 'A' }, { id: 'org-b', name: 'B' }]);
    const session = new TraySession('local');
    await session.restore();
    const revision = session.inboxSessionRevision();
    await session.select('org-a');
    await session.refreshOrganizations();
    await session.select('org-b');
    expect(session.inboxSessionRevision()).toBe(revision);
    await session.signOut();
    expect(session.inboxSessionRevision()).toBeGreaterThan(revision);
  });

  it('cancels pending Chat access when switching organizations or signing out', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-1', name: 'One' }, { id: 'org-2', name: 'Two' }]);
    const session = new TraySession('local');
    await session.restore();
    await session.select('org-1');
    mock.acquireKey.mockImplementation((_id: string, signal: AbortSignal) => new Promise<string>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const first = session.prepareInboxAccess(10);
    const firstCanceled = expect(first).rejects.toThrow('aborted');
    const firstSignal = mock.acquireKey.mock.calls.at(-1)?.[1] as AbortSignal;
    await session.select('org-2');
    expect(firstSignal.aborted).toBe(true);
    await firstCanceled;
    const second = session.prepareInboxAccess(11);
    const secondCanceled = expect(second).rejects.toThrow('aborted');
    const secondSignal = mock.acquireKey.mock.calls.at(-1)?.[1] as AbortSignal;
    await session.signOut();
    expect(secondSignal.aborted).toBe(true);
    await secondCanceled;
  });

  it('uses a protected operator session store scoped to its issuer', async () => {
    new TraySession('local', { apiUrl: 'http://business.localhost:3400/integrations/', issuer: 'https://local-issuer.test/' });
    const options = mock.core.mock.calls[0]?.[0];
    expect(options.sessions).toEqual(expect.objectContaining({ load: expect.any(Function), save: expect.any(Function), clear: expect.any(Function) }));
    await options.sessions.save({ kind: 'business', familyId: 'family', sessionExpiresAt: Date.now() + 120_000, accessToken: 'token', refreshToken: 'refresh-test', tokenType: 'Bearer', expiresAt: Date.now() + 1000,
      principal: scopedPrincipal('https://local-issuer.test/', 'member') });
    await expect(options.sessions.load()).resolves.toMatchObject({ accessToken: 'token' });
  });

  it('retains a pending lease for retry after hiding', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-1', name: 'One' }]);
    const session = new TraySession('local');
    await session.restore();
    const identity = { tenantId: 'org-1', memberId: 'member-1', deviceId: 'device-1',
      encryptionPublicKey: '', encryptionPrivateKey: '', signingPublicKey: '', signingPrivateKey: '' };
    vi.spyOn(TrayInboxIdentity.prototype, 'withIdentity').mockImplementation(async (_organizationId, run) =>
      run(identity, new AbortController().signal));
    mock.openInbox.mockResolvedValue({ text: 'secret', leaseId: 'lease-1',
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(), acknowledgement: 'PENDING' });
    mock.ackInbox.mockResolvedValue('ACKNOWLEDGED');
    await expect(session.openInboxText('conversation-1', 'message-1')).resolves.toMatchObject({ acknowledgement: 'PENDING' });
    await expect(session.retryInboxAck('conversation-1', 'message-1')).resolves.toEqual({ acknowledgement: 'ACKNOWLEDGED' });
    expect(mock.ackInbox).toHaveBeenCalledWith(expect.objectContaining({ leaseId: 'lease-1', deviceId: 'device-1' }));
    await expect(session.retryInboxAck('conversation-1', 'message-1')).rejects.toThrow('inbox_ack_retry_unavailable');
    await session.openInboxText('conversation-1', 'message-1');
    mock.ackInbox.mockRejectedValueOnce(new Error('inbox_identity_http_503'));
    await expect(session.retryInboxAck('conversation-1', 'message-1')).resolves.toEqual({ acknowledgement: 'PENDING' });
    await expect(session.retryInboxAck('conversation-1', 'message-1')).resolves.toEqual({ acknowledgement: 'ACKNOWLEDGED' });
    await session.openInboxText('conversation-1', 'message-1');
    mock.ackInbox.mockRejectedValueOnce(Object.assign(new Error('request_failed'), { status: 403 }));
    await expect(session.retryInboxAck('conversation-1', 'message-1')).rejects.toThrow();
    await expect(session.retryInboxAck('conversation-1', 'message-1')).rejects.toThrow('inbox_ack_retry_unavailable');
    await session.openInboxText('conversation-1', 'message-1');
    session.hideInboxText();
    await expect(session.retryInboxAck('conversation-1', 'message-1')).resolves.toEqual({ acknowledgement: 'ACKNOWLEDGED' });
  });

  it.each(['local', 'dev', 'stg', 'prod'] as const)('requests only sign-in scopes for %s Business sign-in', (deployment) => {
    new TraySession(deployment);
    expect(mock.core).toHaveBeenCalledWith(expect.objectContaining({
      business: true,
      configuration: expect.objectContaining({ scopes: ['openid', 'profile'] }),
    }));
  });

  it('does not retry an invalid-scope sign-in', async () => {
    const session = new TraySession('dev');
    await session.restore();
    const configuration = mock.core.mock.calls[0]![0].configuration;
    mock.begin.mockImplementation(async () => ({ authorizationUrl: `https://issuer.test/authorize?redirect_uri=${encodeURIComponent(configuration.redirectUri)}` }));
    mock.complete.mockResolvedValue({ kind: 'business', familyId: 'family', sessionExpiresAt: Date.now() + 120_000, accessToken: 'access-token', refreshToken: 'refresh-test', tokenType: 'Bearer', expiresAt: Date.now() + 60_000,
      principal: scopedPrincipal(configuration.issuer, 'member-a') });
    let opened = 0;
    await session.signIn(() => {}, async (authorizationUrl) => {
      const redirectUri = new URL(authorizationUrl).searchParams.get('redirect_uri')!;
      await fetch(`${redirectUri}?${++opened === 1 ? 'error=invalid_scope' : 'code=code&state=state'}`);
    });
    expect(opened).toBe(1);
    expect(mock.begin).toHaveBeenCalledTimes(1);
    expect(mock.complete).not.toHaveBeenCalled();
    expect(configuration.scopes).toEqual(['openid', 'profile']);
    expect(session.state().status).toBe('error');
  });

  it('does not retry when the operator declines authorisation', async () => {
    const session = new TraySession('dev');
    await session.restore();
    const configuration = mock.core.mock.calls[0]![0].configuration;
    mock.begin.mockImplementation(async () => ({ authorizationUrl: `https://issuer.test/authorize?redirect_uri=${encodeURIComponent(configuration.redirectUri)}` }));
    await session.signIn(() => {}, async (authorizationUrl) => {
      const redirectUri = new URL(authorizationUrl).searchParams.get('redirect_uri')!;
      await fetch(`${redirectUri}?error=access_denied`);
    });
    expect(mock.begin).toHaveBeenCalledOnce();
    expect(session.state().status).toBe('error');
  });

  it('shows the support message when tester preflight rejects sign-in', async () => {
    const session = new TraySession('dev');
    await session.restore();
    const configuration = mock.core.mock.calls[0]![0].configuration;
    mock.begin.mockImplementation(async () => ({ authorizationUrl: `https://issuer.test/authorize?redirect_uri=${encodeURIComponent(configuration.redirectUri)}` }));
    mock.complete.mockResolvedValue({ kind: 'business', familyId: 'family', sessionExpiresAt: Date.now() + 120_000, accessToken: 'access-token', refreshToken: 'refresh-test', tokenType: 'Bearer', expiresAt: Date.now() + 60_000,
      principal: scopedPrincipal(configuration.issuer, 'member-a') });
    mock.organizations.mockRejectedValue(Object.assign(new Error('elements_api_request_failed_403'), {
      status: 403, code: 'integration_tester_required',
    }));
    await session.signIn(() => {}, async (authorizationUrl) => {
      const redirectUri = new URL(authorizationUrl).searchParams.get('redirect_uri')!;
      await fetch(`${redirectUri}?code=code&state=state`);
    });
    expect(mock.clear).not.toHaveBeenCalled();
    expect(session.state()).toMatchObject({ status: 'error', message: 'You are not an integration tester. Contact developer support.' });
  });

  it('preserves active A when B fails tester preflight', async () => {
    mock.core.mockImplementation((options) => ({
      auth: {
        beginAuthorizationCode: async () => ({ authorizationUrl: `https://issuer.test/authorize?redirect_uri=${encodeURIComponent(options.configuration.redirectUri)}` }),
        completeAuthorizationCode: async () => {
          const result = { kind: 'business', familyId: 'family', sessionExpiresAt: Date.now() + 120_000, accessToken: 'access-b', refreshToken: 'refresh-test', tokenType: 'Bearer', expiresAt: Date.now() + 60_000,
            principal: scopedPrincipal(options.configuration.issuer, 'member-b') };
          await options.sessions.save(result);
          return result;
        },
        clear: () => options.sessions.clear(),
        getAccessToken: async () => (await options.sessions.load())?.accessToken,
      },
      listOrganizations: async () => {
        if ((await options.sessions.load())?.principal.subject === 'member-b')
          throw Object.assign(new Error('elements_api_request_failed_403'), { status: 403, code: 'integration_tester_required' });
        return [{ id: 'org-a', name: 'A' }];
      },
    }));
    const session = new TraySession('dev');
    const durable = mock.core.mock.calls[0]![0].sessions;
    await durable.save({ kind: 'business', familyId: 'family', sessionExpiresAt: Date.now() + 120_000, accessToken: 'access-a', refreshToken: 'refresh-test', tokenType: 'Bearer', expiresAt: Date.now() + 60_000,
      principal: scopedPrincipal('https://issuer.test/', 'member-a') });
    await session.restore();
    await session.signIn(() => {}, async (authorizationUrl) => {
      const redirectUri = new URL(authorizationUrl).searchParams.get('redirect_uri')!;
      await fetch(`${redirectUri}?code=code&state=state`);
    });
    expect(await durable.load()).toMatchObject({ principal: { subject: 'member-a' }, accessToken: 'access-a' });
    expect(session.state()).toMatchObject({ status: 'signed-in', activeSubject: 'member-a',
      message: 'You are not an integration tester. Contact developer support.' });
  });

  it('drops committed credentials when active discovery rejects tester access', async () => {
    const session = new TraySession('dev');
    await session.restore();
    const durable = mock.core.mock.calls[0]![0].sessions;
    const configuration = mock.core.mock.calls[0]![0].configuration;
    mock.begin.mockImplementation(async () => ({ authorizationUrl: `https://issuer.test/authorize?redirect_uri=${encodeURIComponent(configuration.redirectUri)}` }));
    mock.complete.mockResolvedValue({ kind: 'business', familyId: 'family', sessionExpiresAt: Date.now() + 120_000, accessToken: 'access-a', refreshToken: 'refresh-test', tokenType: 'Bearer', expiresAt: Date.now() + 60_000,
      principal: scopedPrincipal(configuration.issuer, 'member-a') });
    mock.organizations.mockResolvedValueOnce([{ id: 'org-a', name: 'A' }])
      .mockRejectedValueOnce(Object.assign(new Error('elements_api_request_failed_403'), {
        status: 403, code: 'integration_tester_required',
      }));
    await session.signIn(() => {}, async (authorizationUrl) => {
      const redirectUri = new URL(authorizationUrl).searchParams.get('redirect_uri')!;
      await fetch(`${redirectUri}?code=code&state=state`);
    });
    expect(await durable.load()).toBeUndefined();
    expect(session.state()).toMatchObject({ status: 'error', organizations: [], accounts: [],
      message: 'You are not an integration tester. Contact developer support.' });
  });

  it.each(['dev', 'prod'] as const)('uses the bound callback URI throughout %s sign-in', async (deployment) => {
    const session = new TraySession(deployment);
    await session.restore();
    const configuration = mock.core.mock.calls[0]![0].configuration;
    let redirectUri = '';
    mock.begin.mockImplementation(async () => {
      redirectUri = configuration.redirectUri;
      return { authorizationUrl: `https://issuer.test/authorize?redirect_uri=${encodeURIComponent(redirectUri)}` };
    });
    mock.complete.mockResolvedValue({ kind: 'business', familyId: 'family', sessionExpiresAt: Date.now() + 120_000, accessToken: 'access-token', refreshToken: 'refresh-test', tokenType: 'Bearer', expiresAt: Date.now() + 60_000,
      principal: scopedPrincipal(configuration.issuer, 'member-a', deployment === 'prod' ? 'LIVE' : 'TEST') });
    await session.signIn(() => {}, async (authorizationUrl) => {
      expect(new URL(authorizationUrl).searchParams.get('redirect_uri')).toBe(redirectUri);
      expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:[1-9]\d*\/oauth\/callback$/);
      await fetch(`${redirectUri}?code=code&state=state`);
    });
    expect(mock.core).toHaveBeenCalledTimes(2);
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
    await session.restore();
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

  it('uses a fresh session adapter when signing in after sign-out', async () => {
    const subjects = ['member-a', 'member-b'];
    mock.core.mockImplementation((options) => ({
      auth: {
        beginAuthorizationCode: async () => ({ authorizationUrl: `https://issuer.test/authorize?redirect_uri=${encodeURIComponent(options.configuration.redirectUri)}` }),
        completeAuthorizationCode: async () => {
          const subject = subjects.shift()!;
          const result = { kind: 'business', familyId: 'family', sessionExpiresAt: Date.now() + 120_000, accessToken: `access-${subject}`, refreshToken: `refresh-${subject}`, tokenType: 'Bearer',
            expiresAt: Date.now() + 60_000, principal: scopedPrincipal('https://issuer.test/', subject) };
          await options.sessions.save(result);
          return result;
        },
        clear: () => options.sessions.clear(),
        getAccessToken: mock.token,
      },
      listOrganizations: mock.organizations,
    }));
    const session = new TraySession('dev');
    await session.restore();
    const openBrowser = async (authorizationUrl: string) => {
      const redirectUri = new URL(authorizationUrl).searchParams.get('redirect_uri')!;
      await fetch(`${redirectUri}?code=code&state=state`);
    };
    await session.signIn(() => {}, openBrowser);
    expect(session.state().status).toBe('signed-in');
    const firstStore = mock.core.mock.calls[0]![0].sessions;
    await session.signOut();
    await session.signIn(() => {}, openBrowser);
    expect(session.state().status).toBe('signed-in');
    const secondStore = mock.core.mock.lastCall![0].sessions;
    expect(secondStore).not.toBe(firstStore);
    expect((await secondStore.load())?.principal.subject).toBe('member-b');
    await expect(firstStore.save({ accessToken: 'stale' })).rejects.toThrow('operator_session_retired');
  });

  it('adds B after A and activates either saved account without another login', async () => {
    const subjects = ['member-a', 'member-b'];
    const authorizationUrls: URL[] = [];
    mock.core.mockImplementation((options) => ({
      auth: {
        beginAuthorizationCode: async () => ({ authorizationUrl: `https://issuer.test/authorize?redirect_uri=${encodeURIComponent(options.configuration.redirectUri)}&state=state-1&nonce=nonce-1&code_challenge=challenge-1` }),
        completeAuthorizationCode: async () => {
          const subject = subjects.shift()!;
          const result = { kind: 'business', familyId: 'family', sessionExpiresAt: Date.now() + 120_000, accessToken: `access-${subject}`, refreshToken: `refresh-${subject}`, tokenType: 'Bearer',
            expiresAt: Date.now() + 60_000, principal: scopedPrincipal('https://issuer.test/', subject) };
          await options.sessions.save(result);
          return result;
        },
        clear: () => options.sessions.clear(),
        getAccessToken: async () => (await options.sessions.load())?.accessToken,
      },
      listOrganizations: async () => {
        const current = await options.sessions.load();
        if (current?.principal.subject === 'member-b' && !('accountSummaries' in options.sessions)) {
          await options.sessions.save({ ...current, refreshToken: 'rotated-b' });
        }
        if (current?.principal.subject === 'member-b') return [
          { id: 'org-member-b', name: 'member-b' },
          { id: 'org-member-b-2', name: 'member-b-2' },
        ];
        return current ? [{ id: `org-${current.principal.subject}`, name: current.principal.subject }] : [];
      },
    }));
    const session = new TraySession('dev');
    await session.restore();
    const openBrowser = async (authorizationUrl: string) => {
      const authorization = new URL(authorizationUrl);
      authorizationUrls.push(authorization);
      const redirectUri = authorization.searchParams.get('redirect_uri')!;
      await fetch(`${redirectUri}?code=code&state=state`);
    };
    await session.signIn(() => {}, openBrowser);
    expect(session.state().organizations).toEqual([{ id: 'org-member-a', name: 'member-a' }]);
    mock.stopInbox.mockImplementation(() => {
      const presence = mock.listenInbox.mock.lastCall?.[5] as ((snapshot: null) => void) | undefined;
      presence?.(null);
    });
    await session.addAccount(() => {}, openBrowser);
    expect(authorizationUrls.map((url) => url.searchParams.get('prompt'))).toEqual([null, 'login']);
    for (const url of authorizationUrls) {
      expect(url.searchParams.get('state')).toBe('state-1');
      expect(url.searchParams.get('nonce')).toBe('nonce-1');
      expect(url.searchParams.get('code_challenge')).toBe('challenge-1');
    }
    expect(session.state().message).toBeUndefined();
    expect(session.state()).toMatchObject({ status: 'signed-in', organizations: [
      { id: 'org-member-b', name: 'member-b' },
      { id: 'org-member-b-2', name: 'member-b-2' },
    ] });
    expect(session.state().selectedId).toBeUndefined();
    expect((await mock.core.mock.calls[0]![0].sessions.fork().load())?.refreshToken).toBe('rotated-b');
    expect(session.state()).toMatchObject({ activeSubject: 'member-b', accounts: [
      { subject: 'member-a', name: 'Saved account', status: 'ready', organizations: [{ id: 'org-member-a', name: 'member-a' }] },
      { subject: 'member-b', name: 'Saved account', status: 'ready', organizations: [
        { id: 'org-member-b', name: 'member-b' }, { id: 'org-member-b-2', name: 'member-b-2' },
      ] },
    ] });
    expect(JSON.stringify(session.state())).not.toContain('refresh-member');
    expect(JSON.stringify(session.state())).not.toContain('access-member');
    await session.activateAccount('member-a');
    expect(session.state().organizations).toEqual([{ id: 'org-member-a', name: 'member-a' }]);
    await session.activateAccount('member-b');
    expect(session.state().organizations).toEqual([
      { id: 'org-member-b', name: 'member-b' }, { id: 'org-member-b-2', name: 'member-b-2' },
    ]);
    expect(session.state().selectedId).toBeUndefined();
    await session.select('org-member-b');
    await session.select('org-member-b-2');
    expect(session.state().selectedId).toBe('org-member-b-2');
    expect(subjects).toEqual([]);
  });

  it('recovers an unavailable saved A by signing in as B without removing A', async () => {
    let offline = true;
    mock.core.mockImplementation((options) => ({
      auth: {
        beginAuthorizationCode: async () => ({ authorizationUrl: `https://issuer.test/authorize?redirect_uri=${encodeURIComponent(options.configuration.redirectUri)}` }),
        completeAuthorizationCode: async () => {
          const result = { kind: 'business', familyId: 'family', sessionExpiresAt: Date.now() + 120_000, accessToken: 'access-b', refreshToken: 'refresh-b', tokenType: 'Bearer',
            expiresAt: Date.now() + 60_000, principal: scopedPrincipal('https://issuer.test/', 'member-b') };
          await options.sessions.save(result);
          return result;
        },
        clear: () => options.sessions.clear(),
        getAccessToken: async () => {
          if (offline) throw new Error('offline');
          return (await options.sessions.load())?.accessToken;
        },
      },
      listOrganizations: async () => [{ id: 'org-b', name: 'B' }],
    }));
    const session = new TraySession('dev');
    const saved = mock.core.mock.calls[0]![0].sessions;
    await saved.save({ kind: 'business', familyId: 'family', sessionExpiresAt: Date.now() + 120_000, accessToken: 'access-a', refreshToken: 'refresh-a', tokenType: 'Bearer',
      expiresAt: Date.now() + 60_000, principal: scopedPrincipal('https://issuer.test/', 'member-a') });
    await session.restore();
    expect(session.state().status).toBe('session-unavailable');
    offline = false;
    await session.signIn(() => {}, async (authorizationUrl) => {
      const redirectUri = new URL(authorizationUrl).searchParams.get('redirect_uri')!;
      await fetch(`${redirectUri}?code=code&state=state`);
    });
    expect(session.state()).toMatchObject({ status: 'signed-in', organizations: [{ id: 'org-b', name: 'B' }] });
    expect(await saved.listProfiles()).toEqual(['member-a', 'member-b']);
  });

  it('keeps A active when Add Account authorization is canceled', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-a', name: 'A' }]);
    const session = new TraySession('dev');
    const options = mock.core.mock.calls[0]![0];
    await options.sessions.save({ kind: 'business', familyId: 'family', sessionExpiresAt: Date.now() + 120_000, accessToken: 'access-a', refreshToken: 'refresh-a', tokenType: 'Bearer',
      expiresAt: Date.now() + 60_000, principal: scopedPrincipal('https://issuer.test/', 'member-a') });
    await session.restore();
    mock.begin.mockResolvedValue({ authorizationUrl: 'https://issuer.test/authorize' });
    const pending = session.addAccount(() => {}, async () => {});
    await vi.waitFor(() => expect(mock.begin).toHaveBeenCalled());
    await session.cancelAccountAuthorization();
    await pending;
    expect(session.state().status).toBe('signed-in');
    expect(session.state().organizations).toEqual([{ id: 'org-a', name: 'A' }]);
  });

  it('returns to signed out when initial authorization is canceled', async () => {
    const session = new TraySession('dev');
    await session.restore();
    mock.begin.mockResolvedValue({ authorizationUrl: 'https://issuer.test/authorize' });
    const pending = session.signIn(() => {}, async () => {});
    await vi.waitFor(() => expect(session.state().status).toBe('authorizing'));
    await session.cancelAccountAuthorization();
    await pending;
    expect(session.state().status).toBe('signed-out');
    expect(mock.complete).not.toHaveBeenCalled();
  });

  it('does not restore a canceled sign-in after the token exchange saves late', async () => {
    let finishExchange!: () => void;
    mock.core.mockImplementation((options) => ({
      auth: {
        beginAuthorizationCode: async () => ({ authorizationUrl: `https://issuer.test/authorize?redirect_uri=${encodeURIComponent(options.configuration.redirectUri)}` }),
        completeAuthorizationCode: async () => {
          await new Promise<void>((resolve) => { finishExchange = resolve; });
          const result = { kind: 'business', familyId: 'family', sessionExpiresAt: Date.now() + 120_000, accessToken: 'late-access', refreshToken: 'refresh-test', tokenType: 'Bearer', expiresAt: Date.now() + 60_000,
            principal: scopedPrincipal(options.configuration.issuer, 'member-late') };
          await options.sessions.save(result);
          return result;
        },
        clear: () => options.sessions.clear(),
        getAccessToken: async () => (await options.sessions.load())?.accessToken,
      },
      listOrganizations: mock.organizations,
    }));
    const session = new TraySession('dev');
    await session.restore();
    const durable = mock.core.mock.calls[0]![0].sessions;
    const signingIn = session.signIn(() => {}, async (authorizationUrl) => {
      const redirectUri = new URL(authorizationUrl).searchParams.get('redirect_uri')!;
      await fetch(`${redirectUri}?code=code&state=state`);
    });
    await vi.waitFor(() => expect(finishExchange).toBeTypeOf('function'));
    const cancelling = session.cancelAccountAuthorization();
    finishExchange();
    await cancelling;
    await signingIn;
    expect(await durable.load()).toBeUndefined();
    expect(session.state().status).toBe('signed-out');
    const restarted = new TraySession('dev');
    await restarted.restore();
    expect(restarted.state()).toMatchObject({ status: 'signed-out', accounts: [] });
  });

  it('does not persist a sign-in canceled during membership discovery', async () => {
    let finishDiscovery!: (organizations: { id: string; name: string }[]) => void;
    mock.core.mockImplementation((options) => ({
      auth: {
        beginAuthorizationCode: async () => ({ authorizationUrl: `https://issuer.test/authorize?redirect_uri=${encodeURIComponent(options.configuration.redirectUri)}` }),
        completeAuthorizationCode: async () => {
          const result = { kind: 'business', familyId: 'family', sessionExpiresAt: Date.now() + 120_000, accessToken: 'access', refreshToken: 'refresh-test', tokenType: 'Bearer', expiresAt: Date.now() + 60_000,
            principal: scopedPrincipal(options.configuration.issuer, 'member-a') };
          await options.sessions.save(result);
          return result;
        },
        clear: () => options.sessions.clear(),
        getAccessToken: async () => (await options.sessions.load())?.accessToken,
      },
      listOrganizations: () => new Promise((resolve) => { finishDiscovery = resolve; }),
    }));
    const session = new TraySession('dev');
    await session.restore();
    const durable = mock.core.mock.calls[0]![0].sessions;
    const signingIn = session.signIn(() => {}, async (authorizationUrl) => {
      const redirectUri = new URL(authorizationUrl).searchParams.get('redirect_uri')!;
      await fetch(`${redirectUri}?code=code&state=state`);
    });
    await vi.waitFor(() => expect(finishDiscovery).toBeTypeOf('function'));
    const cancelling = session.cancelAccountAuthorization();
    finishDiscovery([{ id: 'org-a', name: 'A' }]);
    await cancelling;
    await signingIn;
    expect(await durable.load()).toBeUndefined();
    const restarted = new TraySession('dev');
    await restarted.restore();
    expect(restarted.state()).toMatchObject({ status: 'signed-out', accounts: [] });
  });

  it('hides cancellation once a fresh sign-in starts durable commit', async () => {
    let finishDiscovery!: (organizations: { id: string; name: string }[]) => void;
    mock.organizations.mockResolvedValueOnce([{ id: 'org-a', name: 'A' }])
      .mockImplementationOnce(() => new Promise((resolve) => { finishDiscovery = resolve; }));
    const session = new TraySession('dev');
    await session.restore();
    const configuration = mock.core.mock.calls[0]![0].configuration;
    mock.begin.mockImplementation(async () => ({ authorizationUrl: `https://issuer.test/authorize?redirect_uri=${encodeURIComponent(configuration.redirectUri)}` }));
    mock.complete.mockResolvedValue({ kind: 'business', familyId: 'family', sessionExpiresAt: Date.now() + 120_000, accessToken: 'access', refreshToken: 'refresh-test', tokenType: 'Bearer', expiresAt: Date.now() + 60_000,
      principal: scopedPrincipal(configuration.issuer, 'member-a') });
    const statuses: string[] = [];
    const signingIn = session.signIn(() => { statuses.push(session.state().status); }, async (authorizationUrl) => {
      const redirectUri = new URL(authorizationUrl).searchParams.get('redirect_uri')!;
      await fetch(`${redirectUri}?code=code&state=state`);
    });
    await vi.waitFor(() => expect(finishDiscovery).toBeTypeOf('function'));
    expect(session.state().status).toBe('restoring');
    expect(statuses).toContain('restoring');
    await expect(session.cancelAccountAuthorization()).rejects.toThrow('authorization_committing');
    finishDiscovery([{ id: 'org-a', name: 'A' }]);
    await signingIn;
    expect(session.state().status).toBe('signed-in');
  });

  it('blocks account activation before clearing active plan, edit, or inbox work', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-a', name: 'A' }]);
    const session = new TraySession('dev');
    await session.restore();
    const creation = vi.spyOn(TrayQuickPlans.prototype, 'assertIdle').mockImplementationOnce(() => { throw new Error('creation_in_progress'); });
    await expect(session.activateAccount('member-b')).rejects.toThrow('creation_in_progress');
    creation.mockRestore();
    const edit = vi.spyOn(TrayPlanEdit.prototype, 'assertIdle').mockImplementationOnce(() => { throw new Error('edit_in_progress'); });
    await expect(session.activateAccount('member-b')).rejects.toThrow('edit_in_progress');
    edit.mockRestore();
    const transfer = vi.spyOn(TrayInbox.prototype, 'assertIdle').mockImplementationOnce(() => { throw new Error('inbox_transfer_busy'); });
    await expect(session.activateAccount('member-b')).rejects.toThrow('inbox_transfer_busy');
    transfer.mockRestore();
    expect(session.state()).toMatchObject({ status: 'signed-in', organizations: [{ id: 'org-a', name: 'A' }] });
  });

  it('switches accounts after a completed plan creation remains in Home state', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-a', name: 'A' }]);
    mock.context.mockResolvedValue({ planId: 'plan-1' });
    mock.create.mockResolvedValue({ status: 'READY', planId: 'plan-1' });
    const session = new TraySession('dev');
    const store = mock.core.mock.calls[0]![0].sessions;
    const first = { kind: 'business', familyId: 'family', sessionExpiresAt: Date.now() + 120_000, accessToken: 'access-a', refreshToken: 'refresh-a', tokenType: 'Bearer', expiresAt: Date.now() + 60_000,
      principal: scopedPrincipal('https://issuer.test/', 'member-a') };
    await store.save(first);
    await store.enroll({ ...first, accessToken: 'access-b', principal: { ...first.principal, subject: 'member-b' } });
    await session.restore();
    await session.createQuickPlan({ title: 'First', asset: asset('secret') }, () => {});
    expect(session.state().creation).toMatchObject({ status: 'ready', planId: 'plan-1' });
    await session.activateAccount('member-b');
    expect(session.state()).toMatchObject({ activeSubject: 'member-b', status: 'signed-in' });
    expect(session.state().creation).toBeUndefined();
  });

  it('rejects new inbox work while account activation is cleaning up', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-a', name: 'A' }]);
    const session = new TraySession('dev');
    const store = mock.core.mock.calls[0]![0].sessions;
    const first = { kind: 'business', familyId: 'family', sessionExpiresAt: Date.now() + 120_000, accessToken: 'access-a', refreshToken: 'refresh-a', tokenType: 'Bearer', expiresAt: Date.now() + 60_000,
      principal: scopedPrincipal('https://issuer.test/', 'member-a') };
    await store.save(first);
    await store.enroll({ ...first, accessToken: 'access-b', principal: { ...first.principal, subject: 'member-b' } });
    await session.restore();
    let release!: () => void;
    const clear = vi.spyOn(TrayPlanEdit.prototype, 'clear').mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const activation = session.activateAccount('member-b');
    await expect(session.createInboxConversation('Conversation', [])).rejects.toThrow('inbox_transition_in_progress');
    await expect(session.select('org-a')).rejects.toThrow('account_transition_in_progress');
    release();
    await activation;
    expect(() => session.listInboxConversations()).not.toThrow();
    clear.mockRestore();
  });

  it('drops a late A organization refresh after B activates', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValueOnce([{ id: 'org-a', name: 'A' }]);
    const session = new TraySession('dev');
    const store = mock.core.mock.calls[0]![0].sessions;
    const first = { kind: 'business', familyId: 'family', sessionExpiresAt: Date.now() + 120_000, accessToken: 'access-a', refreshToken: 'refresh-a', tokenType: 'Bearer', expiresAt: Date.now() + 60_000,
      principal: scopedPrincipal('https://issuer.test/', 'member-a') };
    await store.save(first);
    await session.restore();
    await store.enroll({ ...first, accessToken: 'access-b', principal: { ...first.principal, subject: 'member-b' } });
    let release!: (organizations: { id: string; name: string }[]) => void;
    mock.organizations.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }))
      .mockResolvedValueOnce([{ id: 'org-b', name: 'B' }]);
    const oldRefresh = session.refreshOrganizations();
    await session.activateAccount('member-b');
    release([{ id: 'org-a-stale', name: 'Stale A' }]);
    expect(await oldRefresh).toBe(false);
    expect(session.state()).toMatchObject({ activeSubject: 'member-b', organizations: [{ id: 'org-b', name: 'B' }] });
  });

  it('waits for A restoration before activating B', async () => {
    mock.token.mockResolvedValue('access-token');
    const session = new TraySession('dev');
    const store = mock.core.mock.calls[0]![0].sessions;
    const first = { kind: 'business', familyId: 'family', sessionExpiresAt: Date.now() + 120_000, accessToken: 'access-a', refreshToken: 'refresh-a', tokenType: 'Bearer', expiresAt: Date.now() + 60_000,
      principal: scopedPrincipal('https://issuer.test/', 'member-a') };
    await store.save(first);
    await store.enroll({ ...first, accessToken: 'access-b', principal: { ...first.principal, subject: 'member-b' } });
    let release!: (organizations: { id: string; name: string }[]) => void;
    mock.organizations.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }))
      .mockResolvedValueOnce([{ id: 'org-b', name: 'B' }]);
    const restoring = session.restore();
    await vi.waitFor(() => expect(mock.organizations).toHaveBeenCalledTimes(1));
    await expect(session.activateAccount('member-b')).rejects.toThrow('restore_in_progress');
    release([{ id: 'org-a', name: 'A' }]);
    await restoring;
    expect(session.state()).toMatchObject({ activeSubject: 'member-a', organizations: [{ id: 'org-a', name: 'A' }] });
    await session.activateAccount('member-b');
    expect(session.state()).toMatchObject({ activeSubject: 'member-b', organizations: [{ id: 'org-b', name: 'B' }] });
  });

  it('drains canceled authorization before changing the callback URI on retry', async () => {
    let release!: (value: { authorizationUrl: string }) => void;
    mock.begin.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }))
      .mockRejectedValueOnce(new Error('retry_failed'));
    const session = new TraySession('dev');
    await session.restore();
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
    await expect(session.select('unlisted')).rejects.toThrow('account_transition_in_progress');
    expect(session.state().selectedId).toBeUndefined();
  });

  it('refreshes organizations without resetting the selected edit', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValueOnce([{ id: 'org-a', name: 'A' }, { id: 'org-b', name: 'B' }])
      .mockResolvedValueOnce([{ id: 'org-a', name: 'A' }, { id: 'org-b', name: 'B' }, { id: 'org-c', name: 'C' }]);
    const session = new TraySession('dev');
    await session.restore();
    await session.select('org-a');
    const selectEdit = vi.spyOn(TrayPlanEdit.prototype, 'selectOrganization');
    expect(await session.refreshOrganizations()).toBe(true);
    expect(session.state()).toMatchObject({ status: 'signed-in', selectedId: 'org-a', organizations: [
      { id: 'org-a', name: 'A' }, { id: 'org-b', name: 'B' }, { id: 'org-c', name: 'C' },
    ] });
    expect(selectEdit).not.toHaveBeenCalled();
    selectEdit.mockRestore();
  });

  it('drops a refresh result after sign-out', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValueOnce([{ id: 'org-a', name: 'A' }]);
    const session = new TraySession('dev');
    await session.restore();
    let resolve!: (value: { id: string; name: string }[]) => void;
    mock.organizations.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const refresh = session.refreshOrganizations();
    await session.signOut();
    resolve([{ id: 'org-b', name: 'B' }]);
    expect(await refresh).toBe(false);
    expect(session.state()).toMatchObject({ status: 'signed-out', organizations: [] });
  });

  it('clears a revoked selection and leaves the remaining organization for the picker', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValueOnce([{ id: 'org-a', name: 'A' }, { id: 'org-b', name: 'B' }])
      .mockResolvedValueOnce([{ id: 'org-b', name: 'B' }]);
    const session = new TraySession('dev');
    await mock.core.mock.calls[0]![0].sessions.save({ kind: 'business', familyId: 'family', sessionExpiresAt: Date.now() + 120_000, accessToken: 'access-a', refreshToken: 'refresh-a', tokenType: 'Bearer',
      expiresAt: Date.now() + 60_000, principal: scopedPrincipal('https://issuer.test/', 'member-a') });
    await session.restore();
    await session.select('org-a');
    expect(await session.refreshOrganizations()).toBe(true);
    expect(session.state()).toMatchObject({ status: 'signed-in', organizations: [{ id: 'org-b', name: 'B' }] });
    expect(session.state().accounts[0]?.organizations).toEqual([{ id: 'org-b', name: 'B' }]);
    expect(session.state().selectedId).toBeUndefined();
    await session.select('org-b');
    expect(session.state().selectedId).toBe('org-b');
  });

  it('keeps a revoked selection and its list while an edit is busy', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValueOnce([{ id: 'org-a', name: 'A' }])
      .mockResolvedValueOnce([{ id: 'org-b', name: 'B' }]);
    const session = new TraySession('dev');
    await session.restore();
    const busy = vi.spyOn(TrayPlanEdit.prototype, 'assertIdle').mockImplementationOnce(() => { throw new Error('edit_in_progress'); });
    expect(await session.refreshOrganizations()).toBe(false);
    expect(session.state()).toMatchObject({ selectedId: 'org-a', organizations: [{ id: 'org-a', name: 'A' }] });
    busy.mockRestore();
  });

  it('restores the last authorised organisation for a multi-organisation session', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-a', name: 'A' }, { id: 'org-b', name: 'B' }]);
    const first = new TraySession('dev');
    const issuer = mock.core.mock.calls[0]![0].configuration.issuer;
    await mock.core.mock.calls[0]![0].sessions.save({ kind: 'business', familyId: 'family', sessionExpiresAt: Date.now() + 120_000, accessToken: 'access-token', refreshToken: 'refresh-test', tokenType: 'Bearer', expiresAt: Date.now() + 60_000,
      principal: scopedPrincipal(issuer, 'member') });
    await first.restore();
    await first.select('org-b');
    const restarted = new TraySession('dev');
    await restarted.restore();
    expect(restarted.state().selectedId).toBe('org-b');
    mock.organizations.mockResolvedValue([{ id: 'org-a', name: 'A' }]);
    const revoked = new TraySession('dev');
    await revoked.restore();
    expect(revoked.state().selectedId).toBe('org-a');
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

  it('starts a fresh auth core after a revoked session is cleared during restore', async () => {
    mock.core.mockImplementation((options) => ({
      auth: {
        beginAuthorizationCode: async () => ({ authorizationUrl: `https://issuer.test/authorize?redirect_uri=${encodeURIComponent(options.configuration.redirectUri)}` }),
        completeAuthorizationCode: async () => {
          const result = { kind: 'business', familyId: 'family', sessionExpiresAt: Date.now() + 120_000, accessToken: 'new-access', refreshToken: 'refresh-test', tokenType: 'Bearer', expiresAt: Date.now() + 60_000,
            principal: scopedPrincipal(options.configuration.issuer, 'member-b') };
          await options.sessions.save(result);
          return result;
        },
        clear: () => options.sessions.clear(),
        getAccessToken: async () => {
          await options.sessions.clear();
          throw new Error('revoked');
        },
      },
      listOrganizations: mock.organizations,
    }));
    const session = new TraySession('dev');
    await session.restore();
    expect(session.state().status).toBe('signed-out');
    const originalStore = mock.core.mock.calls[0]![0].sessions;
    await session.signIn(() => {}, async (authorizationUrl) => {
      const redirectUri = new URL(authorizationUrl).searchParams.get('redirect_uri')!;
      await fetch(`${redirectUri}?code=code&state=state`);
    });
    expect(session.state().status).toBe('signed-in');
    expect(mock.core).toHaveBeenCalledTimes(3);
    expect(mock.core.mock.calls[1]![0].sessions).not.toBe(originalStore);
  });

  it('keeps a saved session available for retry after a temporary restore failure', async () => {
    const session = new TraySession('dev');
    const options = mock.core.mock.calls[0]![0];
    await options.sessions.save({ kind: 'business', familyId: 'family', sessionExpiresAt: Date.now() + 120_000, accessToken: 'access-token', refreshToken: 'refresh-test', tokenType: 'Bearer', expiresAt: Date.now() + 60_000,
      principal: scopedPrincipal(options.configuration.issuer, 'member') });
    mock.token.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-1', name: 'One' }]);

    await session.restore();
    expect(session.state()).toMatchObject({ status: 'session-unavailable', organizations: [] });
    expect(await options.sessions.load()).toMatchObject({ accessToken: 'access-token' });

    await session.restore();
    expect(session.state()).toMatchObject({ status: 'signed-in', selectedId: 'org-1' });
  });

  it('does not start browser sign-in during session restoration', async () => {
    let release!: (token: string) => void;
    mock.token.mockReturnValue(new Promise<string>((resolve) => { release = resolve; }));
    const session = new TraySession('dev');
    const restoring = session.restore();
    await session.signIn(() => {}, vi.fn());
    expect(mock.begin).not.toHaveBeenCalled();
    release('access-token');
    await restoring;
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

  it('restarts the current Inbox listener after a rejected switch', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-a', name: 'A' }, { id: 'org-b', name: 'B' }]);
    const session = new TraySession('dev');
    await session.restore();
    await session.select('org-a');
    mock.listenInbox.mockClear();
    vi.spyOn(TrayPlanEdit.prototype, 'selectOrganization').mockRejectedValueOnce(new Error('edit_recovery_required'));
    await expect(session.select('org-b')).rejects.toThrow('edit_recovery_required');
    expect(session.state().selectedId).toBe('org-a');
    expect(mock.stopInbox).toHaveBeenCalled();
    expect(mock.listenInbox).toHaveBeenCalledTimes(1);
  });

  it('blocks selection and creation while sign-out cleanup is pending', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-a', name: 'A' }, { id: 'org-b', name: 'B' }]);
    const session = new TraySession('dev');
    await session.restore();
    await session.select('org-a');
    let release!: () => void;
    mock.keyClear.mockReturnValueOnce(new Promise<void>((resolve) => { release = resolve; }));
    const signingOut = session.signOut();
    const listenerCount = mock.listenInbox.mock.calls.length;
    await expect(session.select('org-b')).rejects.toThrow('sign_out_in_progress');
    expect(() => session.createQuickPlan({ title: 'Secret', asset: asset('secret') }, () => {})).toThrow('sign_out_in_progress');
    expect(() => session.listInboxConversations()).toThrow('inbox_transition_in_progress');
    expect(() => session.loadEditablePlans(() => {})).toThrow('organization_required');
    expect(() => session.recoverPlanEdit(() => {})).toThrow('organization_required');
    expect(mock.listenInbox).toHaveBeenCalledTimes(listenerCount);
    release();
    await signingOut;
    expect(session.state().status).toBe('signed-out');
  });

  it('blocks sign-out during a pending Inbox mutation and locks new mutations during cleanup', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-a', name: 'A' }]);
    const session = new TraySession('dev');
    await session.restore();
    let finishMutation!: () => void;
    mock.changeParticipants.mockReturnValueOnce(new Promise<void>((resolve) => { finishMutation = resolve; }));
    const mutation = session.changeInboxParticipants('conversation-1', { action: 'ADD', memberId: 'member-1', expectedRevision: 1 });
    await expect(session.signOut()).rejects.toThrow('inbox_operation_busy');
    expect(mock.clear).not.toHaveBeenCalled();
    finishMutation();
    await mutation;

    let finishCleanup!: () => void;
    mock.keyClear.mockReturnValueOnce(new Promise<void>((resolve) => { finishCleanup = resolve; }));
    const signingOut = session.signOut();
    await expect(session.changeInboxParticipants('conversation-1', { action: 'ADD', memberId: 'member-2', expectedRevision: 1 }))
      .rejects.toThrow('inbox_transition_in_progress');
    expect(mock.changeParticipants).toHaveBeenCalledTimes(1);
    finishCleanup();
    await signingOut;
    expect(session.state().status).toBe('signed-out');
  });

  it('restores the Inbox listener when sign-out cleanup fails', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-a', name: 'A' }]);
    const session = new TraySession('dev');
    await session.restore();
    mock.listenInbox.mockClear();
    mock.keyClear.mockRejectedValueOnce(new Error('vault_failure'));
    await expect(session.signOut()).rejects.toThrow('vault_failure');
    expect(session.state()).toMatchObject({ status: 'signed-in', selectedId: 'org-a' });
    expect(mock.listenInbox).toHaveBeenCalledTimes(1);
  });

  it('clears the active account when Business revocation fails', async () => {
    const session = new TraySession('dev');
    const store = mock.core.mock.calls[0]![0].sessions;
    await store.save({ kind: 'business', familyId: 'family', sessionExpiresAt: Date.now() + 120_000,
      accessToken: 'access-a', refreshToken: 'refresh-a', tokenType: 'Bearer', expiresAt: Date.now() + 60_000,
      principal: scopedPrincipal('https://issuer.test/', 'member-a') });
    mock.clear.mockRejectedValueOnce(new Error('network_failed'));

    await session.signOut();

    expect(session.state().status).toBe('signed-out');
    expect(await store.load()).toBeUndefined();
  });

  it('removes a secondary account without changing the active context, then offers selection after removing the active one', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([]);
    const tray = new TraySession('dev');
    const store = mock.core.mock.calls[0]![0].sessions;
    const principal = (subject: string) => ({ issuer: 'https://issuer.test/', audience: 'inheriti-integrations-api',
      authorizedParty: 'interactive', environment: 'TEST', subject, sessionId: 'session', tokenId: 'token', scopes: [] });
    const account = (subject: string) => ({ kind: 'business', familyId: subject, sessionExpiresAt: Date.now() + 120_000,
      accessToken: `access-${subject}`, refreshToken: `refresh-${subject}`, tokenType: 'Bearer', expiresAt: Date.now() + 60_000,
      principal: principal(subject) });
    await store.save(account('member-a'));
    await store.enroll(account('member-b'));
    await store.enroll(account('member-c'));
    await tray.restore();
    const selected = tray.state().selectedId;
    await tray.removeAccount('member-b');
    expect(tray.state()).toMatchObject({ status: 'signed-in', activeSubject: 'member-a' });
    expect(tray.state().selectedId).toBe(selected);
    expect(tray.state().accounts.map(({ subject }) => subject)).toEqual(['member-a', 'member-c']);
    await tray.removeAccount('member-a');
    expect(tray.state()).toMatchObject({ status: 'signed-out', accounts: [{ subject: 'member-c' }] });
    expect(tray.state().activeSubject).toBeUndefined();
  });

  it('signs out every saved account and clears the active context', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-a', name: 'A' }]);
    const session = new TraySession('dev');
    const store = mock.core.mock.calls[0]![0].sessions;
    const first = { kind: 'business', familyId: 'family', sessionExpiresAt: Date.now() + 120_000, accessToken: 'access-a', refreshToken: 'refresh-a', tokenType: 'Bearer', expiresAt: Date.now() + 60_000,
      principal: scopedPrincipal('https://issuer.test/', 'member-a') };
    await store.save(first);
    await store.enroll({ kind: 'business', familyId: 'family', sessionExpiresAt: Date.now() + 120_000, accessToken: 'access-b', refreshToken: 'refresh-b', tokenType: 'Bearer', expiresAt: Date.now() + 60_000,
      principal: scopedPrincipal('https://issuer.test/', 'member-b') });
    await session.restore();
    await session.select('org-a');
    expect(session.state().accounts).toHaveLength(2);

    await session.signOutAll();

    expect(session.state()).toMatchObject({ status: 'signed-out', organizations: [], accounts: [] });
    expect(session.state().activeSubject).toBeUndefined();
    await expect(store.load()).resolves.toBeUndefined();
    expect(mock.clear).toHaveBeenCalledTimes(2);
  });

  it('signs out all saved accounts after the active session adapter retires', async () => {
    const session = new TraySession('dev');
    const store = mock.core.mock.calls[0]![0].sessions;
    const first = { kind: 'business', familyId: 'family', sessionExpiresAt: Date.now() + 120_000, accessToken: 'access-a', refreshToken: 'refresh-a', tokenType: 'Bearer', expiresAt: Date.now() + 60_000,
      principal: scopedPrincipal('https://issuer.test/', 'member-a') };
    await store.save(first);
    await store.enroll({ kind: 'business', familyId: 'family', sessionExpiresAt: Date.now() + 120_000, accessToken: 'access-b', refreshToken: 'refresh-b', tokenType: 'Bearer', expiresAt: Date.now() + 60_000,
      principal: scopedPrincipal('https://issuer.test/', 'member-b') });
    await session.restore();
    store.retire();

    await session.signOutAll();

    expect(session.state()).toMatchObject({ status: 'signed-out', accounts: [] });
    expect(await store.listProfiles()).toEqual([]);
  });

  it('blocks sign-out-all during an Inbox mutation', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-a', name: 'A' }]);
    const session = new TraySession('dev');
    await session.restore();
    await session.select('org-a');
    let finishMutation!: () => void;
    mock.changeParticipants.mockReturnValueOnce(new Promise<void>((resolve) => { finishMutation = resolve; }));
    const mutation = session.changeInboxParticipants('conversation-1', { action: 'ADD', memberId: 'member-1', expectedRevision: 1 });
    await expect(session.signOutAll()).rejects.toThrow('inbox_operation_busy');
    finishMutation();
    await mutation;
  });

  it('preserves the signed-in account when all-account checkpoint cleanup fails', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-a', name: 'A' }]);
    const session = new TraySession('dev');
    const store = mock.core.mock.calls[0]![0].sessions;
    await store.save({ kind: 'business', familyId: 'family', sessionExpiresAt: Date.now() + 120_000, accessToken: 'access-a', refreshToken: 'refresh-a', tokenType: 'Bearer', expiresAt: Date.now() + 60_000,
      principal: scopedPrincipal('https://issuer.test/', 'member-a') });
    await session.restore();
    await session.select('org-a');
    vi.spyOn(ProtectedCheckpoint.prototype, 'cleanMany').mockImplementationOnce(() => { throw new Error('checkpoint_failure'); });

    await expect(session.signOutAll()).rejects.toThrow('checkpoint_failure');

    expect(session.state()).toMatchObject({ status: 'signed-in', selectedId: 'org-a', activeSubject: 'member-a' });
    await expect(store.load()).resolves.toMatchObject({ accessToken: 'access-a' });
  });

  it('restores the selected organization context after A to B to A', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-a', name: 'A' }, { id: 'org-b', name: 'B' }]);
    const session = new TraySession('dev');
    await session.restore();
    await session.select('org-a');
    await session.select('org-b');
    await session.select('org-a');
    expect(session.state().selectedId).toBe('org-a');
    expect(mock.operations.mock.calls.map(([options]) => options.organizationId)).toEqual(['org-a', 'org-b', 'org-a']);
    expect(mock.listenInbox).toHaveBeenCalledTimes(3);
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
