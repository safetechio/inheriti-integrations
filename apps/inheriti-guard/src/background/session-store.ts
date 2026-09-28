import type { OperatorSession, OperatorSessionStore } from '@safetech/inheriti-elements-core';
import { MASTER_KEY_CACHE_PREFIX } from '../shared/stored-configuration.js';
import { operatorSessionIdentity } from './session-key-vault.js';

const SESSION_KEY = 'inheriti.operatorSession';
const GENERATION_KEY = 'inheriti.operatorSessionGeneration';

export interface OperatorSessionSnapshot { session: OperatorSession | undefined; generation: number }

/**
 * `chrome.storage.session` and nothing else.
 *
 * It is memory-backed, cleared when the browser closes, and — unlike `local` — is not readable from a
 * content script, so a hostile page cannot reach the operator's tokens. `local` would survive on disk
 * and be reachable by anything with storage access, which is why it is deliberately not used.
 */
export class SessionStorageOperatorSessionStore implements OperatorSessionStore {
  public constructor(private readonly area: chrome.storage.StorageArea) {}

  public async snapshot(): Promise<OperatorSessionSnapshot> {
    const stored = await this.area.get([SESSION_KEY, GENERATION_KEY]);
    const storedGeneration = stored[GENERATION_KEY];
    const generation = typeof storedGeneration === 'number' && Number.isSafeInteger(storedGeneration) && storedGeneration >= 0
      ? storedGeneration : 0;
    const value = stored[SESSION_KEY];
    if (typeof value !== 'string') return { session: undefined, generation };
    try {
      return { session: JSON.parse(value) as OperatorSession, generation };
    } catch {
      await this.clear();
      return { session: undefined, generation };
    }
  }

  public async load(): Promise<OperatorSession | undefined> {
    return (await this.snapshot()).session;
  }

  public async save(session: OperatorSession): Promise<void> {
    if (operatorSessionIdentity(await this.load()) !== operatorSessionIdentity(session)) await this.clear();
    await this.area.set({ [SESSION_KEY]: JSON.stringify(session) });
  }

  public async clear(): Promise<void> {
    const storedGeneration = (await this.area.get(GENERATION_KEY))[GENERATION_KEY];
    const generation = typeof storedGeneration === 'number' && Number.isSafeInteger(storedGeneration) && storedGeneration >= 0
      ? storedGeneration : 0;
    await this.area.set({ [GENERATION_KEY]: generation + 1, [SESSION_KEY]: null });
    await this.area.remove(SESSION_KEY);
    const stored = await this.area.get(null);
    const keys = Object.keys(stored).filter((key) => key.startsWith(MASTER_KEY_CACHE_PREFIX));
    if (keys.length > 0) await this.area.remove(keys);
  }
}
