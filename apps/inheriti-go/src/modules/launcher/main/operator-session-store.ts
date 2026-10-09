import { createHash } from 'node:crypto';
import type { OperatorSession, OperatorSessionStore } from '@safetech/inheriti-elements-core/node';
import { ProtectedCheckpoint } from './protected-checkpoint.js';

export class ProtectedOperatorSessionStore implements OperatorSessionStore {
  private readonly checkpoint = new ProtectedCheckpoint();
  private readonly path: string;
  private memory: OperatorSession | undefined;

  constructor(deployment: string, private readonly issuer: string) {
    this.path = `operator-session/${deployment}/${createHash('sha256').update(issuer).digest('hex')}`;
  }

  async load(): Promise<OperatorSession | undefined> {
    if (this.memory) return this.memory;
    if (!this.checkpoint.isAvailable()) return undefined;
    const stored = this.checkpoint.getItem<unknown>(this.path);
    if (stored === null) return undefined;
    if (!this.valid(stored)) {
      this.checkpoint.removeItem(this.path);
      return undefined;
    }
    this.memory = stored;
    return stored;
  }

  async save(session: OperatorSession): Promise<void> {
    if (!this.valid(session)) throw new Error('Invalid operator session');
    if (this.checkpoint.isAvailable()) this.checkpoint.setItem(this.path, session);
    this.memory = session;
  }

  async clear(): Promise<void> {
    const selection = this.selectionPath();
    this.memory = undefined;
    if (this.checkpoint.isAvailable()) this.checkpoint.multiRemove('', selection ? [this.path, selection] : [this.path]);
    else if (this.checkpoint.hasFile()) throw new Error('protected_storage_unavailable');
  }

  selectedOrganization(): string | undefined {
    const path = this.selectionPath();
    if (!path || !this.checkpoint.isAvailable()) return undefined;
    const value = this.checkpoint.getItem<unknown>(path);
    return typeof value === 'string' && value.length <= 200 ? value : undefined;
  }

  saveSelectedOrganization(id: string): void {
    const path = this.selectionPath();
    if (path && this.checkpoint.isAvailable()) this.checkpoint.setItem(path, id);
  }

  private selectionPath(): string | undefined {
    return this.memory?.principal.subject ? `${this.path}/organisation/${encodeURIComponent(this.memory.principal.subject)}` : undefined;
  }

  private valid(value: unknown): value is OperatorSession {
    if (!value || typeof value !== 'object') return false;
    const session = value as Partial<OperatorSession>;
    return session.principal?.issuer === this.issuer && typeof session.principal.subject === 'string' && !!session.principal.subject &&
      typeof session.accessToken === 'string' && !!session.accessToken && session.tokenType === 'Bearer' &&
      typeof session.expiresAt === 'number' && Number.isFinite(session.expiresAt) &&
      (session.refreshToken === undefined || typeof session.refreshToken === 'string') &&
      (session.refreshExpiresAt === undefined || typeof session.refreshExpiresAt === 'number');
  }
}
