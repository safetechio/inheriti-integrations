import { expect, it } from 'vitest';
import { lifecycleMessages, safeErrorCode } from '../src/runtime/errors.js';

it('preserves only the governance code and safe repair copy', () => {
  const error = Object.assign(new Error('PLAN_GOVERNANCE_RECONFIGURATION_REQUIRED'), {
    details: { error: 'plan_governance_reconfiguration_required', description: 'private diagnostic' },
  });
  const code = safeErrorCode(error);
  expect(code).toBe('plan_governance_reconfiguration_required');
  expect(lifecycleMessages[code]).toContain('Update Moderators in Inheriti Business plan settings');
  expect(lifecycleMessages[code]).not.toContain('private diagnostic');
});
