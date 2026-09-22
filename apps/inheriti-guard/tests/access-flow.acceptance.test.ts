import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { suggestFieldMappings } from '../src/background/field-suggestions.js';
import {
  validateAccessBatch,
  type AccessBatch,
  type FieldMapping,
  type PageFieldTarget,
  type ProtectedFieldRef,
} from '../src/shared/access-contract.js';

const identity = {
  planId: 'plan-production', tabId: 42, frameId: 0,
  origin: 'https://login.example.test', navigationId: 'navigation-7',
} as const;

const protectedFields: readonly ProtectedFieldRef[] = [
  { planId: identity.planId, assetId: 'asset-account', assetCode: 'account', assetName: 'Production account',
    assetType: 'USER-PSWD', fieldName: 'username', selector: 'account.username', matchesOrigin: true },
  { planId: identity.planId, assetId: 'asset-password', assetCode: 'password', assetName: 'Production password',
    assetType: 'USER-PSWD', fieldName: 'password', selector: 'password.password', matchesOrigin: true },
];

const pageTargets: readonly PageFieldTarget[] = [
  { ...identity, targetId: 'target-username', semantic: 'username', label: 'Account name' },
  { ...identity, targetId: 'target-password-suggested', semantic: 'password', label: 'Current password' },
  { ...identity, targetId: 'target-password-picked', semantic: 'password', label: 'Password confirmation' },
];

describe('Chrome access-flow acceptance', () => {
  it('builds a valid username/password batch from multiple assets in one plan', () => {
    const suggested = suggestFieldMappings({
      planId: identity.planId,
      protectedFields,
      pageFields: [
        { target: pageTargets[0]!, autocomplete: 'username', inputType: 'text' },
        { target: pageTargets[1]!, autocomplete: 'current-password', inputType: 'password' },
      ],
    });

    expect(suggested.accepted).toBe(true);
    if (!suggested.accepted) throw new Error('Expected suggestions');
    const batch: AccessBatch = { identity, mappings: suggested.mappings };
    expect(validateAccessBatch(batch)).toEqual({ valid: true });
    expect(new Set(batch.mappings.map(({ protectedField }) => protectedField.assetId))).toEqual(
      new Set(['asset-account', 'asset-password']),
    );
  });

  it('keeps a manual picker replacement when suggestions refresh', () => {
    const manual: FieldMapping = {
      protectedField: protectedFields[1]!, pageTarget: pageTargets[2]!, source: 'MANUAL',
    };
    const refreshed = suggestFieldMappings({
      planId: identity.planId,
      protectedFields,
      pageFields: [
        { target: pageTargets[0]!, autocomplete: 'username' },
        { target: pageTargets[1]!, autocomplete: 'current-password' },
        { target: pageTargets[2]!, inputType: 'password' },
      ],
      existingMappings: [manual],
    });

    expect(refreshed.accepted).toBe(true);
    if (!refreshed.accepted) throw new Error('Expected refreshed suggestions');
    expect(refreshed.mappings).toContainEqual(manual);
    expect(refreshed.mappings).not.toContainEqual(expect.objectContaining({
      protectedField: protectedFields[1], pageTarget: pageTargets[1], source: 'SUGGESTED',
    }));
    expect(validateAccessBatch({ identity, mappings: refreshed.mappings })).toEqual({ valid: true });
  });

  it.each([
    ['another plan', { protectedField: { ...protectedFields[0]!, planId: 'plan-other' } }, 'mixed-plan'],
    ['navigation drift', { pageTarget: { ...pageTargets[0]!, navigationId: 'navigation-8' } }, 'mixed-page'],
    ['origin drift', { pageTarget: { ...pageTargets[0]!, origin: 'https://other.example.test' } }, 'mixed-page'],
  ])('rejects %s before reveal', (_case, mutation, reason) => {
    const mapping: FieldMapping = {
      protectedField: 'protectedField' in mutation ? mutation.protectedField : protectedFields[0]!,
      pageTarget: 'pageTarget' in mutation ? mutation.pageTarget : pageTargets[0]!, source: 'SUGGESTED',
    };
    expect(validateAccessBatch({ identity, mappings: [mapping] })).toEqual({ valid: false, reason });
  });

  it('keeps protected values and credentials out of the access contract and panel DOM paths', () => {
    const contract = readFileSync(new URL('../src/shared/access-contract.ts', import.meta.url), 'utf8');
    const messages = readFileSync(new URL('../src/shared/messages.ts', import.meta.url), 'utf8');
    const panel = readFileSync(new URL('../src/side-panel/main.ts', import.meta.url), 'utf8');
    const acceptanceSurfaces = `${contract}\n${messages}\n${panel}`;

    expect(acceptanceSurfaces).not.toMatch(/\b(passphrase|masterKeySecret|accessToken|refreshToken)\b/u);
    expect(contract).not.toMatch(/readonly\s+value\s*:/u);
    expect(panel).not.toContain('innerHTML');
    expect(panel).toContain('textContent');
  });
});
