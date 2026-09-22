import {
  GUARD_DEFAULT_SETTINGS,
  GUARD_STORAGE_KEYS,
  type GuardSettings,
} from './guard-contract.js';

export interface GuardStorageArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}

export function clampIdleMinutes(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return GUARD_DEFAULT_SETTINGS.idleLockMinutes;
  return Math.max(1, Math.min(120, parsed));
}

export function guardSettingsFromStorage(source: Record<string, unknown>): GuardSettings {
  return {
    isEnabled: source.isEnabled === true,
    blockedSites: Array.isArray(source.blockedSites)
      ? source.blockedSites.filter((entry): entry is string => typeof entry === 'string')
      : [],
    apiBlockingEnabled: typeof source.apiBlockingEnabled === 'boolean' ? source.apiBlockingEnabled : true,
    clipboardGuardEnabled: typeof source.clipboardGuardEnabled === 'boolean' ? source.clipboardGuardEnabled : true,
    idleLockEnabled: typeof source.idleLockEnabled === 'boolean' ? source.idleLockEnabled : true,
    idleLockMinutes: clampIdleMinutes(source.idleLockMinutes),
    downloadTrapEnabled: typeof source.downloadTrapEnabled === 'boolean' ? source.downloadTrapEnabled : true,
  };
}

export async function readGuardSettings(storage: GuardStorageArea): Promise<GuardSettings> {
  return guardSettingsFromStorage(await storage.get([...GUARD_STORAGE_KEYS]));
}

export function sanitizeBlockedSite(value: string): string | undefined {
  const candidate = value.trim().split(/\s+\(/, 1)[0] ?? '';
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return `${parsed.origin}${parsed.pathname}`.slice(0, 400);
  } catch {
    return undefined;
  }
}

export async function writeGuardSettings(storage: GuardStorageArea, settings: GuardSettings): Promise<void> {
  await storage.set({
    ...settings,
    blockedSites: settings.blockedSites.flatMap((entry) => sanitizeBlockedSite(entry) ?? []).slice(0, 100),
    idleLockMinutes: clampIdleMinutes(settings.idleLockMinutes),
  });
}
