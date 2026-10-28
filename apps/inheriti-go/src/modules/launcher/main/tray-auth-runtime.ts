import { BUSINESS_INTERACTIVE_CLIENT_ID, createNodeIntegrationCore } from '@safetech/inheriti-elements-core/node';
import type { NodeIntegrationCore, NodeIntegrationCoreOptions, OperatorSession } from '@safetech/inheriti-elements-core/node';
import { waitForCallback, untilCanceled } from '../../auth/main/oauth-callback.js';
import { ProtectedOperatorSessionStore } from './operator-session-store.js';

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

  renewIfRetired(): void { if (this.store.isRetired) this.renew(); }

  renew(): void {
    this.store = this.store.fork();
    this.activeCore = this.createCore();
  }

  async authorize(openBrowser: (url: string) => Promise<void>, signal: AbortSignal): Promise<OperatorSession> {
    this.configuration.scopes = ['openid', 'profile', 'offline_access'];
    const attempt = async () => {
      const callbackUrl = await waitForCallback(async (redirectUri) => {
        if (this.pendingAuthorization) await untilCanceled(this.pendingAuthorization.catch(() => undefined), signal);
        signal.throwIfAborted();
        this.configuration.redirectUri = redirectUri;
        const pending = this.activeCore.auth.beginAuthorizationCode();
        this.pendingAuthorization = pending;
        const started = await untilCanceled(pending, signal);
        signal.throwIfAborted();
        return started.authorizationUrl;
      }, openBrowser, signal);
      return this.activeCore.auth.completeAuthorizationCode(callbackUrl) as Promise<OperatorSession>;
    };
    try { return await attempt(); }
    catch (error) {
      if (!(error instanceof Error) || (error.message !== 'invalid_scope' && !('code' in error && error.code === 'invalid_scope'))) throw error;
      this.configuration.scopes = ['openid', 'profile'];
      return attempt();
    }
  }

  private createCore(): NodeIntegrationCore {
    return createNodeIntegrationCore({
      apiUrl: this.apiUrl,
      business: true,
      environment: this.environment,
      liveConfirmation: this.environment,
      masterKey: {},
      configuration: this.configuration,
      sessions: this.store,
    });
  }
}
