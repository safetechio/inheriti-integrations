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
      scopes: ['openid', 'profile'],
    };
    this.store = new ProtectedOperatorSessionStore(deployment, issuer, { apiUrl, audience: this.configuration.audience, clientId: this.configuration.clientId, environment });
    this.activeCore = this.createCore();
  }

  get core(): NodeIntegrationCore { return this.activeCore; }
  get sessions(): ProtectedOperatorSessionStore { return this.store; }
  getAccessToken(): Promise<string | undefined> { return this.activeCore.auth.getAccessToken(); }
  async currentRole(organizationId: string): Promise<string | undefined> {
    const token = await this.getAccessToken();
    if (!token) return undefined;
    const response = await fetch(new URL('v1/organizations', this.apiUrl), {
      headers: { authorization: `Bearer ${token}`, 'x-elements-environment': this.environment },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return undefined;
    const body: unknown = await response.json();
    const result = body && typeof body === 'object' && 'result' in body ? body.result : undefined;
    const items = result && typeof result === 'object' && 'items' in result ? result.items : undefined;
    if (!Array.isArray(items)) return undefined;
    const organization = items.find((item) => item && typeof item === 'object' && item.id === organizationId);
    return typeof organization?.roleName === 'string' ? organization.roleName.slice(0, 80) : undefined;
  }
  accountSummaries(): Promise<{ accounts: SavedAccountSummary[]; activeSubject: string | undefined }> { return this.store.accountSummaries(); }
  async accountIdentity(subject: string): Promise<{ name?: string; email?: string } | undefined> {
    const summary = await this.store.accountSummaries();
    if (!summary.accounts.some((account) => account.subject === subject && account.status === 'ready')) return undefined;
    const profile = this.store.profileForIdentity(subject);
    if (!profile) return undefined;
    if (profile.name && profile.email) return { name: profile.name, email: profile.email };
    if (profile.expiresAt <= Date.now()) return { ...(profile.name ? { name: profile.name } : {}), ...(profile.email ? { email: profile.email } : {}) };
    const response = await fetch(new URL('v1/importer/profile', this.apiUrl), {
      headers: { authorization: `Bearer ${profile.accessToken}`, 'x-elements-environment': this.environment },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { ...(profile.name ? { name: profile.name } : {}), ...(profile.email ? { email: profile.email } : {}) };
    const body: unknown = await response.json();
    const result = body && typeof body === 'object' && 'result' in body ? body.result : undefined;
    const fields = result && typeof result === 'object' ? result as Record<string, unknown> : {};
    const name = [fields.firstName, fields.lastName].filter((part): part is string => typeof part === 'string' && !!part.trim()).map((part) => part.trim()).join(' ').slice(0, 160) || profile.name;
    const email = typeof fields.email === 'string' && fields.email.trim() ? fields.email.trim().slice(0, 320) : profile.email;
    const identity = { ...(name ? { name } : {}), ...(email ? { email } : {}) };
    this.store.saveProfileIdentity(subject, profile.generation, identity);
    return identity;
  }

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

  async clearAll(additionalScopes: string[]): Promise<void> {
    this.renewIfRetired();
    const sessions = await this.store.allSessions();
    try {
      for (const session of sessions) {
        const store = new MemoryOperatorSessionStore();
        await store.save(session);
        try { await this.createCore(store).auth.clear(); } catch {}
      }
    } finally {
      await this.store.clearAll(additionalScopes);
      this.renew();
    }
  }

  async remove(subject: string): Promise<void> {
    this.renewIfRetired();
    const session = (await this.store.allSessions()).find((item) => item.principal.subject === subject);
    if (session) {
      const sessions = new MemoryOperatorSessionStore();
      await sessions.save(session);
      try { await this.createCore(sessions).auth.clear(); } catch { /* Local removal still completes when revocation is unavailable. */ }
    }
    await this.store.remove(subject);
  }

  async activate(subject: string): Promise<void> {
    this.renewIfRetired();
    await this.store.activate(subject);
    this.store.retire();
    this.renew();
  }

  async authorize(openBrowser: (url: string) => Promise<void>, signal: AbortSignal, core = this.activeCore): Promise<OperatorSession> {
    this.configuration.scopes = ['openid', 'profile'];
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
    return attempt();
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
