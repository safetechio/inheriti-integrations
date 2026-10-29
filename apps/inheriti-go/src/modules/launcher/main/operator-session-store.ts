import { createHash } from 'node:crypto';
import type { OperatorSession, OperatorSessionStore } from '@safetech/inheriti-elements-core/node';
import { ProtectedCheckpoint } from './protected-checkpoint.js';

type ProfileRecord = { generation: number; session?: OperatorSession; reauthSubject?: string; memoryOnly?: boolean };
type ProfileRegistry = { profiles: Map<string, ProfileRecord>; memoryActiveSubject: string | undefined };
export type SavedAccountSummary = { subject: string; name: string; status: 'ready' | 'sign-in-again' };

export class ProtectedOperatorSessionStore implements OperatorSessionStore {
  private static readonly epochs = new Map<string, number>();
  private static readonly registries = new Map<string, Set<ProfileRegistry>>();
  private readonly checkpoint = new ProtectedCheckpoint();
  private readonly path: string;
  private readonly registry: ProfileRegistry;
  private readonly epoch: number;
  private boundSubject: string | undefined;
  private boundGeneration: number | undefined;
  private retired = false;

  constructor(private readonly deployment: string, private readonly issuer: string, registry?: ProfileRegistry) {
    this.path = `operator-session/${deployment}/${createHash('sha256').update(issuer).digest('hex')}`;
    this.registry = registry ?? { profiles: new Map(), memoryActiveSubject: undefined };
    this.epoch = ProtectedOperatorSessionStore.epochs.get(this.path) ?? 0;
    const registries = ProtectedOperatorSessionStore.registries.get(this.path) ?? new Set<ProfileRegistry>();
    registries.add(this.registry);
    ProtectedOperatorSessionStore.registries.set(this.path, registries);
  }

  get isRetired(): boolean { return this.retired || this.epoch !== (ProtectedOperatorSessionStore.epochs.get(this.path) ?? 0); }
  fork(): ProtectedOperatorSessionStore { return new ProtectedOperatorSessionStore(this.deployment, this.issuer, this.registry); }
  retire(): void { this.retired = true; }

  async load(): Promise<OperatorSession | undefined> {
    if (this.isRetired) return undefined;
    if (!this.checkpoint.isAvailable()) {
      const subject = this.boundSubject ?? this.registry.memoryActiveSubject;
      if (!subject) return undefined;
      const record = this.registry.profiles.get(subject);
      return this.bind(subject, record);
    }
    this.discardLegacySession();
    this.discardLegacyProfiles();
    const active = this.checkpoint.getItem<unknown>(`${this.path}/active`);
    const subject = this.boundSubject ?? active ?? this.registry.memoryActiveSubject;
    if (typeof subject !== 'string' || !subject) return undefined;
    let record = this.readProfile(subject);
    const memory = this.registry.profiles.get(subject);
    if (!record && memory?.memoryOnly && memory.session) {
      record = { generation: memory.generation, session: memory.session };
      this.writeProfile(subject, record);
      if (!active && this.registry.memoryActiveSubject === subject) this.setActive(subject);
    }
    if (record && memory?.memoryOnly && memory.session && memory.generation === record.generation) {
      record = { generation: record.generation, session: memory.session };
      this.writeProfile(subject, record);
    }
    if (!record?.session) {
      if (active === subject) this.checkpoint.removeItem(`${this.path}/active`);
      this.retired = this.boundGeneration !== undefined;
      return undefined;
    }
    const loaded = this.bind(subject, record);
    if (loaded) this.registry.profiles.set(subject, record);
    return loaded;
  }

  async save(session: OperatorSession): Promise<void> {
    if (this.isRetired) throw new Error('operator_session_retired');
    if (!this.valid(session)) throw new Error('Invalid operator session');
    if (this.checkpoint.isAvailable()) this.discardLegacySession();
    const active = this.checkpoint.isAvailable()
      ? this.checkpoint.getItem<unknown>(`${this.path}/active`)
      : this.registry.memoryActiveSubject;
    const subject = session.principal.subject;
    if (this.boundSubject && this.boundSubject !== subject) throw new Error('operator_account_changed');
    if (!this.boundSubject && active && active !== subject) throw new Error('operator_account_changed');
    const current = this.currentProfile(subject);
    if (this.boundGeneration !== undefined && current?.generation !== this.boundGeneration) {
      this.retired = true;
      throw new Error('operator_session_retired');
    }
    const generation = this.boundGeneration ?? (current?.generation ?? 0) + 1;
    this.writeProfile(subject, { generation, session });
    if (!active && !this.boundSubject) this.setActive(subject);
    this.boundSubject = subject;
    this.boundGeneration = generation;
  }

  async enroll(session: OperatorSession): Promise<void> {
    if (this.isRetired) throw new Error('operator_session_retired');
    if (!this.valid(session)) throw new Error('Invalid operator session');
    if (this.checkpoint.isAvailable()) this.discardLegacySession();
    const subject = session.principal.subject;
    const generation = (this.currentProfile(subject)?.generation ?? 0) + 1;
    this.writeProfile(subject, { generation, session });
  }

  async activate(subject: string): Promise<void> {
    if (this.isRetired) throw new Error('operator_session_retired');
    if (!subject) throw new Error('operator_account_not_found');
    if (this.checkpoint.isAvailable()) this.discardLegacySession();
    const record = this.currentProfile(subject);
    if (!record?.session) throw new Error('operator_account_not_found');
    this.setActive(subject);
  }

  async listProfiles(): Promise<string[]> {
    if (this.epoch !== (ProtectedOperatorSessionStore.epochs.get(this.path) ?? 0)) return [];
    if (!this.checkpoint.isAvailable()) {
      return [...this.registry.profiles.entries()].filter(([, record]) => !!record.session).map(([subject]) => subject);
    }
    this.discardLegacySession();
    this.discardLegacyProfiles();
    return this.checkpoint.searchItems<ProfileRecord>(`${this.path}/profile/`, (value) => this.validRecord(value) && !!value.session)
      .map((record) => record.session!.principal.subject);
  }

  async allSessions(): Promise<OperatorSession[]> {
    if (this.isRetired) return [];
    if (this.checkpoint.isAvailable()) this.discardLegacyProfiles();
    const records = this.checkpoint.isAvailable()
      ? this.checkpoint.searchItems<ProfileRecord>(`${this.path}/profile/`, (value) => this.validRecord(value) && !!value.session)
      : [...this.registry.profiles.values()].filter((record) => !!record.session);
    return records.flatMap((record) => record.session ? [record.session] : []);
  }

  async accountSummaries(): Promise<{ accounts: SavedAccountSummary[]; activeSubject: string | undefined }> {
    if (this.epoch !== (ProtectedOperatorSessionStore.epochs.get(this.path) ?? 0)) return { accounts: [], activeSubject: undefined };
    if (this.checkpoint.isAvailable()) { this.discardLegacySession(); this.discardLegacyProfiles(); }
    const records = this.checkpoint.isAvailable()
      ? this.checkpoint.searchItems<ProfileRecord>(`${this.path}/profile/`, (value) => this.validRecord(value) && (!!value.session || !!value.reauthSubject))
      : [...this.registry.profiles.values()].filter((record) => !!record.session || !!record.reauthSubject);
    const accounts = records.flatMap((record) => {
      const session = record.session;
      if (!session) return record.reauthSubject ? [{ subject: record.reauthSubject, name: record.reauthSubject, status: 'sign-in-again' as const }] : [];
      const usable = session.kind === 'business' && session.sessionExpiresAt > Date.now();
      return [{ subject: session.principal.subject, name: session.principal.subject,
        status: usable ? 'ready' as const : 'sign-in-again' as const }];
    });
    const active = this.checkpoint.isAvailable() ? this.checkpoint.getItem<unknown>(`${this.path}/active`) : this.registry.memoryActiveSubject;
    return { accounts, activeSubject: typeof active === 'string' ? active : undefined };
  }

  async clear(): Promise<void> {
    if (this.isRetired) return;
    if (!this.boundSubject) {
      this.retired = true;
      return;
    }
    if (!this.checkpoint.isAvailable() && this.checkpoint.hasFile()) throw new Error('protected_storage_unavailable');
    if (this.checkpoint.isAvailable()) this.discardLegacySession();
    const active = this.checkpoint.isAvailable()
      ? this.checkpoint.getItem<unknown>(`${this.path}/active`)
      : this.registry.memoryActiveSubject;
    const subject = this.boundSubject;
    if (typeof subject === 'string' && subject) {
      const current = this.currentProfile(subject);
      if (this.boundGeneration === undefined || current?.generation === this.boundGeneration) {
        this.writeProfile(subject, { generation: (current?.generation ?? 0) + 1 });
        if (this.checkpoint.isAvailable()) this.checkpoint.removeItem(this.selectionPath(subject));
        if (active === subject) this.clearActive();
      }
    }
    this.retired = true;
  }

  async clearAll(additionalScopes: string[] = []): Promise<void> {
    if (this.isRetired) throw new Error('operator_session_retired');
    if (!this.checkpoint.isAvailable() && this.checkpoint.hasFile()) throw new Error('protected_storage_unavailable');
    if (this.checkpoint.isAvailable()) this.checkpoint.cleanMany([this.path].concat(additionalScopes));
    for (const registry of ProtectedOperatorSessionStore.registries.get(this.path) ?? []) {
      registry.profiles.clear();
      registry.memoryActiveSubject = undefined;
    }
    ProtectedOperatorSessionStore.epochs.set(this.path, this.epoch + 1);
    this.retired = true;
  }

  selectedOrganization(): string | undefined {
    const subject = this.boundSubject;
    if (!subject || !this.currentBinding(subject) || !this.checkpoint.isAvailable()) return undefined;
    const value = this.checkpoint.getItem<unknown>(this.selectionPath(subject));
    return typeof value === 'string' && value.length <= 200 ? value : undefined;
  }

  saveSelectedOrganization(id: string): void {
    const subject = this.boundSubject;
    if (subject && this.currentBinding(subject) && this.checkpoint.isAvailable()) this.checkpoint.setItem(this.selectionPath(subject), id);
  }

  private currentBinding(subject: string): boolean {
    return !this.isRetired && this.boundGeneration !== undefined &&
      this.currentProfile(subject)?.generation === this.boundGeneration;
  }

  private bind(subject: string, record: ProfileRecord | undefined): OperatorSession | undefined {
    if (!record?.session || (this.boundGeneration !== undefined && this.boundGeneration !== record.generation)) {
      if (this.boundGeneration !== undefined) this.retired = true;
      return undefined;
    }
    this.boundSubject = subject;
    this.boundGeneration = record.generation;
    return record.session;
  }

  private currentProfile(subject: string): ProfileRecord | undefined {
    return this.checkpoint.isAvailable() ? this.readProfile(subject) : this.registry.profiles.get(subject);
  }

  private readProfile(subject: string): ProfileRecord | undefined {
    const value = this.checkpoint.getItem<unknown>(this.profilePath(subject));
    if (value === null) return undefined;
    if (this.validRecord(value) && (!value.session || value.session.principal.subject === subject)) return value;
    this.checkpoint.removeItem(this.profilePath(subject));
    return undefined;
  }

  private writeProfile(subject: string, record: ProfileRecord): void {
    if (this.checkpoint.isAvailable()) this.checkpoint.setItem(this.profilePath(subject), record);
    this.registry.profiles.set(subject, this.checkpoint.isAvailable() ? record : record.session
      ? { generation: record.generation, session: record.session, memoryOnly: true }
      : { generation: record.generation, memoryOnly: true });
  }

  private setActive(subject: string): void {
    if (this.checkpoint.isAvailable()) this.checkpoint.setItem(`${this.path}/active`, subject);
    this.registry.memoryActiveSubject = subject;
  }

  private clearActive(): void {
    if (this.checkpoint.isAvailable()) this.checkpoint.removeItem(`${this.path}/active`);
    this.registry.memoryActiveSubject = undefined;
  }

  private profilePath(subject: string): string {
    return `${this.path}/profile/${createHash('sha256').update(subject).digest('hex')}`;
  }

  private selectionPath(subject: string): string {
    return `${this.path}/organisation/${encodeURIComponent(subject)}`;
  }

  private discardLegacySession(): void {
    if (this.checkpoint.getItem(this.path) !== null) this.checkpoint.removeItem(this.path);
  }

  private discardLegacyProfiles(): void {
    const records = this.checkpoint.searchItems<ProfileRecord>(`${this.path}/profile/`, (value) =>
      !!value && typeof value === 'object' && !!value.session && !this.valid(value.session));
    for (const record of records) {
      const subject = record.session?.principal?.subject;
      if (typeof subject !== 'string' || !subject || !Number.isSafeInteger(record.generation) || record.generation < 1) continue;
      this.writeProfile(subject, { generation: record.generation + 1, reauthSubject: subject });
    }
  }

  private validRecord(value: unknown): value is ProfileRecord {
    if (!value || typeof value !== 'object') return false;
    const record = value as Partial<ProfileRecord>;
    return typeof record.generation === 'number' && Number.isSafeInteger(record.generation) && record.generation > 0 &&
      (record.session === undefined || this.valid(record.session)) &&
      (record.reauthSubject === undefined || typeof record.reauthSubject === 'string' && !!record.reauthSubject);
  }

  private valid(value: unknown): value is OperatorSession {
    if (!value || typeof value !== 'object') return false;
    const session = value as Partial<OperatorSession>;
    return session.kind === 'business' && session.principal?.issuer === this.issuer &&
      typeof session.principal.subject === 'string' && !!session.principal.subject &&
      typeof session.familyId === 'string' && !!session.familyId &&
      typeof session.accessToken === 'string' && !!session.accessToken && session.tokenType === 'Bearer' &&
      typeof session.expiresAt === 'number' && Number.isFinite(session.expiresAt) &&
      typeof session.sessionExpiresAt === 'number' && Number.isFinite(session.sessionExpiresAt) &&
      typeof session.refreshToken === 'string' && !!session.refreshToken &&
      !('idToken' in session) && !('refreshExpiresAt' in session);
  }
}
