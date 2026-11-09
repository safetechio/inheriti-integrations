import { describe, expect, it } from 'vitest';
import { pageFirstSuggestions } from '../src/background/page-first-suggestions.js';
import type { PageFieldTarget, ProtectedFieldRef } from '../src/shared/access-contract.js';

const target: PageFieldTarget = {
  targetId: 'target-password', tabId: 7, frameId: 0, origin: 'https://amazon.example', navigationId: 'nav-1',
  semantic: 'password', label: 'Password',
};
function field(planId: string, selector: string, semantic: ProtectedFieldRef['fieldName'], matchesOrigin: boolean): ProtectedFieldRef {
  return { planId, assetId: `${planId}-asset`, assetCode: 'login', assetName: `${planId} login`, assetType: 'USER-PSWD',
    fieldName: semantic, selector, matchesOrigin };
}

describe('page-first protected-field suggestions', () => {
  it('ranks exact-origin candidates before semantic-only candidates across plans', () => {
    const result = pageFirstSuggestions([
      { planName: 'Fallback plan', protectedFields: [field('plan-1', 'fallback.password', 'password', false)] },
      { planName: 'Amazon plan', protectedFields: [field('plan-2', 'amazon.password', 'password', true)] },
    ], [target]);
    expect(result.map(({ planName, suggestion }) => [planName, suggestion.confidence, suggestion.reason]))
      .toEqual([['Amazon plan', 'HIGH', 'exact-origin'], ['Fallback plan', 'MEDIUM', 'inferred-semantic']]);
  });

  it('returns only fields with the selected page semantic and carries metadata only', () => {
    const result = pageFirstSuggestions([{ planName: 'Plan', protectedFields: [
      field('plan-1', 'login.username', 'username', true), field('plan-1', 'login.password', 'password', true),
    ] }], [target]);
    expect(result).toHaveLength(1);
    expect(result[0]?.suggestion.mapping).toMatchObject({
      protectedField: { selector: 'login.password' }, pageTarget: { targetId: 'target-password' }, source: 'MANUAL',
    });
    expect(JSON.stringify(result)).not.toMatch(/value|secret|token/iu);
  });

  it('offers both fields of one asset in exact-first order for a single picker row', () => {
    for (const semantic of ['username', 'email'] as const) {
      const pageTarget = { ...target, semantic };
      const result = pageFirstSuggestions([{ planName: 'Plan', protectedFields: [
        field('plan-1', 'login.username', 'username', true),
        field('plan-1', 'login.email', 'email', true),
        field('plan-1', 'login.password', 'password', true),
      ] }], [pageTarget]);
      expect(result.map(({ suggestion }) => suggestion.mapping.protectedField.fieldName))
        .toEqual([semantic, semantic === 'username' ? 'email' : 'username']);
    }
  });

  it('chooses one exact field automatically when the asset field list was inferred', () => {
    for (const semantic of ['username', 'email'] as const) {
      const fields = [field('plan-1', 'login.username', 'username', true),
        field('plan-1', 'login.email', 'email', true)]
        .map((one) => ({ ...one, fieldNamesInferred: true }));
      const result = pageFirstSuggestions([{ planName: 'Plan', protectedFields: fields }],
        [{ ...target, semantic }]);
      expect(result.map(({ suggestion }) => suggestion.mapping.protectedField.fieldName)).toEqual([semantic]);
    }
  });

  it('offers a username asset for an email target and an email asset for a username target', () => {
    for (const [assetSemantic, pageSemantic] of [['username', 'email'], ['email', 'username']] as const) {
      const result = pageFirstSuggestions([{ planName: 'Plan', protectedFields: [
        field('plan-1', `login.${assetSemantic}`, assetSemantic, true),
        field('plan-1', 'login.password', 'password', true),
      ] }], [{ ...target, semantic: pageSemantic }]);
      expect(result.map(({ suggestion }) => suggestion.mapping.protectedField.fieldName)).toEqual([assetSemantic]);
    }
  });

  it('keeps distinct assets as separate choices even when their names match', () => {
    const first = field('plan-1', 'first.email', 'email', true);
    const second = { ...field('plan-1', 'second.email', 'email', true), assetId: 'second-asset', assetName: first.assetName };
    const result = pageFirstSuggestions([{ planName: 'Plan', protectedFields: [first, second] }],
      [{ ...target, semantic: 'email' }]);
    expect(result.map(({ suggestion }) => suggestion.mapping.protectedField.assetId))
      .toEqual([first.assetId, second.assetId]);
  });
});
