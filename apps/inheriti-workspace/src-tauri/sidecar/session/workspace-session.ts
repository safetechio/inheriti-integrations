import { BUSINESS_DEPLOYMENTS, BUSINESS_INTERACTIVE_CLIENT_ID } from '../../../../../packages/core/src/deployment.js';
import { createNodeIntegrationCore } from '../../../../../packages/core/src/node-base.js';
import type { BusinessOrganization, NodeIntegrationCore, NodeIntegrationCoreOptions } from '../../../../../packages/core/src/node-base.js';
import HttpElementsApiPort from '../../../../../../inheriti-client-sdk/sdk/src/elements/http-elements-api-port.js';
import type { FileAccessStatus } from '../../../../../../inheriti-client-sdk/sdk/src/elements/elements-api-port.js';
import { inspectStartupFileAccess, openStartupFileAccess } from '../access/file-access.js';
import { openSystemBrowser, waitForOAuthCallback } from './oauth-callback.js';
import { WorkspaceOperatorSessionStore } from './operator-session-store.js';

export type WorkspaceCore = Pick<NodeIntegrationCore, 'auth' | 'listOrganizations'>;
export type WorkspaceApi = Pick<HttpElementsApiPort, 'getFileAccess' | 'requestFileAccessOpening' | 'readFileAccessOpening' | 'confirmFileAccessDelivery'>;
export type WorkspaceDeployment = keyof typeof BUSINESS_DEPLOYMENTS;

/** Operator lifecycle and organization selection. File access is delegated to access/. */
export class WorkspaceSession {
  private readonly core: WorkspaceCore;
  private readonly apiForOrganization: (organizationId: string) => WorkspaceApi;
  private readonly configuration: NodeIntegrationCoreOptions['configuration'];
  private readonly sessions: WorkspaceOperatorSessionStore;
  private organizations: BusinessOrganization[] = [];
  private selectedId: string | undefined;
  private signInPending: Promise<void> | undefined;
  private authorization: AbortController | undefined;
  private opening: AbortController | undefined;

  constructor(deployment: WorkspaceDeployment, dependencies?: {
    core: WorkspaceCore;
    apiForOrganization: (organizationId: string) => WorkspaceApi;
    configuration: NodeIntegrationCoreOptions['configuration'];
    waitForCallback?: typeof waitForOAuthCallback;
    openBrowser?: typeof openSystemBrowser;
  }, private readonly startupPath?: string) {
    const config = BUSINESS_DEPLOYMENTS[deployment];
    const configuration = dependencies?.configuration ?? {
      issuer: config.issuer,
      clientId: BUSINESS_INTERACTIVE_CLIENT_ID,
      audience: 'inheriti-integrations-api',
      environment: config.environment,
      redirectUri: 'http://127.0.0.1/oauth/callback',
      scopes: ['openid', 'profile'],
    };
    this.configuration = configuration;
    this.sessions = new WorkspaceOperatorSessionStore(deployment, configuration.issuer);
    this.core = dependencies?.core ?? createNodeIntegrationCore({
      apiUrl: config.apiUrl,
      business: true,
      environment: config.environment,
      liveConfirmation: config.environment,
      masterKey: {},
      configuration,
      sessions: this.sessions,
    });
    this.apiForOrganization = dependencies?.apiForOrganization ?? ((organizationId) => new HttpElementsApiPort(
      config.apiUrl,
      config.environment,
      async () => (await this.core.auth.getAccessToken()) ?? null,
      globalThis.fetch.bind(globalThis),
      { organizationId },
    ));
    this.waitForCallback = dependencies?.waitForCallback ?? waitForOAuthCallback;
    this.openBrowser = dependencies?.openBrowser ?? openSystemBrowser;
  }

  private readonly waitForCallback: typeof waitForOAuthCallback;
  private readonly openBrowser: typeof openSystemBrowser;

  async status(): Promise<{ signedIn: boolean; selectedOrganizationId?: string }> {
    const signedIn = !!(await this.core.auth.getAccessToken());
    return signedIn ? { signedIn, ...(this.selectedId ? { selectedOrganizationId: this.selectedId } : {}) } : { signedIn };
  }

  async signIn(): Promise<void> {
    await this.authorize();
    try { await this.sessions.clearSignedOut(); }
    catch { /* The validated session still works; a saved sign-out only disables future silent SSO. */ }
  }

  async signOut(): Promise<void> {
    this.cancel();
    await this.signInPending?.catch(() => undefined);
    try {
      await this.core.auth.clear();
      await this.sessions.markSignedOut();
    }
    finally {
      this.organizations = [];
      this.selectedId = undefined;
    }
  }

  async tryBrowserSignIn(): Promise<boolean> {
    if (await this.core.auth.getAccessToken()) return true;
    if (await this.sessions.wasSignedOut()) return false;
    const pending = this.authorize('none');
    const timeout = setTimeout(() => this.authorization?.abort(), 30_000);
    try {
      await pending;
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async authorize(prompt?: 'none'): Promise<void> {
    if (this.signInPending) return this.signInPending;
    const authorization = new AbortController();
    this.authorization = authorization;
    const pending = this.waitForCallback(async (redirectUri) => {
      this.configuration.redirectUri = redirectUri;
      const started = await this.core.auth.beginAuthorizationCode(prompt ? { prompt } : undefined);
      return started.authorizationUrl;
    }, this.openBrowser, authorization.signal).then(async (callback) => {
      await this.core.auth.completeAuthorizationCode(callback);
      this.organizations = await this.core.listOrganizations();
      this.selectedId = undefined;
    });
    this.signInPending = pending.finally(() => {
      this.signInPending = undefined;
      this.authorization = undefined;
    });
    return this.signInPending;
  }

  cancel(): void { this.authorization?.abort(); this.opening?.abort(); }

  async listOrganizations(): Promise<BusinessOrganization[]> {
    await this.requireSignIn();
    this.organizations = await this.core.listOrganizations();
    if (this.selectedId && !this.organizations.some(({ id }) => id === this.selectedId)) this.selectedId = undefined;
    return this.organizations.map(({ id, name }) => ({ id, name }));
  }

  async selectOrganization(id: string): Promise<void> {
    await this.requireSignIn();
    if (!this.organizations.some((organization) => organization.id === id)) throw new Error('organization_access_denied');
    this.selectedId = id;
  }

  async getFileAccess(copyId: string): Promise<FileAccessStatus> {
    await this.requireSignIn();
    if (!this.selectedId) throw new Error('organization_required');
    return this.apiForOrganization(this.selectedId).getFileAccess(copyId);
  }

  /** Resolve access against the currently selected organization; raw file bytes stay in access. */
  async inspectStartupFile(): Promise<FileAccessStatus> {
    await this.requireSignIn();
    if (!this.selectedId) throw new Error('organization_required');
    return inspectStartupFileAccess(this.startupPath, this.apiForOrganization(this.selectedId));
  }

  /** Coordinate one opening while access enforces file and delivery policy. */
  async openStartupFile(delivery: 'REVEAL' | 'MOBILE' = 'MOBILE', onPairingCode?: (code: string) => void): Promise<{ mimeType: 'text/plain' | 'image/webp' | 'application/pdf'; contentBase64: string; expiresAt: string | null }> {
    await this.requireSignIn();
    if (!this.selectedId) throw new Error('organization_required');
    if (this.opening) throw new Error('opening_in_progress');
    const abort = new AbortController();
    this.opening = abort;
    try {
      return await openStartupFileAccess(this.startupPath, this.apiForOrganization(this.selectedId), delivery, abort.signal, onPairingCode);
    } finally {
      if (this.opening === abort) this.opening = undefined;
    }
  }

  private async requireSignIn(): Promise<void> {
    if (!(await this.core.auth.getAccessToken())) throw new Error('sign_in_required');
  }
}
