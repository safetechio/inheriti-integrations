import { describe, expect, it } from 'vitest';
import {
  suggestFieldMappings,
  type AccessFieldSuggestion,
  type SuggestionPageField,
} from '../src/background/field-suggestions.js';
import type { FieldMapping, ProtectedFieldRef, ProtectedFieldSemantic } from '../src/shared/access-contract.js';

const planId = 'plan-1';

function protectedField(
  selector: string,
  fieldName: ProtectedFieldSemantic,
  matchesOrigin = false,
): ProtectedFieldRef {
  return {
    planId, assetId: 'asset-1', assetCode: 'login', assetName: 'Production login', assetType: 'LOGIN',
    fieldName, selector, matchesOrigin,
  };
}

function pageField(
  targetId: string,
  semantic: ProtectedFieldSemantic,
  metadata: Omit<SuggestionPageField, 'target'> = {},
): SuggestionPageField {
  return {
    target: {
      targetId, tabId: 7, frameId: 0, origin: 'https://accounts.example.test', navigationId: 'nav-1',
      semantic, label: targetId,
    },
    ...metadata,
  };
}

describe('field suggestions', () => {
  it('ranks exact autocomplete before type and label heuristics', () => {
    const result = suggestFieldMappings({
      planId,
      protectedFields: [protectedField('login.username', 'username')],
      pageFields: [
        pageField('label', 'username', { accessibleLabel: 'Username' }),
        pageField('type', 'username', { inputType: 'text' }),
        pageField('autocomplete', 'username', { autocomplete: 'username' }),
      ],
    });
    expect(result).toMatchObject({ accepted: true });
    if (!result.accepted) return;
    const suggestion: AccessFieldSuggestion | undefined = result.suggestions[0];
    expect(suggestion).toMatchObject({
      mapping: { pageTarget: { targetId: 'autocomplete' } }, confidence: 'HIGH', reason: 'autocomplete',
    });
  });

  it('ranks exact matchOrigins fields first and allocates every target once', () => {
    const result = suggestFieldMappings({
      planId,
      protectedFields: [
        protectedField('fallback.username', 'username'),
        protectedField('exact.username', 'username', true),
      ],
      pageFields: [
        pageField('target-1', 'username', { autocomplete: 'username' }),
        pageField('target-2', 'username', { inputType: 'text' }),
      ],
    });
    if (!result.accepted) throw new Error('unexpected rejection');
    expect(result.suggestions.map(({ mapping }) => [
      mapping.protectedField.selector, mapping.pageTarget.targetId,
    ])).toEqual([
      ['exact.username', 'target-1'],
      ['fallback.username', 'target-2'],
    ]);
  });

  it('uses accessible label, name, then id as deterministic metadata-only heuristics', () => {
    const fields = [
      pageField('id', 'email', { elementId: 'email' }),
      pageField('name', 'email', { name: 'email' }),
      pageField('label', 'email', { accessibleLabel: 'Email address' }),
    ];
    const result = suggestFieldMappings({
      planId, protectedFields: [protectedField('login.email', 'email')], pageFields: fields,
    });
    if (!result.accepted) throw new Error('unexpected rejection');
    expect(result.suggestions[0]).toMatchObject({
      mapping: { pageTarget: { targetId: 'label' } }, confidence: 'MEDIUM', reason: 'accessible-label',
    });
  });

  it('preserves a manual mapping when suggestions refresh', () => {
    const manual: FieldMapping = {
      protectedField: protectedField('login.username', 'username'),
      pageTarget: pageField('manual-target', 'username').target,
      source: 'MANUAL',
    };
    const result = suggestFieldMappings({
      planId,
      protectedFields: [manual.protectedField, protectedField('login.password', 'password')],
      pageFields: [
        pageField('manual-target', 'username', { autocomplete: 'username' }),
        pageField('password-target', 'password', { autocomplete: 'current-password' }),
      ],
      existingMappings: [manual],
    });
    if (!result.accepted) throw new Error('unexpected rejection');
    expect(result.mappings).toEqual([
      manual,
      expect.objectContaining({
        protectedField: expect.objectContaining({ selector: 'login.password' }),
        pageTarget: expect.objectContaining({ targetId: 'password-target' }),
        source: 'SUGGESTED',
      }),
    ]);
  });

  it('rejects mixed plans and duplicate protected selectors or page targets', () => {
    const field = protectedField('login.username', 'username');
    expect(suggestFieldMappings({
      planId, protectedFields: [{ ...field, planId: 'plan-2' }], pageFields: [],
    })).toEqual({ accepted: false, reason: 'mixed-plan' });
    expect(suggestFieldMappings({
      planId, protectedFields: [field, field], pageFields: [],
    })).toEqual({ accepted: false, reason: 'duplicate-protected-field' });
    const target = pageField('target-1', 'username');
    expect(suggestFieldMappings({
      planId, protectedFields: [field], pageFields: [target, target],
    })).toEqual({ accepted: false, reason: 'duplicate-page-target' });
  });
});
