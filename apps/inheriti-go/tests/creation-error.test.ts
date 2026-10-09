import { describe, expect, it } from 'vitest';
import { creationErrorMessage } from '../src/modules/quick-plan/main/creation-error.js';
import { trayMessages as messages } from '../src/messages.js';

describe('creation errors', () => {
  it('preserves safe Core field validation and maps recovery errors', () => {
    expect(creationErrorMessage(new Error('Validation failed at "assets[0].secret.email" → Invalid email')))
      .toContain('assets[0].secret.email');
    expect(creationErrorMessage(new Error('reconciliation_required'))).toBe(messages.reconciliationRequired);
    expect(creationErrorMessage(new Error('plan_storage_context_changed'))).toBe(messages.storageChanged);
    expect(creationErrorMessage(new Error('plan_share_count_invalid'))).toBe(messages.storageSharesInvalid);
    expect(creationErrorMessage(Object.assign(new Error('conflict'), { code: 'team_not_found', status: 403 }))).toBe(messages.teamUnavailable);
    expect(creationErrorMessage(Object.assign(new Error('capacity'), { status: 507 }))).toBe(messages.fileTooLarge);
    expect(creationErrorMessage(new Error('Bearer abc123'))).toBe(messages.retryError);
  });
});
