import { createHash, generateKeyPairSync } from 'node:crypto';
import { hostname } from 'node:os';
import { app } from 'electron';
import { ProtectedCheckpoint } from '../../launcher/main/protected-checkpoint.js';
import type { InboxLocalIdentity } from '@safetech/inheriti-elements-core/node';

type StoredIdentity = {
  encryptionPrivateKey: string;
  signingPrivateKey: string;
  encryptionPublicKey: string;
  signingPublicKey: string;
  signingKeyFingerprint: string;
};

export type InboxIdentityState = { status: 'unavailable' | 'ready' | 'missing' | 'preparing' | 'error'; message?: string; memberId?: string };

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
    case 'inbox_identity_replacement_required': return 'This Inbox identity was revoked. Replace it to use Secure Inbox on this device.';
    case 'inbox_identity_recovery_required': return 'This account has an Inbox identity on another device or session. Recovery is required.';
    default: return 'Could not prepare Secure Inbox. Sign in and try again.';
  }
}

export class TrayInboxIdentity {
  private readonly checkpoint = new ProtectedCheckpoint();
  private status: InboxIdentityState = { status: 'missing' };
  private pending: Promise<InboxIdentityState> | undefined;
  private pendingOrganization: string | undefined;
  private requestAbort: AbortController | undefined;
  private generation = 0;

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
  cancelOperation(): void { if (!this.pending) this.requestAbort?.abort(); }
  clear(): void {
    this.generation += 1;
    this.requestAbort?.abort();
    this.requestAbort = undefined;
    this.pending = undefined;
    this.pendingOrganization = undefined;
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
    if (this.status.status !== 'ready' || this.pending || this.requestAbort) throw new Error('inbox_identity_not_ready');
    const abort = new AbortController();
    this.requestAbort = abort;
    try {
      const bearer = await this.token();
      abort.signal.throwIfAborted();
      if (!bearer) throw new Error('reauthentication_required');
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
    }
  }

  prepare(organizationId: string): Promise<InboxIdentityState> {
    if (this.requestAbort && !this.pending) throw new Error('inbox_identity_in_progress');
    if (this.pending) {
      if (this.pendingOrganization !== organizationId) throw new Error('inbox_identity_in_progress');
      return this.pending;
    }
    const generation = this.generation;
    const abort = new AbortController();
    this.requestAbort = abort;
    this.pendingOrganization = organizationId;
    this.set({ status: 'preparing', message: 'Securing this device…' }, generation);
    const pending = this.runPrepare(organizationId, generation, abort.signal);
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

  private async runPrepare(organizationId: string, generation: number, signal: AbortSignal): Promise<InboxIdentityState> {
    if (!this.checkpoint.isAvailable()) return this.set({ status: 'unavailable', message: 'Secure local storage is unavailable.' }, generation);
    try {
      const bearer = await this.token();
      signal.throwIfAborted();
      if (!bearer) throw new Error('reauthentication_required');
      const path = this.identityPath(bearer, organizationId);
      let identity = this.checkpoint.getItem<StoredIdentity>(path);
      const current = await this.request('GET', 'devices/me', bearer, organizationId, signal);
      signal.throwIfAborted();
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
      return this.set({ status: 'error', message: preparationError(error) }, generation);
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
