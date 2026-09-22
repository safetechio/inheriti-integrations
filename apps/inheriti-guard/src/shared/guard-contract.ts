export const GUARD_STORAGE_KEYS = [
  'isEnabled',
  'blockedSites',
  'apiBlockingEnabled',
  'clipboardGuardEnabled',
  'idleLockEnabled',
  'idleLockMinutes',
  'downloadTrapEnabled',
] as const;

export interface GuardSettings {
  isEnabled: boolean;
  blockedSites: string[];
  apiBlockingEnabled: boolean;
  clipboardGuardEnabled: boolean;
  idleLockEnabled: boolean;
  idleLockMinutes: number;
  downloadTrapEnabled: boolean;
}

export const GUARD_DEFAULT_SETTINGS: Readonly<GuardSettings> = Object.freeze({
  isEnabled: false,
  blockedSites: [],
  apiBlockingEnabled: true,
  clipboardGuardEnabled: true,
  idleLockEnabled: true,
  idleLockMinutes: 120,
  downloadTrapEnabled: true,
});

export type GuardActivityKind =
  | 'navigation-blocked'
  | 'clipboard-blocked'
  | 'download-blocked'
  | 'csp-violation'
  | 'sensitive-api-blocked'
  | 'idle-lock'
  | 'secure-logoff';

export interface GuardActivityEntry {
  id: string;
  kind: GuardActivityKind;
  timestamp: number;
  origin?: string;
  pathname?: string;
  detail?: string;
}

export interface SensitiveClipboardState {
  expiresAt: number;
}
