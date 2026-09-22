import type { SensitiveClipboardState } from '../../shared/guard-contract.js';
import { isEcosystemUrl } from './url-policy.js';

export const SENSITIVE_CLIPBOARD_DURATION_MS = 5 * 60 * 1000;

export function markSensitiveClipboard(now: number, durationMs = SENSITIVE_CLIPBOARD_DURATION_MS): SensitiveClipboardState {
  return { expiresAt: now + Math.max(0, durationMs) };
}

export function isSensitiveClipboardActive(state: SensitiveClipboardState | undefined, now: number): boolean {
  return typeof state?.expiresAt === 'number' && Number.isFinite(state.expiresAt) && now < state.expiresAt;
}

export function clipboardDecision(input: {
  senderUrl?: string;
  guardEnabled: boolean;
  ecosystemSessionOpen: boolean;
  state?: SensitiveClipboardState;
  now: number;
}): { allowPaste: boolean; allowRead: boolean } {
  if (!input.guardEnabled || isEcosystemUrl(input.senderUrl)) return { allowPaste: true, allowRead: true };
  const sensitive = isSensitiveClipboardActive(input.state, input.now);
  return { allowPaste: !sensitive, allowRead: !input.ecosystemSessionOpen && !sensitive };
}
