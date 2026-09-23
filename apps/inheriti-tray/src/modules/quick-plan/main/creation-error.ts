import { trayMessages as messages } from '../../../messages.js';

export function creationErrorMessage(error: unknown): string {
  const { message, code, status } = error instanceof Error
    ? { message: error.message, code: (error as Error & { code?: string }).code, status: (error as Error & { status?: number }).status }
    : { message: '', code: undefined, status: undefined };
  switch (true) {
    case message.startsWith('Validation failed at "assets'):
      return message;
    case message === 'reconciliation_required' || code === 'reconciliation_required':
      return messages.reconciliationRequired;
    case message === 'plan_declaration_invalid' || message.startsWith('plan_asset_'):
      return messages.invalidAsset;
    case message === 'plan_storage_context_changed' || message === 'plan_share_count_invalid':
      return messages.storageChanged;
    case message === 'operator_reauthentication_required' || status === 401:
      return messages.sessionExpired;
    case message.startsWith('master_key_') || message === 'invalid_master_key_context':
      return messages.keyUnavailable;
    case code === 'team_access_denied' || code === 'team_not_found' || code === 'Selected team is not available for plan creation':
      return messages.teamUnavailable;
    case status === 402 || code === 'SUBSCRIPTION_CAPACITY_EXCEEDED':
      return messages.planCapacityReached;
    case status === 413 || status === 507 || code === 'plan_storage_capacity_exceeded' || code === 'media_storage_capacity_exceeded':
      return messages.fileTooLarge;
    default:
      return messages.retryError;
  }
}
