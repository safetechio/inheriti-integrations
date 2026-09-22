import type { SecretStorage } from 'vscode';
import type { OperatorSession, OperatorSessionStore } from '@safetech/inheriti-elements-core';

const SESSION_KEY = 'inheritiElements.operatorSession';

/**
 * The operator's session lives in VS Code's SecretStorage and nowhere else — never in workspace
 * settings, never in a file beside the project. A value that will not parse is discarded rather than
 * repaired: the operator signs in again, which is cheaper than trusting half a credential.
 */
export class SecretSessionStore implements OperatorSessionStore {
  public constructor(private readonly secrets: SecretStorage) {}

  public async load(): Promise<OperatorSession | undefined> {
    const value = await this.secrets.get(SESSION_KEY);
    if (value === undefined) return undefined;
    try {
      return JSON.parse(value) as OperatorSession;
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
