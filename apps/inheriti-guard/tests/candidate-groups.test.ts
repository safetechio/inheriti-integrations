import { describe, expect, it } from 'vitest';
import { groupCredentialCandidates, hasCredentialFieldOverride, preferredCredentialCandidate } from '../src/content/candidate-groups.js';

function candidate(planId: string, assetId: string, targetId: string, fieldName: string) {
  return { suggestion: { mapping: { protectedField: { planId, assetId, fieldName, selector: `${assetId}.${fieldName}` },
    pageTarget: { targetId } } } };
}

describe('overlay credential choices', () => {
  it('shows one asset row with exact-first email and username field choices', () => {
    const email = candidate('plan-1', 'asset-1', 'metricool-email', 'email');
    const username = candidate('plan-1', 'asset-1', 'metricool-email', 'username');
    expect(groupCredentialCandidates([email, username])).toEqual([[email, username]]);
  });

  it('keeps different assets, plans, and page fields separate', () => {
    const candidates = [candidate('plan-1', 'asset-1', 'email', 'email'),
      candidate('plan-1', 'asset-2', 'email', 'email'),
      candidate('plan-2', 'asset-1', 'email', 'email'),
      candidate('plan-1', 'asset-1', 'username', 'username')];
    expect(groupCredentialCandidates(candidates)).toEqual(candidates.map((one) => [one]));
  });

  it('does not offer the same asset field twice', () => {
    const email = candidate('plan-1', 'asset-1', 'email', 'email');
    expect(groupCredentialCandidates([email, email])).toEqual([[email]]);
  });

  it('defaults to the exact-first field and preserves a chosen override', () => {
    const email = candidate('plan-1', 'asset-1', 'email', 'email');
    const username = candidate('plan-1', 'asset-1', 'email', 'username');
    const choices = [email, username];
    expect(preferredCredentialCandidate(choices)).toBe(email);
    expect(preferredCredentialCandidate(choices, username.suggestion.mapping.protectedField.selector)).toBe(username);
    expect(preferredCredentialCandidate(choices, email.suggestion.mapping.protectedField.selector,
      username.suggestion.mapping.protectedField.selector)).toBe(username);
    expect(hasCredentialFieldOverride(choices)).toBe(true);
    expect(hasCredentialFieldOverride([email])).toBe(false);
    expect(hasCredentialFieldOverride([email, candidate('plan-1', 'asset-1', 'email', 'email')])).toBe(false);
  });
});
