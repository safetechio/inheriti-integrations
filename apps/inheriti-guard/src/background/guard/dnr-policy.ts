import { TRUSTED_HOSTS } from './url-policy.js';

export const GUARD_DNR_MIN_ID = 20_000;
export const GUARD_DNR_MAX_ID = 20_099;
export const GUARD_NAVIGATION_RULE_ID = GUARD_DNR_MIN_ID;
export const LEGACY_GUARD_DNR_IDS = [1, 2] as const;

export interface GuardDynamicRule {
  id: number;
  priority: number;
  action: { type: 'redirect'; redirect: { url: string } };
  condition: {
    regexFilter: string;
    resourceTypes: ['main_frame'];
    excludedInitiatorDomains: string[];
    excludedRequestDomains: string[];
  };
}

export function isGuardRuleId(id: number): boolean {
  return Number.isInteger(id) && id >= GUARD_DNR_MIN_ID && id <= GUARD_DNR_MAX_ID;
}

export function guardRuleIds(rules: readonly { id: number }[]): number[] {
  return rules.map(({ id }) => id)
    .filter((id) => isGuardRuleId(id) || (LEGACY_GUARD_DNR_IDS as readonly number[]).includes(id));
}

export function guardNavigationRule(blockPageUrl: string, extensionId: string): GuardDynamicRule {
  return {
    id: GUARD_NAVIGATION_RULE_ID,
    priority: 1,
    // Never copy the denied URL into the block page: it may contain credentials, queries or hashes.
    action: { type: 'redirect', redirect: { url: blockPageUrl } },
    condition: {
      regexFilter: '^https?://.+',
      resourceTypes: ['main_frame'],
      excludedInitiatorDomains: [extensionId],
      excludedRequestDomains: [...TRUSTED_HOSTS],
    },
  };
}

export function guardRuleUpdate(
  enabled: boolean,
  existingRules: readonly { id: number }[],
  blockPageUrl: string,
  extensionId: string,
): { removeRuleIds: number[]; addRules: GuardDynamicRule[] } {
  return {
    removeRuleIds: guardRuleIds(existingRules),
    addRules: enabled ? [guardNavigationRule(blockPageUrl, extensionId)] : [],
  };
}
