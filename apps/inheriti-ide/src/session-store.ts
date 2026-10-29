import type { SecretStorage } from 'vscode';
import type { OperatorSession, OperatorSessionStore } from '@safetech/inheriti-elements-core';
import { INTEGRATION_AUTHORITY } from '@safetech/inheriti-elements-core/node';
import type { ExtensionConfiguration } from './configuration.js';

const SESSION_KEY = 'inheriti.operatorSession';

/**
 * The operator's session lives in VS Code's SecretStorage and nowhere else — never in workspace
 * settings, never in a file beside the project. A value that will not parse is discarded rather than
 * repaired: the operator signs in again, which is cheaper than trusting half a credential.
 */
export class SecretSessionStore implements OperatorSessionStore {
  public constructor(private readonly secrets: SecretStorage, private readonly configuration?: () => ExtensionConfiguration) {}

  public async load(): Promise<OperatorSession | undefined> {
    const value = await this.secrets.get(SESSION_KEY);
    if (value === undefined) return undefined;
    try {
      const session = JSON.parse(value) as OperatorSession;
      const config = this.configuration?.();
      if (config) {
        const principal = session?.principal;
        const audience = config.business ? 'inheriti-integrations-api' : 'inheriti-elements-api';
        const modeMatches = config.business ? (INTEGRATION_AUTHORITY === 'business'
          ? session.kind === 'business' && !!session.familyId && !!session.refreshToken
            && Number.isFinite(session.sessionExpiresAt) && !('idToken' in session)
          : session.kind === 'safeid-oidc-business' && session.businessApiUrl === config.apiUrl
            && session.issuer === config.issuer && session.clientId === config.clientId
            && session.audience === audience && session.environment === config.environment && !!session.refreshToken)
          : session.kind !== 'business' && session.kind !== 'safeid-oidc-business';
        if (!modeMatches || principal?.issuer !== config.issuer || principal.environment !== config.environment
          || principal.authorizedParty !== config.clientId
          || !(Array.isArray(principal.audience) ? principal.audience.includes(audience) : principal.audience === audience)) {
          await this.clear();
          return undefined;
        }
      }
      return session;
    } catch {
      await this.clear();
      return undefined;
    }
  }

  public async save(session: OperatorSession): Promise<void> {
    await this.secrets.store(SESSION_KEY, JSON.stringify(session));
  }

  public async clear(): Promise<void> {
    await this.secrets.delete(SESSION_KEY);
  }
}
