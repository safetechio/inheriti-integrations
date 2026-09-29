import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { KeyVault, MasterKeyRef, OperatorSession } from '@safetech/inheriti-elements-core';

export function sessionIdentity(session: OperatorSession): string {
  const principal = session.principal;
  return digest([principal.issuer, principal.environment, principal.authorizedParty, principal.subject, principal.sessionId]);
}

function digest(parts: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

export class CliKeyVault implements KeyVault {
  private readonly service: string;
  private readonly memory = new Map<string, Uint8Array>();
  private identity: string | undefined;
  unavailable = false;

  constructor(sessionPath: string, apiUrl: string, environment: string, private readonly session: () => Promise<OperatorSession | undefined>) {
    this.service = `inheriti-cli:${digest([resolve(sessionPath), apiUrl, environment])}`;
  }

  private async account(ref: MasterKeyRef): Promise<string | undefined> {
    const session = await this.session();
    if (!session) return undefined;
    const identity = sessionIdentity(session);
    this.identity ??= identity;
    if (this.identity !== identity) throw Object.assign(new Error('operator_session_changed'), { code: 'operator_session_changed' });
    return `${identity}:${ref.system}:${ref.contextId}`;
  }

  async load(ref: MasterKeyRef): Promise<Uint8Array | undefined> {
    const account = await this.account(ref);
    if (!account) return undefined;
    const held = this.memory.get(account);
    if (held) return held.slice();
    try {
      const { AsyncEntry } = await import('@napi-rs/keyring');
      const value = await new AsyncEntry(this.service, account, { linux: { store: 'secret-service' } }).getPassword();
      this.unavailable = false;
      if (!value) return undefined;
      if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error('invalid_cached_key');
      const bytes = Uint8Array.from(Buffer.from(value, 'hex'));
      this.memory.set(account, bytes);
      return bytes.slice();
    } catch {
      this.unavailable = true;
      return undefined;
    }
  }

  async store(ref: MasterKeyRef, key: Uint8Array): Promise<void> {
    if (key.length !== 32) throw new Error('invalid_master_key_material');
    const account = await this.account(ref);
    if (!account) return;
    const owned = key.slice();
    this.memory.get(account)?.fill(0);
    this.memory.set(account, owned);
    try {
      const { AsyncEntry } = await import('@napi-rs/keyring');
      await new AsyncEntry(this.service, account, { linux: { store: 'secret-service' } }).setPassword(Buffer.from(key).toString('hex'));
      this.unavailable = false;
    } catch {
      this.unavailable = true;
    }
  }

  async remove(ref: MasterKeyRef): Promise<void> {
    const account = await this.account(ref);
    if (!account) return;
    this.memory.get(account)?.fill(0);
    this.memory.delete(account);
    try {
      const { AsyncEntry } = await import('@napi-rs/keyring');
      await new AsyncEntry(this.service, account, { linux: { store: 'secret-service' } }).deletePassword();
    } catch (cause) {
      throw Object.assign(new Error('master_key_cache_clear_failed', { cause }), { code: 'master_key_cache_clear_failed' });
    }
  }

  async clear(): Promise<void> {
    for (const key of this.memory.values()) key.fill(0);
    this.memory.clear();
    try {
      const { AsyncEntry, findCredentialsAsync } = await import('@napi-rs/keyring');
      for (const credential of await findCredentialsAsync(this.service)) {
        await new AsyncEntry(this.service, credential.account, { linux: { store: 'secret-service' } }).deletePassword();
      }
    } catch (cause) {
      throw Object.assign(new Error('master_key_cache_clear_failed', { cause }), { code: 'master_key_cache_clear_failed' });
    }
  }
}
