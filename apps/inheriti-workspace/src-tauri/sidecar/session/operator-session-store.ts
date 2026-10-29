/** Persist only the operator credential in the OS keyring; fail closed on sign-out state. */
import { createHash } from 'node:crypto';
import type { OperatorSession, OperatorSessionStore } from '../../../../../packages/core/src/node-base.js';

export class WorkspaceOperatorSessionStore implements OperatorSessionStore {
  private readonly account: string;
  private memory: OperatorSession | undefined;

  constructor(deployment: string, private readonly issuer: string) {
    this.account = createHash('sha256').update(JSON.stringify([deployment, issuer])).digest('hex');
  }

  async load(): Promise<OperatorSession | undefined> {
    if (this.memory) return this.memory;
    let value: string | null | undefined;
    try {
      value = await this.entry().then((entry) => entry.getPassword());
    } catch { return undefined; }
    if (!value) return undefined;
    let stored: unknown;
    try { stored = JSON.parse(value); } catch { stored = undefined; }
    if (!this.valid(stored)) {
      await this.clear();
      await this.markSignedOut();
      return undefined;
    }
    this.memory = stored;
    return stored;
  }

  async save(session: OperatorSession): Promise<void> {
    if (!this.valid(session)) throw new Error('invalid_operator_session');
    try { await this.entry().then((entry) => entry.setPassword(JSON.stringify(session))); }
    catch { /* Secure storage unavailable: keep this process's session only. */ }
    this.memory = session;
  }

  async clear(): Promise<void> {
    this.memory = undefined;
    try {
      const entry = await this.entry();
      if (await entry.getPassword()) await entry.deletePassword();
    } catch {
      throw new Error('operator_session_clear_failed');
    }
  }

  async wasSignedOut(): Promise<boolean> {
    try { return (await this.entry('signed-out').then((entry) => entry.getPassword())) === '1'; }
    catch { return true; }
  }

  async markSignedOut(): Promise<void> {
    try { await this.entry('signed-out').then((entry) => entry.setPassword('1')); }
    catch { throw new Error('operator_sign_out_marker_failed'); }
  }

  async clearSignedOut(): Promise<void> {
    try {
      const entry = await this.entry('signed-out');
      if (await entry.getPassword()) await entry.deletePassword();
    } catch { throw new Error('operator_sign_out_marker_clear_failed'); }
  }

  private async entry(suffix?: 'signed-out') {
    const { AsyncEntry } = await import('@napi-rs/keyring');
    return new AsyncEntry('inheriti-viewer:operator-session', suffix ? `${this.account}:${suffix}` : this.account, { linux: { store: 'secret-service' } });
  }

  private valid(value: unknown): value is OperatorSession {
    if (!value || typeof value !== 'object') return false;
    const session = value as Partial<OperatorSession>;
    return session.kind === 'business' && session.principal?.issuer === this.issuer && typeof session.principal.subject === 'string' && !!session.principal.subject &&
      typeof session.familyId === 'string' && !!session.familyId &&
      typeof session.accessToken === 'string' && !!session.accessToken && session.tokenType === 'Bearer' &&
      typeof session.expiresAt === 'number' && Number.isFinite(session.expiresAt) &&
      typeof session.sessionExpiresAt === 'number' && Number.isFinite(session.sessionExpiresAt) &&
      typeof session.refreshToken === 'string' && !!session.refreshToken &&
      !('idToken' in session) && !('refreshExpiresAt' in session);
  }
}
