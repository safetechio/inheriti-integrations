import { clampIdleMinutes } from '../../shared/guard-storage.js';

export const GUARD_IDLE_ALARM = 'inheritiguard.idle-lock';

export function idleDetectionSeconds(minutes: unknown): number {
  return Math.max(15, clampIdleMinutes(minutes) * 60);
}

export function shouldTriggerIdleLock(input: {
  enabled: boolean;
  browserState: 'active' | 'idle' | 'locked' | string;
  ecosystemSessionOpen: boolean;
}): boolean {
  return input.enabled
    && input.ecosystemSessionOpen
    && (input.browserState === 'idle' || input.browserState === 'locked');
}
