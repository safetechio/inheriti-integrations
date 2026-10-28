import { BUSINESS_INTERACTIVE_CLIENT_ID, MemoryOperatorSessionStore, createNodeIntegrationCore } from '@safetech/inheriti-elements-core/node';
import type { BusinessOrganization, NodeIntegrationCore, NodeIntegrationCoreOptions, OperatorSession, OperatorSessionStore } from '@safetech/inheriti-elements-core/node';
import { waitForCallback, untilCanceled } from '../../auth/main/oauth-callback.js';
import { ProtectedOperatorSessionStore } from './operator-session-store.js';
import type { SavedAccountSummary } from './operator-session-store.js';

export class TrayAuthRuntime {
  readonly configuration: NodeIntegrationCoreOptions['configuration'];
  private store: ProtectedOperatorSessionStore;
  private activeCore: NodeIntegrationCore;
  private pendingAuthorization: ReturnType<NodeIntegrationCore['auth']['beginAuthorizationCode']> | undefined;

  constructor(deployment: string, private readonly apiUrl: string, issuer: string,
    private readonly environment: NodeIntegrationCoreOptions['environment']) {
    this.configuration = {
      issuer,
      clientId: BUSINESS_INTERACTIVE_CLIENT_ID,
      audience: 'inheriti-integrations-api',
      environment,
      redirectUri: 'http://127.0.0.1/oauth/callback',
      scopes: ['openid', 'profile', 'offline_access'],
    };
    this.store = new ProtectedOperatorSessionStore(deployment, issuer);
    this.activeCore = this.createCore();
  }

  get core(): NodeIntegrationCore { return this.activeCore; }
  get sessions(): ProtectedOperatorSessionStore { return this.store; }
  getAccessToken(): Promise<string | undefined> { return this.activeCore.auth.getAccessToken(); }
  accountSummaries(): Promise<{ accounts: SavedAccountSummary[]; activeSubject: string | undefined }> { return this.store.accountSummaries(); }

  renewIfRetired(): void { if (this.store.isRetired) this.renew(); }

  renew(): void {
    this.store = this.store.fork();
    this.activeCore = this.createCore();
  }

  async authorizeAdditional(openBrowser: (url: string) => Promise<void>, signal: AbortSignal): Promise<{ session: OperatorSession; organizations: BusinessOrganization[] }> {
    const sessions = new MemoryOperatorSessionStore();
    const temporary = this.createCore(sessions);
    const session = await this.authorize(async (url) => {
      const authorization = new URL(url);
      authorization.searchParams.set('prompt', 'login');
      await openBrowser(authorization.toString());
    }, signal, temporary);
    signal.throwIfAborted();
    const organizations = await temporary.listOrganizations();
    signal.throwIfAborted();
    const current = await sessions.load();
    if (!current || current.principal.issuer !== session.principal.issuer || current.principal.subject !== session.principal.subject)
      throw new Error('operator_account_changed');
    return { session: current, organizations };
  }

  async authorizeFresh(openBrowser: (url: string) => Promise<void>, signal: AbortSignal): Promise<OperatorSession> {
    const sessions = new MemoryOperatorSessionStore();
    const temporary = this.createCore(sessions);
    const session = await this.authorize(openBrowser, signal, temporary);
    signal.throwIfAborted();
    const current = await sessions.load() ?? session;
    signal.throwIfAborted();
    await temporary.listOrganizations();
    signal.throwIfAborted();
    const refreshed = await sessions.load() ?? current;
    signal.throwIfAborted();
    if (refreshed.principal.issuer !== current.principal.issuer || refreshed.principal.subject !== current.principal.subject)
      throw new Error('operator_account_changed');
    return refreshed;
  }

  async enroll(session: OperatorSession): Promise<void> { this.renewIfRetired(); await this.store.enroll(session); }

  async activate(subject: string): Promise<void> {
    this.renewIfRetired();
    await this.store.activate(subject);
    this.store.retire();
    this.renew();
  }

  async authorize(openBrowser: (url: string) => Promise<void>, signal: AbortSignal, core = this.activeCore): Promise<OperatorSession> {
    this.configuration.scopes = ['openid', 'profile', 'offline_access'];
    const attempt = async () => {
      const callbackUrl = await waitForCallback(async (redirectUri) => {
        if (this.pendingAuthorization) await untilCanceled(this.pendingAuthorization.catch(() => undefined), signal);
        signal.throwIfAborted();
        this.configuration.redirectUri = redirectUri;
        const pending = core.auth.beginAuthorizationCode();
        this.pendingAuthorization = pending;
        const started = await untilCanceled(pending, signal);
        signal.throwIfAborted();
        return started.authorizationUrl;
      }, openBrowser, signal);
      return core.auth.completeAuthorizationCode(callbackUrl) as Promise<OperatorSession>;
    };
    try { return await attempt(); }
    catch (error) {
      if (!(error instanceof Error) || (error.message !== 'invalid_scope' && !('code' in error && error.code === 'invalid_scope'))) throw error;
      this.configuration.scopes = ['openid', 'profile'];
      return attempt();
    }
  }

  private createCore(sessions: OperatorSessionStore = this.store): NodeIntegrationCore {
    return createNodeIntegrationCore({
      apiUrl: this.apiUrl,
      business: true,
      environment: this.environment,
      liveConfirmation: this.environment,
      masterKey: {},
      configuration: this.configuration,
      sessions,
    });
  }
}
