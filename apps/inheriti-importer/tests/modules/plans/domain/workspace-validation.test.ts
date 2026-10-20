import { describe, expect, it } from 'vitest';
import { SensitiveValue, createEmptyImportSession } from '@modules/import/domain/import-model';
import { validatePlanForExecution } from '@modules/plans/domain/workspace-validation';
import { makePlanDraft } from '@modules/plans/domain/workspace-model';
import { validateAssetEditorValues } from '@modules/plans/domain/asset-metadata';

describe('validatePlanForExecution', () => {
  it('reports the length limit for an oversized email', () => {
    expect(
      validateAssetEditorValues('USER-PSWD', {
        meta: {},
        secret: { email: `${'a'.repeat(250)}@example.com` },
      })['secret.email'],
    ).toBe('Please enter a value of max 254 chars');
  });

  it('rejects a source binding that no longer exists', () => {
    const plan = makePlanDraft('plan-1', 'Imported Plan');
    plan.assets.push({
      id: 'asset-1',
      type: 'PLAIN-TEXT',
      name: 'Notes',
      fieldBindings: { 'secret.text': { kind: 'source', sourceFieldId: 'missing' } },
    });

    const result = validatePlanForExecution(plan, createEmptyImportSession('session-1'));

    expect(result.valid).toBe(false);
    expect(result.materialisationErrors[0]?.code).toBe('MISSING_SOURCE_FIELD');
    expect(result.issues.at(-1)?.code).toBe('STALE_REFERENCE');
  });

  it('allows a complete literal Asset to execute', () => {
    const plan = makePlanDraft('plan-1', 'Imported Plan');
    plan.assets.push({
      id: 'asset-1',
      type: 'PLAIN-TEXT',
      name: 'Notes',
      fieldBindings: { 'secret.text': { kind: 'literal', value: new SensitiveValue('hello') } },
    });

    expect(validatePlanForExecution(plan, createEmptyImportSession('session-1')).valid).toBe(true);
  });

  it('rejects values that fail the canonical Asset editor validation', () => {
    const plan = makePlanDraft('plan-1', 'Imported Plan');
    plan.assets.push({
      id: 'asset-1',
      type: 'USER-PSWD',
      name: 'Account',
      fieldBindings: {
        'secret.email': { kind: 'literal', value: new SensitiveValue('not-an-email') },
      },
    });

    const result = validatePlanForExecution(plan, createEmptyImportSession('session-1'));

    expect(result.valid).toBe(false);
    expect(result.materialisationErrors).toContainEqual(
      expect.objectContaining({
        assetFieldSource: 'secret.email',
        code: 'INVALID_VALUE',
        message: 'Invalid email',
      }),
    );
  });
});
