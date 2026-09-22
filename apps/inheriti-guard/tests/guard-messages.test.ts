import { describe, expect, it } from 'vitest';
import { isGuardContentRequest, isGuardRequest } from '../src/shared/messages.js';

describe('Guard message boundary', () => {
  it('accepts the exact typed UI requests', () => {
    expect(isGuardRequest({ type: 'guard:get-state' })).toBe(true);
    expect(isGuardRequest({ type: 'guard:set-protection', enabled: true })).toBe(true);
    expect(isGuardRequest({ type: 'guard:set-idle-minutes', minutes: 30 })).toBe(true);
    expect(isGuardRequest({ type: 'activity:clear' })).toBe(true);
  });

  it('rejects missing, mistyped, and surplus authority', () => {
    expect(isGuardRequest({ type: 'guard:set-protection', enabled: 'true' })).toBe(false);
    expect(isGuardRequest({ type: 'guard:set-idle-minutes', minutes: Number.NaN })).toBe(false);
    expect(isGuardRequest({ type: 'guard:get-state', token: 'never' })).toBe(false);
    expect(isGuardRequest({ type: 'unknown' })).toBe(false);
  });

  it('keeps content messages in a separate narrow namespace', () => {
    expect(isGuardContentRequest({ type: 'guard-content:get-state' })).toBe(true);
    expect(isGuardContentRequest({ type: 'guard-content:blocked', kind: 'clipboard-blocked' })).toBe(true);
    expect(isGuardContentRequest({ type: 'guard-content:csp-violation' })).toBe(true);
    expect(isGuardContentRequest({ type: 'guard-content:csp-violation', blockedURI: 'https://secret.example?q=token#hash' })).toBe(false);
    expect(isGuardContentRequest({ type: 'guard-content:blocked', kind: 'navigation-blocked' })).toBe(false);
  });
});
