import type { OperatorSession, OperatorSessionStore } from '@safetech/inheriti-elements-core';
import { MASTER_KEY_CACHE_PREFIX } from '../shared/stored-configuration.js';
import { operatorSessionIdentity } from './session-key-vault.js';
import type { ChromeConfiguration } from '../shared/configuration.js';
import { INTEGRATION_AUTHORITY } from '@safetech/inheriti-elements-core/browser';

const LEGACY_SESSION_KEY = 'inheriti.operatorSession';
const PROFILES_KEY = 'inheriti.operatorProfiles';
const ACTIVE_KEY = 'inheriti.activeOperatorProfile';
const GENERATION_KEY = 'inheriti.operatorSessionGeneration';

export interface OperatorSessionSnapshot { session: OperatorSession | undefined; generation: number }
export interface OperatorProfileSummary {
  readonly id: string;
  readonly label: string;
  readonly issuer: string;
  readonly environment: string;
  readonly authorizedParty: string;
  readonly subject: string;
  readonly expiresAt: number;
  readonly active: boolean;
  readonly needsSignIn: boolean;
}

interface Profile {
  id: string;
  context?: string;
  label?: string;
  epoch: number;
  issuer: string;
  environment: string;
  authorizedParty: string;
  subject: string;
  session?: OperatorSession;
}
interface Registry { profiles: Profile[]; active?: string; generation: number }

export function operatorProfileId(session: OperatorSession): string {
  const principal = session.principal;
  if (!principal || !principal.issuer || !principal.environment || !principal.authorizedParty || !principal.subject
    || !operatorSessionIdentity(session)) throw new Error('invalid_operator_session');
  return JSON.stringify([principal.environment, principal.issuer, principal.authorizedParty, principal.subject]);
}

function accountLabel(session: OperatorSession): string | undefined {
  if ('kind' in session && session.kind === 'business') return undefined;
  const payload = session.idToken?.split('.')[1];
  if (!payload) return undefined;
  try {
    const bytes = Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), (character) => character.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    const fullName = [claims.given_name, claims.family_name]
      .filter((claim): claim is string => typeof claim === 'string' && claim.trim().length > 0).join(' ');
    const value = [claims.name, fullName, claims.nickname, claims.preferred_username]
      .find((claim) => typeof claim === 'string' && claim.trim().length > 0 && !claim.includes('@')
        && claim !== claims.sub && !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/iu.test(claim));
    return typeof value === 'string' ? value.trim().slice(0, 80) : undefined;
  } catch { return undefined; }
}

function profileFor(session: OperatorSession, epoch: number, context?: string): Profile {
  const profile: Profile = {
    id: operatorProfileId(session), epoch, issuer: session.principal.issuer, environment: session.principal.environment,
    authorizedParty: session.principal.authorizedParty, subject: session.principal.subject, session,
  };
  if (context) profile.context = context;
  const label = accountLabel(session);
  if (label) profile.label = label;
  return profile;
}

/** Credentials remain in memory-backed extension storage and never reach the panel or local storage. */
export class SessionStorageOperatorSessionStore implements OperatorSessionStore {
  private queue: Promise<unknown> = Promise.resolve();
  private context: ChromeConfiguration | undefined;

  public constructor(private readonly area: chrome.storage.StorageArea) {}

  public bind(configuration: ChromeConfiguration): void { this.context = configuration; }

  private contextKey(): string | undefined {
    const configuration = this.context;
    return configuration && JSON.stringify([INTEGRATION_AUTHORITY, configuration.apiUrl, configuration.environment,
      configuration.issuer, configuration.clientId, configuration.applicationId ?? null]);
  }

  private matches(session: OperatorSession): boolean {
    const configuration = this.context;
    if (!configuration) return true;
    const audience = configuration.applicationId === undefined ? 'inheriti-integrations-api' : 'inheriti-elements-api';
    const kind = configuration.applicationId === undefined
      ? (INTEGRATION_AUTHORITY === 'business' ? 'business' : 'safeid-oidc-business') : undefined;
    return session.principal.issuer === configuration.issuer &&
      session.principal.environment === configuration.environment &&
      session.principal.authorizedParty === configuration.clientId &&
      (session.principal.audience === audience ||
        (Array.isArray(session.principal.audience) && session.principal.audience.includes(audience))) &&
      (kind !== 'safeid-oidc-business' ||
        ('businessApiUrl' in session && session.businessApiUrl === configuration.apiUrl &&
          'audience' in session && session.audience === audience &&
          'clientId' in session && session.clientId === configuration.clientId &&
          'issuer' in session && session.issuer === configuration.issuer.replace(/\/+$/u, '') &&
          'environment' in session && session.environment === configuration.environment)) &&
      (kind === undefined ? !('kind' in session) : 'kind' in session && session.kind === kind);
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async read(): Promise<Registry> {
    const stored = await this.area.get([LEGACY_SESSION_KEY, PROFILES_KEY, ACTIVE_KEY, GENERATION_KEY]);
    if (stored[LEGACY_SESSION_KEY] !== undefined) await this.area.remove(LEGACY_SESSION_KEY);
    const generation = stored[GENERATION_KEY];
    const value = stored[PROFILES_KEY];
    const active = stored[ACTIVE_KEY];
    const empty: Registry = { profiles: [], generation: typeof generation === 'number' && Number.isSafeInteger(generation) && generation >= 0 ? generation : 0 };
    if (value === undefined) return empty;
    try {
      const parsed: unknown = JSON.parse(value as string);
      if (!Array.isArray(parsed)) throw new Error('invalid_operator_profiles');
      const profiles: Profile[] = parsed.map((item: unknown) => {
        if (typeof item !== 'object' || item === null || !('id' in item))
          throw new Error('invalid_operator_profile');
        const profile = item as Profile;
        if (typeof profile.id !== 'string' || !Number.isSafeInteger(profile.epoch) || profile.epoch < 0
          || (profile.label !== undefined && (typeof profile.label !== 'string' || profile.label.length > 80))
          || typeof profile.issuer !== 'string'
          || typeof profile.environment !== 'string' || typeof profile.authorizedParty !== 'string'
          || typeof profile.subject !== 'string'
          || profile.id !== JSON.stringify([profile.environment, profile.issuer, profile.authorizedParty, profile.subject])
          || (profile.session !== undefined && (profile.id !== operatorProfileId(profile.session)
            || typeof profile.session.accessToken !== 'string' || !Number.isFinite(profile.session.expiresAt))))
          throw new Error('invalid_operator_profile');
        return profile;
      });
      if (new Set(profiles.map(({ id }) => id)).size !== profiles.length
        || (active !== undefined && (typeof active !== 'string' || !profiles.some(({ id, session }) => id === active && session !== undefined))))
        throw new Error('invalid_operator_profiles');
      let discardedLegacyBusiness = false;
      let migratedLegacyBusiness = false;
      for (const profile of profiles) {
        const session = profile.session;
        const compatibleLegacyBusiness = this.contextKey() !== undefined && profile.context === undefined && INTEGRATION_AUTHORITY === 'business'
          && 'kind' in (session ?? {}) && session?.kind === 'business';
        if (session && ((!compatibleLegacyBusiness && profile.context !== this.contextKey()) || !this.matches(session))) {
          delete profile.session;
          discardedLegacyBusiness = true;
          continue;
        }
        if (session && compatibleLegacyBusiness) {
          profile.context = this.contextKey()!;
          migratedLegacyBusiness = true;
        }
        if (!session || ('kind' in session && (session.kind === 'business' || session.kind === 'safeid-oidc-business'))) continue;
        const audience = session.principal.audience;
        if (audience !== 'inheriti-integrations-api'
          && (!Array.isArray(audience) || !audience.includes('inheriti-integrations-api'))) continue;
        delete profile.session;
        discardedLegacyBusiness = true;
      }
      if (discardedLegacyBusiness || migratedLegacyBusiness) {
        const next: Registry = { profiles, generation: empty.generation + (discardedLegacyBusiness ? 1 : 0) };
        if (typeof active === 'string' && profiles.some(({ id, session }) => id === active && session !== undefined)) next.active = active;
        if (discardedLegacyBusiness) await this.clearKeys();
        await this.write(next);
        return next;
      }
      return { profiles, generation: empty.generation, ...(active === undefined ? {} : { active }) };
    } catch {
      await this.area.remove([PROFILES_KEY, ACTIVE_KEY]);
      await this.area.set({ [GENERATION_KEY]: empty.generation + 1 });
      await this.clearKeys();
      return { profiles: [], generation: empty.generation + 1 };
    }
  }

  private async write(registry: Registry): Promise<void> {
    await this.area.set({
      [PROFILES_KEY]: JSON.stringify(registry.profiles),
      [ACTIVE_KEY]: registry.active ?? null,
      [GENERATION_KEY]: registry.generation,
    });
    if (registry.active === undefined) await this.area.remove(ACTIVE_KEY);
  }

  private async clearKeys(): Promise<void> {
    const stored = await this.area.get(null);
    const keys = Object.keys(stored).filter((key) => key.startsWith(MASTER_KEY_CACHE_PREFIX));
    if (keys.length > 0) await this.area.remove(keys);
  }

  public snapshot(): Promise<OperatorSessionSnapshot> {
    return this.exclusive(async () => {
      const registry = await this.read();
      return { session: registry.profiles.find(({ id }) => id === registry.active)?.session, generation: registry.generation };
    });
  }

  public async load(): Promise<OperatorSession | undefined> {
    return (await this.snapshot()).session;
  }

  public profiles(): Promise<readonly OperatorProfileSummary[]> {
    return this.exclusive(async () => {
      const registry = await this.read();
      return registry.profiles.map((profile) => ({
        id: profile.id, label: profile.label ?? (profile.session && accountLabel(profile.session)) ?? profile.subject,
        issuer: profile.issuer, environment: profile.environment,
        authorizedParty: profile.authorizedParty, subject: profile.subject,
        expiresAt: profile.session?.expiresAt ?? 0, active: profile.id === registry.active,
        needsSignIn: profile.session === undefined,
      }));
    });
  }

  public async beginEnrollment(): Promise<OperatorSessionStore> {
    const generation = (await this.snapshot()).generation;
    let enrolled: { id: string; identity: string; epoch: number } | undefined;
    return {
      load: async () => this.exclusive(async () => {
        const bound = enrolled;
        if (!bound) return undefined;
        const currentProfile = (await this.read()).profiles.find(({ id }) => id === bound.id);
        return currentProfile?.epoch === bound.epoch
          && operatorSessionIdentity(currentProfile.session) === bound.identity ? currentProfile.session : undefined;
      }),
      save: async (session) => {
        if (!this.matches(session)) throw new Error('operator_session_changed');
        if (enrolled) return this.saveBound(enrolled.id, enrolled.identity, enrolled.epoch, session);
        return this.exclusive(async () => {
          const registry = await this.read();
          if (registry.generation !== generation) throw new Error('operator_session_changed');
          const id = operatorProfileId(session);
          const identity = operatorSessionIdentity(session)!;
          const profiles = registry.profiles.filter((profile) => profile.id !== id);
          const epoch = registry.generation + 1;
          profiles.push(profileFor(session, epoch, this.contextKey()));
          await this.clearKeys();
          await this.write({ profiles, active: id, generation: epoch });
          enrolled = { id, identity, epoch };
        });
      },
      clear: async () => { if (enrolled) await this.invalidate(enrolled.id, enrolled.identity, enrolled.epoch); },
    };
  }

  public async forProfile(id: string): Promise<OperatorSessionStore> {
    const profile = await this.exclusive(async () => (await this.read()).profiles.find((item) => item.id === id));
    if (!profile?.session) throw new Error('operator_profile_missing');
    const identity = operatorSessionIdentity(profile.session);
    const epoch = profile.epoch;
    return {
      load: async () => this.exclusive(async () => {
        const currentProfile = (await this.read()).profiles.find((item) => item.id === id);
        return currentProfile?.epoch === epoch && operatorSessionIdentity(currentProfile.session) === identity
          ? currentProfile.session : undefined;
      }),
      save: async (session) => this.saveBound(id, identity, epoch, session),
      clear: async () => this.invalidate(id, identity, epoch),
    };
  }

  private saveBound(id: string, identity: string | undefined, epoch: number, session: OperatorSession): Promise<void> {
    return this.exclusive(async () => {
      const registry = await this.read();
      const profile = registry.profiles.find((item) => item.id === id);
      if (!this.matches(session) || !profile || profile.epoch !== epoch || operatorProfileId(session) !== id || operatorSessionIdentity(session) !== identity
        || operatorSessionIdentity(profile.session) !== identity) throw new Error('operator_session_changed');
      profile.session = session;
      await this.write(registry);
    });
  }

  public save(session: OperatorSession): Promise<void> {
    return this.exclusive(async () => {
      if (!this.matches(session)) throw new Error('operator_session_changed');
      const registry = await this.read();
      const profile = registry.profiles.find(({ id }) => id === registry.active);
      if (!profile || operatorProfileId(session) !== profile.id
        || operatorSessionIdentity(session) !== operatorSessionIdentity(profile.session))
        throw new Error('operator_session_changed');
      profile.session = session;
      await this.write(registry);
    });
  }

  public activate(id: string): Promise<boolean> {
    return this.exclusive(async () => {
      const registry = await this.read();
      if (!registry.profiles.some((profile) => profile.id === id && profile.session !== undefined)) return false;
      if (registry.active === id) return true;
      await this.clearKeys();
      await this.write({ profiles: registry.profiles, active: id, generation: registry.generation + 1 });
      return true;
    });
  }

  public bumpGeneration(): Promise<void> {
    return this.exclusive(async () => {
      const registry = await this.read();
      await this.clearKeys();
      await this.write({ profiles: registry.profiles,
        ...(registry.active === undefined ? {} : { active: registry.active }), generation: registry.generation + 1 });
    });
  }

  public remove(id: string, identity?: string): Promise<void> {
    return this.exclusive(async () => {
      const registry = await this.read();
      const profile = registry.profiles.find((item) => item.id === id);
      if (!profile || (identity !== undefined && operatorSessionIdentity(profile.session) !== identity)) return;
      await this.clearKeys();
      await this.write({ profiles: registry.profiles.filter((item) => item.id !== id),
        ...(registry.active === id ? {} : { active: registry.active }), generation: registry.generation + 1 });
    });
  }

  private invalidate(id: string, identity?: string, epoch?: number): Promise<void> {
    return this.exclusive(async () => {
      const registry = await this.read();
      const profile = registry.profiles.find((item) => item.id === id);
      if (!profile?.session || (epoch !== undefined && profile.epoch !== epoch)
        || (identity !== undefined && operatorSessionIdentity(profile.session) !== identity)) return;
      delete profile.session;
      await this.clearKeys();
      await this.write({ profiles: registry.profiles,
        ...(registry.active === id ? {} : { active: registry.active }), generation: registry.generation + 1 });
    });
  }

  public async clear(): Promise<void> {
    const active = (await this.profiles()).find((profile) => profile.active);
    if (active) await this.invalidate(active.id);
  }

  public clearAll(): Promise<void> {
    return this.exclusive(async () => {
      const registry = await this.read();
      await this.clearKeys();
      await this.write({ profiles: [], generation: registry.generation + 1 });
    });
  }
}
