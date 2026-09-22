import { describe, expect, it } from 'vitest';
import { GUARD_DEFAULT_SETTINGS, GUARD_STORAGE_KEYS } from '../src/shared/guard-contract.js';
import {
  clampIdleMinutes,
  guardSettingsFromStorage,
  readGuardSettings,
  writeGuardSettings,
} from '../src/shared/guard-storage.js';

function area(values: Record<string, unknown> = {}) {
  const held = { ...values };
  return {
    held,
    get: async (keys: string[]) => Object.fromEntries(keys.filter((key) => key in held).map((key) => [key, held[key]])),
    set: async (next: Record<string, unknown>) => { Object.assign(held, next); },
  };
}

describe('Guard legacy storage compatibility', () => {
  it('uses the seven exact production keys and compatible defaults', () => {
    expect(GUARD_STORAGE_KEYS).toEqual([
      'isEnabled', 'blockedSites', 'apiBlockingEnabled', 'clipboardGuardEnabled',
      'idleLockEnabled', 'idleLockMinutes', 'downloadTrapEnabled',
    ]);
    expect(guardSettingsFromStorage({})).toEqual(GUARD_DEFAULT_SETTINGS);
  });

  it('round-trips a legacy 1.0.5 preference fixture', async () => {
    const fixture = {
      isEnabled: true,
      blockedSites: ['https://evil.example/path?token=legacy-secret#part (12:01:02 PM)'],
      apiBlockingEnabled: false,
      clipboardGuardEnabled: false,
      idleLockEnabled: false,
      idleLockMinutes: 35,
      downloadTrapEnabled: false,
    };
    expect(await readGuardSettings(area(fixture))).toEqual(fixture);
  });

  it('sanitizes new blocked-site writes and clamps idle minutes', async () => {
    const storage = area();
    await writeGuardSettings(storage, {
      ...GUARD_DEFAULT_SETTINGS,
      blockedSites: ['https://user:pass@evil.example/path?q=secret#fragment', 'not a URL'],
      idleLockMinutes: 900,
    });
    expect(storage.held.blockedSites).toEqual(['https://evil.example/path']);
    expect(storage.held.idleLockMinutes).toBe(120);
    expect(clampIdleMinutes(0)).toBe(120);
    expect(clampIdleMinutes(0.5)).toBe(1);
  });

  it('restores enabled only for literal true and ignores malformed legacy values', () => {
    expect(guardSettingsFromStorage({ isEnabled: 'true', blockedSites: 'bad' })).toEqual(GUARD_DEFAULT_SETTINGS);
  });
});
