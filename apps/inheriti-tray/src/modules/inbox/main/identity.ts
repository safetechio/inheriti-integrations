import { createHash, generateKeyPairSync } from 'node:crypto';
import { hostname } from 'node:os';
import { app } from 'electron';
import { ProtectedCheckpoint } from '../../launcher/main/protected-checkpoint.js';
import type { InboxLocalIdentity } from '@safetech/inheriti-elements-core/inbox';

type StoredIdentity = {
  encryptionPrivateKey: string;
  signingPrivateKey: string;
  encryptionPublicKey: string;
  signingPublicKey: string;
  signingKeyFingerprint: string;
};
type StagedReplacement = { identity: StoredIdentity; expectedSigningFingerprint: string };

export type InboxIdentityState = { status: 'unavailable' | 'ready' | 'missing' | 'preparing' | 'replacement_required' | 'error'; message?: string; memberId?: string };

function tokenScope(token: string): { subject: string; family: string } {
  const segment = token.split('.')[1];
  if (!segment) throw new Error('reauthentication_required');
  const claims: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  if (!claims || typeof claims !== 'object' || !('sub' in claims) || typeof claims.sub !== 'string' || !claims.sub) throw new Error('reauthentication_required');
  if (!('iss' in claims) || typeof claims.iss !== 'string' || !claims.iss) throw new Error('inbox_issuer_unavailable');
  // The issuer + subject is the stable account family; OIDC sid changes on a new login.
  return { subject: claims.sub, family: createHash('sha256').update(claims.iss).digest('hex') };
}

function generateIdentity(): StoredIdentity {
  const encryption = generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 0x10001 });
  const signing = generateKeyPairSync('ed25519');
  const encryptionPublicKey = encryption.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const signingPublicKey = signing.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  return {
    encryptionPrivateKey: encryption.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    signingPrivateKey: signing.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    encryptionPublicKey,
    signingPublicKey,
    signingKeyFingerprint: createHash('sha256').update(Buffer.from(signingPublicKey, 'base64')).digest('hex'),
  };
}

function preparationError(error: unknown): string {
  if (error instanceof Error && error.name === 'MasterKeyRequired')
    return 'This account cannot open the organization key yet. Ask an owner or manager to share it, then claim it in SafeKey Mobile.';
  switch (error instanceof Error ? error.message : '') {
    case 'inbox_identity_replacement_required': return 'Secure Chat access on this computer was revoked. Reset it to continue.';
    case 'inbox_identity_recovery_required': return 'This account already has different Secure Chat keys. Reset access on this computer to continue.';
    case 'inbox_identity_changed': return 'Secure Chat access on this computer changed. Check the account before trying again.';
    default: return 'Could not prepare Secure Chat. Sign in and try again.';
  }
}

export class TrayInboxIdentity {
  private readonly checkpoint = new ProtectedCheckpoint();
  private status: InboxIdentityState = { status: 'missing' };
  private pending: Promise<InboxIdentityState> | undefined;
  private pendingOrganization: string | undefined;
  private requestAbort: AbortController | undefined;
  private generation = 0;
  private operationTail: Promise<void> = Promise.resolve();
  private operationOrganization: string | undefined;

  constructor(private readonly apiUrl: string, private readonly environment: 'TEST' | 'LIVE', private readonly token: () => Promise<string | undefined>, private readonly resolveOrganizationKey?: (organizationId: string, signal: AbortSignal, onRelaySession?: () => void) => Promise<string>, private readonly onStateChange?: () => void) {}

  state(): InboxIdentityState { return this.status; }
  async registeredMemberId(organizationId: string): Promise<string | undefined> {
    if (this.status.status === 'ready') return this.status.memberId;
    if (!this.checkpoint.isAvailable()) return undefined;
    const bearer = await this.token();
    if (!bearer) return undefined;
    const identity = this.checkpoint.getItem<StoredIdentity>(this.identityPath(bearer, organizationId));
    if (!identity) return undefined;
    const current = await this.request('GET', 'devices/me', bearer, organizationId, new AbortController().signal);
    if (current === null) return undefined;
    this.assertCurrentIdentity(current, identity);
    if (!current || typeof current !== 'object' || !('memberId' in current) || typeof current.memberId !== 'string' || !current.memberId)
      throw new Error('invalid_inbox_identity_response');
    return current.memberId;
  }
  cancelOperation(): void { if (!this.pending) { this.generation += 1; this.requestAbort?.abort(); } }
  clear(): void {
    this.generation += 1;
    this.requestAbort?.abort();
    this.requestAbort = undefined;
    this.pending = undefined;
    this.pendingOrganization = undefined;
    this.operationTail = Promise.resolve();
    this.operationOrganization = undefined;
    this.status = { status: 'missing' };
  }

  cancelPreparation(): void {
    if (!this.pending) return;
    this.generation += 1;
    this.requestAbort?.abort();
    this.requestAbort = undefined;
    this.pending = undefined;
    this.pendingOrganization = undefined;
    this.status = { status: 'missing' };
    this.onStateChange?.();
  }

  async withIdentity<T>(organizationId: string, run: (identity: InboxLocalIdentity, signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.status.status !== 'ready' || this.pending || (this.operationOrganization && this.operationOrganization !== organizationId))
      throw new Error('inbox_identity_not_ready');
    const generation = this.generation;
    const queued = this.operationOrganization !== undefined;
    const bearerAtEnqueue = this.token();
    void bearerAtEnqueue.catch(() => {});
    const previous = this.operationTail;
    let release!: () => void;
    const slot = new Promise<void>((resolve) => { release = resolve; });
    this.operationTail = slot;
    this.operationOrganization = organizationId;
    await previous;
    const abort = new AbortController();
    try {
      if (generation !== this.generation || this.status.status !== 'ready' || this.pending) throw new Error('inbox_identity_not_ready');
      this.requestAbort = abort;
      const originalBearer = await bearerAtEnqueue;
      abort.signal.throwIfAborted();
      if (!originalBearer) throw new Error('reauthentication_required');
      const bearer = queued ? await this.token() : originalBearer;
      abort.signal.throwIfAborted();
      if (!bearer) throw new Error('reauthentication_required');
      if (queued) {
        const originalScope = tokenScope(originalBearer);
        const currentScope = tokenScope(bearer);
        if (originalScope.subject !== currentScope.subject || originalScope.family !== currentScope.family)
          throw new Error('inbox_identity_not_ready');
      }
      const identity = this.checkpoint.getItem<StoredIdentity>(this.identityPath(bearer, organizationId));
      const current = await this.request('GET', 'devices/me', bearer, organizationId, abort.signal);
      abort.signal.throwIfAborted();
      this.assertCurrentIdentity(current, identity);
      const device = current as { id: string; tenantId: string; memberId: string };
      if (!device.id || !device.tenantId || !device.memberId || !identity) throw new Error('invalid_inbox_identity_response');
      const result = await run({
        tenantId: device.tenantId, memberId: device.memberId, deviceId: device.id,
        encryptionPublicKey: identity.encryptionPublicKey, encryptionPrivateKey: identity.encryptionPrivateKey,
        signingPublicKey: identity.signingPublicKey, signingPrivateKey: identity.signingPrivateKey,
      }, abort.signal);
      abort.signal.throwIfAborted();
      return result;
    } finally {
      if (this.requestAbort === abort) this.requestAbort = undefined;
      if (this.operationTail === slot) this.operationOrganization = undefined;
      release();
    }
  }

  prepare(organizationId: string): Promise<InboxIdentityState> { return this.start(organizationId, false); }
  replace(organizationId: string): Promise<InboxIdentityState> {
    if (this.status.status !== 'replacement_required') throw new Error('inbox_replacement_not_required');
    return this.start(organizationId, true);
  }

  private start(organizationId: string, replace: boolean): Promise<InboxIdentityState> {
    if (this.requestAbort && !this.pending) throw new Error('inbox_identity_in_progress');
    if (this.pending) {
      if (this.pendingOrganization !== organizationId) throw new Error('inbox_identity_in_progress');
      return this.pending;
    }
    const generation = this.generation;
    const abort = new AbortController();
    this.requestAbort = abort;
    this.pendingOrganization = organizationId;
    this.set({ status: 'preparing', message: 'Securing this computer…' }, generation);
    const pending = this.runPrepare(organizationId, generation, abort.signal, replace);
    const tracked = pending.finally(() => {
      if (this.pending === tracked) {
        this.pending = undefined;
        this.pendingOrganization = undefined;
      }
      if (this.requestAbort === abort) this.requestAbort = undefined;
    });
    this.pending = tracked;
    return this.pending;
  }

  private async runPrepare(organizationId: string, generation: number, signal: AbortSignal, replace: boolean): Promise<InboxIdentityState> {
    if (!this.checkpoint.isAvailable()) return this.set({ status: 'unavailable', message: 'Secure local storage is unavailable.' }, generation);
    let replacementCompleted = false;
    try {
      const bearer = await this.token();
      signal.throwIfAborted();
      if (!bearer) throw new Error('reauthentication_required');
      const path = this.identityPath(bearer, organizationId);
      let identity = this.checkpoint.getItem<StoredIdentity>(path);
      const current = await this.request('GET', 'devices/me', bearer, organizationId, signal);
      signal.throwIfAborted();
      const stagedPath = `${path}/replacement`;
      const staged = this.checkpoint.getItem<StagedReplacement>(stagedPath);
      const replacementRegistered = staged && current && typeof current === 'object' && 'status' in current && current.status === 'ACTIVE'
        && 'signingKeyFingerprint' in current && staged.identity.signingKeyFingerprint === current.signingKeyFingerprint
        && (!('encryptionPublicKey' in current) || current.encryptionPublicKey === staged.identity.encryptionPublicKey)
        && (!('signingPublicKey' in current) || current.signingPublicKey === staged.identity.signingPublicKey);
      if (replacementRegistered && staged) {
        this.checkpoint.setItem(path, staged.identity);
        this.checkpoint.removeItem(stagedPath);
        identity = staged.identity;
        replacementCompleted = true;
      }
      if (replace && replacementRegistered && staged) {
        if (!('memberId' in current) || typeof current.memberId !== 'string' || !current.memberId) throw new Error('invalid_inbox_identity_response');
        await this.requestOrganizationKey(organizationId, generation, signal);
        signal.throwIfAborted();
        return this.set({ status: 'ready', memberId: current.memberId }, generation);
      }
      if (replace) {
        if (!current || typeof current !== 'object' || !('status' in current) || !('signingKeyFingerprint' in current)
          || typeof current.signingKeyFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(current.signingKeyFingerprint))
          throw new Error('invalid_inbox_identity_response');
        if (current.status !== 'ACTIVE' && current.status !== 'REVOKED') throw new Error('invalid_inbox_identity_response');
        if (staged && staged.expectedSigningFingerprint !== current.signingKeyFingerprint) throw new Error('inbox_identity_changed');
        if (!staged && current.status === 'ACTIVE') {
          try { this.assertCurrentIdentity(current, identity); throw new Error('inbox_replacement_not_required'); }
          catch (error) { if (!(error instanceof Error) || error.message !== 'inbox_identity_recovery_required') throw error; }
        }
        const replacement = staged ?? { identity: generateIdentity(), expectedSigningFingerprint: current.signingKeyFingerprint };
        if (!staged) this.checkpoint.setItem(stagedPath, replacement);
        const registered = await this.request('POST', 'devices/replace', bearer, organizationId, signal, {
          expectedSigningFingerprint: replacement.expectedSigningFingerprint,
          encryptionPublicKey: replacement.identity.encryptionPublicKey,
          signingPublicKey: replacement.identity.signingPublicKey,
        });
        if (!registered || typeof registered !== 'object' || !('memberId' in registered) || typeof registered.memberId !== 'string' || !registered.memberId)
          throw new Error('invalid_inbox_identity_response');
        signal.throwIfAborted();
        this.checkpoint.setItem(path, replacement.identity);
        this.checkpoint.removeItem(stagedPath);
        replacementCompleted = true;
        await this.requestOrganizationKey(organizationId, generation, signal);
        signal.throwIfAborted();
        return this.set({ status: 'ready', memberId: registered.memberId }, generation);
      }
      if (current !== null) {
        this.assertCurrentIdentity(current, identity);
        if (!current || typeof current !== 'object' || !('memberId' in current) || typeof current.memberId !== 'string' || !current.memberId) throw new Error('invalid_inbox_identity_response');
        signal.throwIfAborted();
        await this.requestOrganizationKey(organizationId, generation, signal);
        signal.throwIfAborted();
        return this.set({ status: 'ready', memberId: current.memberId }, generation);
      }
      if (!identity) {
        signal.throwIfAborted();
        identity = generateIdentity();
        signal.throwIfAborted();
        this.checkpoint.setItem(path, identity);
      }
      signal.throwIfAborted();
      const registered = await this.request('POST', 'devices', bearer, organizationId, signal, {
        encryptionPublicKey: identity.encryptionPublicKey,
        signingPublicKey: identity.signingPublicKey,
      });
      if (!registered || typeof registered !== 'object' || !('memberId' in registered) || typeof registered.memberId !== 'string' || !registered.memberId) throw new Error('invalid_inbox_identity_response');
      signal.throwIfAborted();
      await this.requestOrganizationKey(organizationId, generation, signal);
      signal.throwIfAborted();
      return this.set({ status: 'ready', memberId: registered.memberId }, generation);
    } catch (error) {
      const reason = error instanceof Error ? error.message : '';
      const replacementRequired = (replace && !replacementCompleted) || reason === 'inbox_identity_replacement_required' || reason === 'inbox_identity_recovery_required';
      return this.set({ status: replacementRequired ? 'replacement_required' : 'error', message: preparationError(error) }, generation);
    }
  }

  private async requestOrganizationKey(organizationId: string, generation: number, signal: AbortSignal): Promise<void> {
    this.set({ status: 'preparing', message: 'Contacting SafeKey Mobile for your organization key…' }, generation);
    await this.resolveOrganizationKey?.(organizationId, signal, () => {
      this.set({ status: 'preparing', message: 'Organization key request sent to SafeKey Mobile. Approve it there to continue.' }, generation);
    });
  }

  private identityPath(bearer: string, organizationId: string): string {
    const { subject, family } = tokenScope(bearer);
    const device = createHash('sha256').update(hostname()).update(app.getPath('userData')).digest('hex');
    return `inbox/identity/${this.environment}/${family}/${subject}/${organizationId}/${device}`;
  }

  private assertCurrentIdentity(current: unknown, identity: StoredIdentity | null): void {
    if (!current || typeof current !== 'object' || !('status' in current)) throw new Error('invalid_inbox_identity_response');
    if (current.status === 'REVOKED') throw new Error('inbox_identity_replacement_required');
    if (current.status !== 'ACTIVE' || !('signingKeyFingerprint' in current)) throw new Error('invalid_inbox_identity_response');
    if (!identity || current.signingKeyFingerprint !== identity.signingKeyFingerprint
      || ('encryptionPublicKey' in current && current.encryptionPublicKey !== identity.encryptionPublicKey)
      || ('signingPublicKey' in current && current.signingPublicKey !== identity.signingPublicKey)) throw new Error('inbox_identity_recovery_required');
  }

  private set(value: InboxIdentityState, generation: number): InboxIdentityState {
    if (generation === this.generation) { this.status = value; this.onStateChange?.(); }
    return this.status;
  }

  private async request(method: 'GET' | 'POST', route: string, bearer: string, organizationId: string, signal: AbortSignal, body?: object): Promise<unknown> {
    const response = await fetch(new URL(`v1/inbox/${route}`, this.apiUrl), {
      method,
      signal,
      headers: {
        authorization: `Bearer ${bearer}`,
        'x-elements-environment': this.environment,
        'x-organization-id': organizationId,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    signal.throwIfAborted();
    if (!response.ok) throw new Error(`inbox_identity_http_${response.status}`);
    const envelope: unknown = await response.json();
    signal.throwIfAborted();
    if (!envelope || typeof envelope !== 'object' || !('ok' in envelope) || envelope.ok !== true) throw new Error('invalid_inbox_identity_response');
    return 'result' in envelope ? envelope.result ?? null : null;
  }
}
