import type { OperatorSession, OperatorSessionStore } from '@safetech/inheriti-elements-core';

const SESSION_KEY = 'inheritiElements.operatorSession';

/**
 * `chrome.storage.session` and nothing else.
 *
 * It is memory-backed, cleared when the browser closes, and — unlike `local` — is not readable from a
 * content script, so a hostile page cannot reach the operator's tokens. `local` would survive on disk
 * and be reachable by anything with storage access, which is why it is deliberately not used.
 */
export class SessionStorageOperatorSessionStore implements OperatorSessionStore {
  public constructor(private readonly area: chrome.storage.StorageArea) {}

  public async load(): Promise<OperatorSession | undefined> {
    const stored = await this.area.get(SESSION_KEY);
    const value = stored[SESSION_KEY];
    if (typeof value !== 'string') return undefined;
    try {
      return JSON.parse(value) as OperatorSession;
    } catch {
      await this.clear();
      return undefined;
    }
  }

  public async save(session: OperatorSession): Promise<void> {
    await this.area.set({ [SESSION_KEY]: JSON.stringify(session) });
  }

  public async clear(): Promise<void> {
    await this.area.remove(SESSION_KEY);
  }
}
