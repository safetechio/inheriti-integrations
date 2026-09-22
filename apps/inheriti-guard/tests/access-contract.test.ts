import { describe, expect, it } from 'vitest';
import {
  validateAccessBatch,
  type AccessBatch,
  type AccessFieldSuggestion,
  type FieldMapping,
} from '../src/shared/access-contract.js';
import {
  isSidePanelRequest,
  type AccessWorkspaceResponse,
} from '../src/shared/messages.js';

const identity = {
  planId: 'plan-1', tabId: 7, frameId: 0, origin: 'https://accounts.example.test', navigationId: 'nav-1',
} as const;

function mapping(selector: string, targetId: string): FieldMapping {
  return {
    protectedField: {
      planId: identity.planId, assetId: 'asset-1', assetCode: 'login', assetName: 'Production login',
      assetType: 'LOGIN', fieldName: 'username', selector, matchesOrigin: true,
    },
    pageTarget: {
      targetId, tabId: identity.tabId, frameId: identity.frameId, origin: identity.origin,
      navigationId: identity.navigationId, semantic: 'username', label: 'Username',
    },
    source: 'SUGGESTED',
  };
}

function batch(...mappings: FieldMapping[]): AccessBatch {
  return { identity, mappings };
}

describe('access batch contract', () => {
  it('accepts multiple fields from the same plan and page identity', () => {
    expect(validateAccessBatch(batch(
      mapping('login.username', 'target-1'),
      mapping('login.password', 'target-2'),
    ))).toEqual({ valid: true });
  });

  it('rejects a protected field from another plan', () => {
    const otherPlan = mapping('other.password', 'target-2');
    expect(validateAccessBatch(batch({
      ...otherPlan, protectedField: { ...otherPlan.protectedField, planId: 'plan-2' },
    }))).toEqual({ valid: false, reason: 'mixed-plan' });
  });

  it.each([
    ['tabId', 8], ['frameId', 2], ['origin', 'https://other.example.test'], ['navigationId', 'nav-2'],
  ] as const)('rejects a target with another %s', (property, value) => {
    const stale = mapping('login.username', 'target-1');
    expect(validateAccessBatch(batch({
      ...stale, pageTarget: { ...stale.pageTarget, [property]: value },
    }))).toEqual({ valid: false, reason: 'mixed-page' });
  });

  it('rejects duplicate protected selectors and page targets', () => {
    expect(validateAccessBatch(batch(
      mapping('login.username', 'target-1'), mapping('login.username', 'target-2'),
    ))).toEqual({ valid: false, reason: 'duplicate-protected-field' });
    expect(validateAccessBatch(batch(
      mapping('login.username', 'target-1'), mapping('login.password', 'target-1'),
    ))).toEqual({ valid: false, reason: 'duplicate-page-target' });
  });

  it('rejects an empty batch', () => {
    expect(validateAccessBatch(batch())).toEqual({ valid: false, reason: 'empty-batch' });
  });

  it.each([
    { type: 'load-access-workspace', planId: 'plan-1' },
    { type: 'load-page-first-candidates' },
    { type: 'start-page-first-picker' },
    { type: 'select-page-first-candidate', mapping: mapping('login.username', 'target-1'), planName: 'Plan one' },
    { type: 'discard-access-workspace' },
    { type: 'start-page-field-picker', protectedField: mapping('login.username', 'target-1').protectedField },
    { type: 'cancel-page-field-picker' },
    { type: 'set-access-mapping', mapping: mapping('login.username', 'target-1') },
    { type: 'remove-access-mapping', selector: 'login.username' },
    { type: 'reveal-and-autofill', batch: batch(mapping('login.username', 'target-1')) },
  ])('allows the $type message through the worker boundary', (request) => {
    expect(isSidePanelRequest(request)).toBe(true);
  });

  it('freezes metadata-only suggestion presentation on workspace load', () => {
    const suggestion = {
      mapping: mapping('login.username', 'target-1'),
      confidence: 'HIGH',
      reason: 'autocomplete',
    } satisfies AccessFieldSuggestion;
    const response = {
      ok: true,
      protectedFields: [suggestion.mapping.protectedField],
      pageTargets: [suggestion.mapping.pageTarget],
      suggestions: [suggestion],
    } satisfies AccessWorkspaceResponse;

    expect(response.suggestions).toEqual([{
      mapping: suggestion.mapping,
      confidence: 'HIGH',
      reason: 'autocomplete',
    }]);
  });

  it('defines a metadata-only success response for discarding the workspace draft', () => {
    const response = { ok: true, discarded: true } satisfies AccessWorkspaceResponse;
    expect(response).toEqual({ ok: true, discarded: true });
  });
});
