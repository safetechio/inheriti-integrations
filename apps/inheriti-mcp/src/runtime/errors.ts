export const coded = (code: string) => Object.assign(new Error(code), { code });

export const lifecycleMessages: Record<string, string> = {
  local_window_unavailable:
    'The secure window could not open. Check the desktop installation, then start a new reveal.',
  local_delivery_expired:
    'The local delivery page expired before confirmation. Start a new reveal and confirm it in the secure window in time.',
  local_delivery_canceled: 'Local delivery canceled.',
  master_key_required: 'The plan key is not available from SafeKey Mobile for this account.',
  master_key_relay_timed_out: 'Nobody released the organisation key in SafeKey Mobile in time.',
  master_key_relay_expired: 'The key release request expired. Start the reveal again.',
  master_key_relay_unavailable: 'No device holds the organisation key for this operator.',
  custodian_share_timed_out: 'Nobody approved the custodian request on SafeKey Mobile in time.',
  custodian_share_unavailable: 'The custodian share is unavailable or does not match this plan and device.',
  reveal_stopped_by_dms: "The dead man's switch subject stopped this reveal. Nothing was released.",
  reveal_authorization_ended: 'This reveal ended before authorization. Nothing was released.',
  reveal_expired: 'This reveal expired. Start it again.',
  reveal_denied: 'A participant denied this reveal. Nothing was released.',
  reveal_participant_revoked: 'A participant on this plan was revoked.',
  reveal_reconciliation_required: 'This plan is being reconciled with its source. Try again shortly.',
  plan_key_unwrap_failed: 'The organisation key could not open this plan.',
  plan_share_decryption_failed: 'A released plan share could not be decrypted.',
  plan_share_reconstruction_failed: 'The released shares could not reconstruct this plan.',
  plan_reconstruction_failed: 'The plan could not be reconstructed from the released shares.',
};
const namedCodes: Record<string, string> = {
  MasterKeyRequired: 'master_key_required',
  MasterKeyRelayTimedOut: 'master_key_relay_timed_out',
  MasterKeyRelayExpired: 'master_key_relay_expired',
};
const safeCodes = new Set([
  'organization_required',
  'organization_selection_required',
  'organization_access_denied',
  'organization_preference_invalid',
  'organization_selection_changed',
  'plan_not_found',
  'operator_reauthentication_required',
  'reauthentication_required',
  'operator_token_expired',
  'expired_token',
  'access_denied',
  'invalid_client',
  'unauthorized_client',
  'plan_request_rate_limited',
  'reveal_restart_required',
  'reveal_cancellation_failed',
  'master_key_relay_cancellation_failed',
  'asset_selector_invalid',
  'asset_not_found',
  'asset_field_not_found',
  'action_not_allowed',
  'reveal_in_progress',
  'reveal_not_found',
  'plan_creation_in_progress',
  'plan_creation_not_found',
  'plan_creation_input_changed',
  'automation_local_only',
  'automation_setup_in_progress',
  'automation_setup_not_found',
  'automation_setup_authentication_required',
  'automation_setup_permission_denied',
  'automation_setup_request_failed',
  'automation_verified_release_unavailable',
  'automation_active_grant_required',
  'automation_verified_github_required',
  'automation_github_workflow_ref_invalid',
  'automation_provider_trust_mismatch',
  'google_secret_project_invalid',
  'google_secret_name_invalid',
  'google_secret_not_managed',
  'google_secret_input_invalid',
  'google_secret_provider_failed',
  'google_secret_publication_outcome_unknown',
]);
export function safeErrorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && (safeCodes.has(code) || Object.hasOwn(lifecycleMessages, code))) return code;
  const name = (error as { name?: unknown } | null)?.name;
  if (typeof name === 'string' && Object.hasOwn(namedCodes, name)) return namedCodes[name]!;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && Object.hasOwn(lifecycleMessages, message) ? message : 'request_failed';
}
