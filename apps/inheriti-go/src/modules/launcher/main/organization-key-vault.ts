import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ProtectedCheckpoint } from './protected-checkpoint.js';

const keyLength = 32;

type Ref = { system: string; contextId: string };

export class OrganizationKeyVault {
  private readonly checkpoint = new ProtectedCheckpoint();
  private readonly memory = new Map<string, Uint8Array>();
  private readonly operation = new AsyncLocalStorage<{ scope: string; generation: number }>();
  private scope: string | undefined;
  private generation = 0;

  constructor(private readonly deployment: string, private readonly getToken: () => Promise<string | undefined>) {}

  private async path(ref: Ref): Promise<string> {
    if (ref.system !== 'INHERITI_BUSINESS' || !ref.contextId) throw new Error('invalid_organization_key_reference');
    const active = this.operation.getStore();
    if (active) return `${active.scope}/${encodeURIComponent(ref.contextId)}`;
    const token = await this.getToken();
    return `${this.scopeForToken(token)}/${encodeURIComponent(ref.contextId)}`;
  }

  private scopeForToken(token: string | undefined): string {
    const claims = token?.split('.')[1];
    if (!claims) throw new Error('reauthentication_required');
    let decoded: unknown;
    try { decoded = JSON.parse(Buffer.from(claims, 'base64url').toString('utf8')); }
    catch { throw new Error('reauthentication_required'); }
    if (!decoded || typeof decoded !== 'object' || !('iss' in decoded) || typeof decoded.iss !== 'string' || !decoded.iss ||
      !('sub' in decoded) || typeof decoded.sub !== 'string' || !decoded.sub) throw new Error('reauthentication_required');
    const scope = `organization-key/${this.deployment}/${createHash('sha256').update(decoded.iss).digest('hex')}/${encodeURIComponent(decoded.sub)}`;
    if (this.scope !== undefined && this.scope !== scope) this.clearMemory();
    this.scope = scope;
    return scope;
  }

  async store(ref: Ref, key: Uint8Array): Promise<void> {
    if (key.length !== keyLength) throw new Error('invalid_organization_key');
    const active = this.operation.getStore();
    if (active && active.generation !== this.generation) throw new Error('organization_key_request_canceled');
    const path = await this.path(ref);
    if (active && active.generation !== this.generation) throw new Error('organization_key_request_canceled');
    const owned = key.slice();
    if (this.checkpoint.isAvailable()) {
      try { this.checkpoint.setItem(path, Buffer.from(owned).toString('base64')); }
      catch (error) { owned.fill(0); this.memory.get(path)?.fill(0); this.memory.delete(path); throw error; }
    }
    this.memory.get(path)?.fill(0);
    this.memory.set(path, owned);
  }

  async load(ref: Ref): Promise<Uint8Array | undefined> {
    const active = this.operation.getStore();
    const path = await this.path(ref);
    if (active && active.generation !== this.generation) throw new Error('organization_key_request_canceled');
    const cached = this.memory.get(path);
    if (cached) return cached.slice();
    if (!this.checkpoint.isAvailable()) return undefined;
    const encoded = this.checkpoint.getItem<string>(path);
    if (encoded === null) return undefined;
    if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/.test(encoded)) throw new Error('invalid_organization_key');
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== keyLength || key.toString('base64') !== encoded) throw new Error('invalid_organization_key');
    const owned = new Uint8Array(key);
    this.memory.set(path, owned);
    return owned.slice();
  }

  async remove(ref: Ref): Promise<void> {
    const path = await this.path(ref);
    this.memory.get(path)?.fill(0);
    this.memory.delete(path);
    if (this.checkpoint.isAvailable()) this.checkpoint.removeItem(path);
  }

  clearMemory(): void {
    this.generation += 1;
    for (const key of this.memory.values()) key.fill(0);
    this.memory.clear();
  }

  async forgetAccount(): Promise<void> {
    let scope: string | undefined;
    try {
      const path = await this.path({ system: 'INHERITI_BUSINESS', contextId: '_' });
      scope = path.slice(0, path.lastIndexOf('/') + 1);
    }
    catch (error) {
      if (error instanceof Error && error.message === 'reauthentication_required') scope = this.scope && `${this.scope}/`;
      else throw error;
    }
    this.clearMemory();
    if (!scope) return;
    if (!this.checkpoint.isAvailable()) {
      if (!this.checkpoint.hasFile()) return;
      throw new Error('protected_storage_unavailable');
    }
    this.checkpoint.clean(scope);
  }

  async withScope<T>(run: () => Promise<T>): Promise<T> {
    const started = this.generation;
    const token = await this.getToken();
    if (started !== this.generation) throw new Error('organization_key_request_canceled');
    const scope = this.scopeForToken(token);
    return this.operation.run({ scope, generation: this.generation }, run);
  }
}
