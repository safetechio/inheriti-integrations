import type { KeyVault, MasterKeyRef, OperatorSession } from '@safetech/inheriti-elements-core';
import type { OperatorSessionSnapshot, SessionStorageOperatorSessionStore } from './session-store.js';
import type { ChromeConfiguration } from '../shared/configuration.js';
import { MASTER_KEY_CACHE_PREFIX } from '../shared/stored-configuration.js';

export function operatorSessionIdentity(session: OperatorSession | undefined): string | undefined {
  const principal = session?.principal;
  if (!principal) return undefined;
  const identity = [principal.issuer, principal.environment, principal.authorizedParty, principal.subject, principal.sessionId];
  if (identity.some((value) => typeof value !== 'string' || value.length === 0)) return undefined;
  return JSON.stringify(identity);
}

/** Browser-session memory only; each instance remains bound to the login that created it. */
export class SessionStorageKeyVault implements KeyVault {
  private readonly identity: string | undefined;
  private readonly configuration: string;
  private readonly generation: number;

  public constructor(
    private readonly area: chrome.storage.StorageArea,
    private readonly sessions: SessionStorageOperatorSessionStore,
    configuration: ChromeConfiguration,
    snapshot: OperatorSessionSnapshot,
  ) {
    this.identity = operatorSessionIdentity(snapshot.session);
    this.generation = snapshot.generation;
    this.configuration = JSON.stringify([configuration.apiUrl, configuration.environment, configuration.issuer, configuration.clientId]);
  }

  private async storageKey(ref: MasterKeyRef): Promise<string> {
    const identity = this.identity;
    const current = await this.sessions.snapshot();
    if (!identity || this.generation !== current.generation || identity !== operatorSessionIdentity(current.session)) {
      throw new Error('master_key_session_changed');
    }
    return MASTER_KEY_CACHE_PREFIX + JSON.stringify([this.configuration, identity, this.generation, ref.system, ref.contextId]);
  }

  public async store(ref: MasterKeyRef, key: Uint8Array): Promise<void> {
    if (!(key instanceof Uint8Array) || key.length !== 32) throw new Error('invalid_master_key_material');
    const storageKey = await this.storageKey(ref);
    const value = Array.from(key, (byte) => byte.toString(16).padStart(2, '0')).join('');
    await this.area.set({ [storageKey]: value });
    try {
      await this.storageKey(ref);
    } catch (error) {
      await this.area.remove(storageKey);
      throw error;
    }
  }

  public async load(ref: MasterKeyRef): Promise<Uint8Array | undefined> {
    const storageKey = await this.storageKey(ref);
    const stored = (await this.area.get(storageKey))[storageKey];
    await this.storageKey(ref);
    if (stored === undefined) return undefined;
    if (typeof stored === 'string' && /^[0-9a-f]{64}$/i.test(stored)) {
      return Uint8Array.from(stored.match(/.{2}/g)!, (byte) => Number.parseInt(byte, 16));
    }
    await this.area.remove(storageKey);
    return undefined;
  }

  public async remove(ref: MasterKeyRef): Promise<void> {
    await this.area.remove(await this.storageKey(ref));
  }
}
