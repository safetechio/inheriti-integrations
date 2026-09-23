import { BUSINESS_DEPLOYMENTS, BUSINESS_INTERACTIVE_CLIENT_ID, createNodeIntegrationCore } from '@safetech/inheriti-elements-core/node';
import type { BusinessOrganization, NodeIntegrationCore } from '@safetech/inheriti-elements-core/node';
import { createServer } from 'node:http';

export type Deployment = keyof typeof BUSINESS_DEPLOYMENTS;
export type TrayState = {
  status: 'signed-out' | 'authorizing' | 'signed-in' | 'error';
  message?: string;
  organizations: { id: string; name: string }[];
  selectedId?: string;
};

export class TraySession {
  private readonly core: NodeIntegrationCore;
  private organizations: BusinessOrganization[] = [];
  private selectedId: string | undefined;
  private status: TrayState['status'] = 'signed-out';
  private message: string | undefined;
  private authorization: AbortController | undefined;
  private pendingSignIn: Promise<void> | undefined;

  constructor(deployment: Deployment) {
    const config = BUSINESS_DEPLOYMENTS[deployment];
    this.core = createNodeIntegrationCore({
      apiUrl: config.apiUrl,
      business: true,
      environment: config.environment,
      liveConfirmation: config.environment,
      masterKey: {},
      configuration: {
        issuer: config.issuer,
        clientId: BUSINESS_INTERACTIVE_CLIENT_ID,
        audience: 'inheriti-integrations-api',
        environment: config.environment,
        redirectUri: 'http://127.0.0.1:53682/oauth/callback',
        scopes: ['openid'],
      },
    });
  }

  state(): TrayState {
    return {
      status: this.status,
      ...(this.message ? { message: this.message } : {}),
      organizations: this.organizations.map(({ id, name }) => ({ id, name })),
      ...(this.selectedId ? { selectedId: this.selectedId } : {}),
    };
  }

  signIn(onChange: () => void, openBrowser: (url: string) => Promise<void>): Promise<void> {
    if (this.pendingSignIn) return this.pendingSignIn;
    const pending = this.runSignIn(onChange, openBrowser);
    this.pendingSignIn = pending.finally(() => { this.pendingSignIn = undefined; });
    return this.pendingSignIn;
  }

  private async runSignIn(onChange: () => void, openBrowser: (url: string) => Promise<void>): Promise<void> {
    const authorization = new AbortController();
    this.authorization = authorization;
    this.status = 'authorizing';
    this.message = undefined;
    onChange();
    try {
      const started = await untilCanceled(this.core.auth.beginAuthorizationCode(), authorization.signal);
      await this.core.auth.completeAuthorizationCode(await waitForCallback(started.authorizationUrl, openBrowser, authorization.signal));
      if (authorization.signal.aborted) return;
      await this.discover(authorization.signal);
    } catch (error) {
      if (authorization.signal.aborted) return;
      this.status = 'error';
      this.message = error instanceof Error ? error.message : 'Sign-in failed.';
    }
    if (this.authorization === authorization) this.authorization = undefined;
    onChange();
  }

  async restore(): Promise<void> {
    try {
      if (await this.core.auth.getAccessToken()) {
        await this.discover();
        return;
      }
    } catch {}
    this.organizations = [];
    this.selectedId = undefined;
    this.status = 'signed-out';
    this.message = undefined;
  }

  async select(id: string): Promise<void> {
    if (!this.organizations.some((organization) => organization.id === id)) throw new Error('organization_access_denied');
    this.selectedId = id;
  }

  async signOut(): Promise<void> {
    this.authorization?.abort();
    await this.pendingSignIn;
    this.authorization = undefined;
    await this.core.auth.clear();
    this.organizations = [];
    this.selectedId = undefined;
    this.status = 'signed-out';
    this.message = undefined;
  }

  private async discover(signal?: AbortSignal): Promise<void> {
    const organizations = await this.core.listOrganizations();
    if (signal?.aborted) return;
    this.organizations = organizations;
    if (!this.organizations.some(({ id }) => id === this.selectedId)) {
      this.selectedId = this.organizations.length === 1 ? this.organizations[0]?.id : undefined;
    }
    this.status = 'signed-in';
    this.message = this.organizations.length === 0 ? 'No Business organizations are available.' : undefined;
  }
}

function waitForCallback(authorizationUrl: string, openBrowser: (url: string) => Promise<void>, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Sign-in canceled')); return; }
    const server = createServer((request, response) => {
      let url: URL;
      try { url = new URL(request.url ?? '/', 'http://127.0.0.1:53682'); }
      catch { response.writeHead(400).end(); return; }
      if (url.pathname !== '/oauth/callback') { response.writeHead(404).end(); return; }
      server.close();
      const error = url.searchParams.get('error');
      if (error) { response.writeHead(400).end('Sign-in failed. Return to Inheriti.'); reject(new Error(error)); return; }
      if (!url.searchParams.has('code') || !url.searchParams.has('state')) { response.writeHead(400).end(); reject(new Error('Invalid sign-in callback')); return; }
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('Signed in. Return to Inheriti.');
      resolve(url.toString());
    });
    const timeout = setTimeout(() => { server.close(); reject(new Error('Sign-in timed out')); }, 300_000);
    signal.addEventListener('abort', () => { server.close(); reject(new Error('Sign-in canceled')); }, { once: true });
    server.once('close', () => clearTimeout(timeout));
    server.once('error', reject);
    server.listen(53682, '127.0.0.1', () => {
      void openBrowser(authorizationUrl).catch((error: unknown) => { server.close(); reject(error); });
    });
  });
}

function untilCanceled<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('Sign-in canceled'));
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new Error('Sign-in canceled'));
    signal.addEventListener('abort', cancel, { once: true });
    void operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
  });
}
