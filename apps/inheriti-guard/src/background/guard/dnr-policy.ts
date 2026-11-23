import { TRUSTED_HOSTS } from './url-policy.js';
import { BUSINESS_BUILD_DOWNLOADS } from './business-build-downloads.js';

export const GUARD_DNR_MIN_ID = 20_000;
export const GUARD_DNR_MAX_ID = 20_099;
export const GUARD_NAVIGATION_RULE_ID = GUARD_DNR_MIN_ID;
export const LEGACY_GUARD_DNR_IDS = [1, 2] as const;

interface GuardBuildDownloadRule {
  id: number;
  priority: number;
  action: { type: 'allow' };
  condition: {
    regexFilter: string;
    isUrlFilterCaseSensitive: true;
    resourceTypes: ['main_frame'];
    initiatorDomains: string[];
  };
}

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
): { removeRuleIds: number[]; addRules: (GuardDynamicRule | GuardBuildDownloadRule)[] } {
  return {
    removeRuleIds: guardRuleIds(existingRules),
    addRules: enabled ? [
      guardNavigationRule(blockPageUrl, extensionId),
      ...BUSINESS_BUILD_DOWNLOADS.map(({ site, urlPattern }, index): GuardBuildDownloadRule => ({
        id: GUARD_NAVIGATION_RULE_ID + index + 1,
        priority: 2,
        action: { type: 'allow' },
        condition: {
          regexFilter: urlPattern.source,
          isUrlFilterCaseSensitive: true,
          resourceTypes: ['main_frame'],
          initiatorDomains: [site],
        },
      })),
    ] : [],
  };
}
