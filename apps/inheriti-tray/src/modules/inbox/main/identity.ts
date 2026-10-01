import { createHash, generateKeyPairSync } from 'node:crypto';
import { hostname } from 'node:os';
import { app } from 'electron';
import { ProtectedCheckpoint } from '../../launcher/main/protected-checkpoint.js';

type StoredIdentity = {
  encryptionPrivateKey: string;
  signingPrivateKey: string;
  encryptionPublicKey: string;
  signingPublicKey: string;
  signingKeyFingerprint: string;
};

export type InboxIdentityState = { status: 'unavailable' | 'ready' | 'missing' | 'preparing' | 'error'; message?: string };

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

  constructor(private readonly apiUrl: string, private readonly environment: 'TEST' | 'LIVE', private readonly token: () => Promise<string | undefined>, private readonly resolveOrganizationKey?: (organizationId: string, signal: AbortSignal) => Promise<string>) {}

  state(): InboxIdentityState { return this.status; }
  clear(): void {
    this.generation += 1;
    this.requestAbort?.abort();
    this.requestAbort = undefined;
    this.pending = undefined;
    this.pendingOrganization = undefined;
    this.status = { status: 'missing' };
  }

  prepare(organizationId: string): Promise<InboxIdentityState> {
    if (this.pending) {
      if (this.pendingOrganization !== organizationId) throw new Error('inbox_identity_in_progress');
      return this.pending;
    }
    const generation = this.generation;
    const abort = new AbortController();
    this.requestAbort = abort;
    this.pendingOrganization = organizationId;
    this.status = { status: 'preparing' };
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
      const { subject, family } = tokenScope(bearer);
      const device = createHash('sha256').update(hostname()).update(app.getPath('userData')).digest('hex');
      const path = `inbox/identity/${this.environment}/${family}/${subject}/${organizationId}/${device}`;
      let identity = this.checkpoint.getItem<StoredIdentity>(path);
      const current = await this.request('GET', 'devices/me', bearer, organizationId, signal);
      signal.throwIfAborted();
      if (current !== null) {
        if (!current || typeof current !== 'object' || !('status' in current)) throw new Error('invalid_inbox_identity_response');
        if (current.status === 'REVOKED') throw new Error('inbox_identity_replacement_required');
        if (current.status !== 'ACTIVE' || !('signingKeyFingerprint' in current)) throw new Error('invalid_inbox_identity_response');
        if (!identity || current.signingKeyFingerprint !== identity.signingKeyFingerprint
          || ('encryptionPublicKey' in current && current.encryptionPublicKey !== identity.encryptionPublicKey)
          || ('signingPublicKey' in current && current.signingPublicKey !== identity.signingPublicKey)) throw new Error('inbox_identity_recovery_required');
        signal.throwIfAborted();
        await this.resolveOrganizationKey?.(organizationId, signal);
        signal.throwIfAborted();
        return this.set({ status: 'ready' }, generation);
      }
      if (!identity) {
        signal.throwIfAborted();
        identity = generateIdentity();
        signal.throwIfAborted();
        this.checkpoint.setItem(path, identity);
      }
      signal.throwIfAborted();
      await this.request('POST', 'devices', bearer, organizationId, signal, {
        encryptionPublicKey: identity.encryptionPublicKey,
        signingPublicKey: identity.signingPublicKey,
      });
      signal.throwIfAborted();
      await this.resolveOrganizationKey?.(organizationId, signal);
      signal.throwIfAborted();
      return this.set({ status: 'ready' }, generation);
    } catch (error) {
      return this.set({ status: 'error', message: preparationError(error) }, generation);
    }
  }

  private set(value: InboxIdentityState, generation: number): InboxIdentityState {
    if (generation === this.generation) this.status = value;
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
