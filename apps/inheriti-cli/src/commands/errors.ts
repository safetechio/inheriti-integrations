import { CliConfigurationInvalid } from '../configuration.js';
import { OrganizationChoiceRequired } from '../organizations.js';
import { UsePlanInvalid } from './use.js';

/** Operators see a mapped message; a stable code is kept for support without a stack trace. */
export function messageFor(error: unknown, business = false): string {
  if (error instanceof OrganizationChoiceRequired) return error.message;
  if (error instanceof CliConfigurationInvalid) return error.message;
  if (error instanceof UsePlanInvalid) return error.message;
  const networkCode = (error as { cause?: { code?: unknown } })?.cause?.code;
  if (networkCode === 'ECONNREFUSED' || networkCode === 'ENOTFOUND' || networkCode === 'ETIMEDOUT' || networkCode === 'UND_ERR_CONNECT_TIMEOUT') {
    return 'Cannot connect to the Inheriti API.';
  }
  const name = (error as { name?: unknown })?.name;
  if (name === 'MasterKeyRequired') {
    const system = (error as { ref?: { system?: unknown } }).ref?.system;
    return system === 'INHERITI_BUSINESS'
      ? 'The Organisation key is not available from SafeKey Mobile for this account.'
      : 'The Application key is not available from SafeKey Mobile for this account.';
  }
  const code = (error as { code?: unknown })?.code;
  if (business && code === 'plan_not_found') return 'No such plan in this Organisation.';
  if (business && code === 'action_not_allowed') return 'This Organisation is not allowed to open that. Check the integration capabilities and the asset type.';
  const deviceError = (error as { message?: unknown })?.message;
  if (typeof deviceError === 'string' && deviceError.startsWith('SAFEKEY_')) return MESSAGES[deviceError] ?? 'SafeKey PRO could not complete the operation.';
  if (code === 'governance_denied') return (error as Error).message;
  const reason = (error as { reason?: unknown })?.reason;
  if (code === 'plan_share_reconstruction_failed' && typeof reason === 'string') {
    return RECONSTRUCTION_MESSAGES[reason] ?? MESSAGES.plan_share_reconstruction_failed!;
  }
  if (typeof code === 'string') return MESSAGES[code] ?? code;
  const message = (error as { message?: unknown })?.message;
  if (typeof message === 'string' && Object.hasOwn(MESSAGES, message)) return MESSAGES[message]!;
  return typeof name === 'string' && name !== 'Error' ? MESSAGES[name] ?? name : 'The command failed.';
}

export function planCreationFailureMessage(stage: 'key' | 'context' | 'save', error: unknown): string {
  const status = (error as { status?: unknown })?.status;
  if (status === 401) return MESSAGES.operator_reauthentication_required!;
  if (status === 402) return 'The Organisation has reached its plan capacity.';
  const code = (error as { code?: unknown; message?: unknown })?.code
    ?? (error as { message?: unknown })?.message;
  if (code === 'plan_creation_input_changed') return MESSAGES.plan_creation_input_changed!;
  if (code === 'master_key_not_claimed') return MESSAGES.master_key_not_claimed!;
  if (code === 'plan_storage_context_changed') return MESSAGES.plan_storage_context_changed!;
  if (code === 'plan_share_count_invalid') return MESSAGES.plan_share_count_invalid!;
  if (code === 'reconciliation_required') return MESSAGES.reconciliation_required!;
  if (stage === 'key') return 'Could not obtain the Organisation key. Check SafeKey Mobile and retry.';
  if (stage === 'context') return 'Could not prepare the plan. Check your Organisation access and retry.';
  return 'Could not save the plan. Check your access and plan data before retrying.';
}

const RECONSTRUCTION_MESSAGES: Readonly<Record<string, string>> = {
  insufficient_valid_data_shards: 'The reveal did not receive enough data shares for this plan.',
  insufficient_valid_key_shards: 'The reveal did not receive enough key shares for this plan.',
  mixed_share_sets: 'The released shares belong to different plan generations.',
  threshold_metadata_mismatch: 'The released shares do not match this plan\'s recovery threshold.',
  duplicate_data_shard: 'The reveal received the same data share more than once.',
  duplicate_key_shard: 'The reveal received the same key share more than once.',
  plan_binding_mismatch: 'A released share belongs to a different plan.',
  ciphertext_digest_mismatch: 'The released data shares could not recover the protected data.',
  v2_authentication_failed: 'The released key shares could not open the protected data.',
  shard_kind_mismatch: 'A released custodian share has the wrong type.',
  invalid_envelope_magic: 'A released share is not valid SSDP+ v2 material.',
  invalid_base64url: 'A released share has an invalid encoding.',
  envelope_truncated: 'A released share is incomplete.',
  crc32c_mismatch: 'A released share failed its integrity check.',
  insufficient_shards: 'The reveal did not receive enough data shares for this plan.',
  insufficient_key_shards: 'The reveal did not receive enough key shares for this plan.',
  conflicting_key_shards: 'The released key shares do not belong together.',
  duplicate_shard: 'The reveal received the same data share more than once.',
  invalid_shard_kind: 'A released share has the wrong type.',
  unsupported_envelope_version: 'A released share uses an unsupported SSDP+ version.',
  unsupported_v2_suite: 'A released share uses an unsupported SSDP+ suite.',
  ssdp_v2_worker_failed: 'The local SSDP+ reconstruction worker failed.',
  ssdp_v2_worker_not_configured: 'The local SSDP+ reconstruction worker is unavailable.',
  unexpected_ssdp_v2_worker_response: 'The local SSDP+ reconstruction worker returned an invalid response.',
};

export const MESSAGES: Readonly<Record<string, string>> = {
  operator_not_signed_in: 'Not signed in. Run `inheriti login` first.',
  business_context_required: 'Set business: true in the CLI configuration to use organizations.',
  automation_disabled: 'Automation is unavailable.',
  automation_aws_publication_outcome_unknown: 'AWS publication was interrupted. An in-flight write may have completed; inspect target versions before retrying.',
  automation_aws_publication_value_invalid: 'A selected plan field could not be serialized for AWS publication.',
  google_secret_project_invalid: 'Enter the exact Google Cloud project ID.',
  google_secret_name_invalid: 'The Google Cloud secret name is invalid. Check the prefix and mapped key.',
  google_secret_not_managed: 'This Google Cloud secret was not created by Inheriti. Choose another prefix.',
  google_secret_input_invalid: 'Check the Google Cloud project, secret prefix, and field mappings.',
  google_secret_provider_failed: 'Google Cloud Secret Manager rejected this request. Check credentials and IAM permissions.',
  google_secret_value_invalid: 'A selected plan field could not be serialized for Google Cloud publication.',
  google_secret_publication_outcome_unknown: 'Google Cloud publication was interrupted. Inspect target versions before retrying; an in-flight write may have completed.',
  automation_setup_authentication_required: 'Sign in again to manage automation.',
  automation_setup_permission_denied: 'You cannot manage automation for this organisation or plan.',
  automation_setup_request_failed: 'Business did not accept this automation request. Check your access and entries.',
  automation_verified_release_unavailable: 'A verified GitHub Action and CLI release is not available yet. No workflow was generated.',
  automation_github_workflow_ref_invalid: 'The verified GitHub connection has an invalid or mismatched workflow file or branch. Correct its ' +
    'trust settings and verify again.',
  organization_preference_invalid: 'The saved organisation preference is unreadable. Check organizations.json.',
  organization_command_invalid: 'Usage: inheriti organizations list | organizations use [id]',
  plan_id_required: 'Which plan? Pass a plan id, or run this in a terminal to pick one.',
  PlanIdRequired: 'Which plan? Pass a plan id, or run this in a terminal to pick one.',
  operator_reauthentication_required: 'The session expired. Run `inheriti login` again.',
  operator_session_changed: 'The signed-in session changed during this command. Retry with the current account.',
  plan_not_found: 'No such plan in this Application.',
  plan_request_rate_limited: 'Too many requests. Try again shortly.',
  elements_api_unavailable: 'The plan service is unavailable. Try again shortly.',
  plan_request_failed: 'Could not reach the plan service.',
  session_file_corrupt: 'The stored session was unreadable and has been cleared. Sign in again.',
  session_file_unreadable: 'The stored session could not be read. Check access to the CLI state folder, then retry.',
  session_permissions_widened: 'The stored session was readable by others and has been cleared. Sign in again.',
  InteractiveTerminalRequired: 'Signing in needs an interactive terminal.',
  BrowserUnavailable: 'Could not open a browser. Open the sign-in URL printed in the terminal.',
  local_window_unavailable: 'Could not open the plan window. Check the CLI installation and try again.',
  local_plan_canceled: 'Plan creation canceled.',
  local_plan_expired: 'The plan window expired. Start again when ready.',
  plan_creation_input_changed: 'The plan details changed during creation. Close the window and start plan creation again.',
  master_key_not_claimed: 'Claim the Organisation key in SafeKey Mobile before creating a plan.',
  plan_storage_context_changed: 'The plan storage settings changed. Start plan creation again.',
  plan_share_count_invalid: 'The plan storage settings cannot protect this plan. Review the storage configuration.',
  reconciliation_required: 'This Organisation is being reconciled. Try again shortly.',
  login_could_not_open_a_browser: 'Could not open a browser. Open the sign-in URL printed in the terminal.',
  OperatorNotSignedIn: 'Not signed in. Run `inheriti login` first.',
  AbortError: 'Reveal canceled.',
  use_canceled: 'Secret delivery canceled.',
  reveal_cancellation_failed: 'The local reveal stopped, but server cancellation could not be confirmed. Run `inheriti plans abort ' +
    'PLAN_ID` with this plan ID before revealing again, or wait for the request to expire.',
  master_key_relay_cancellation_failed: 'Could not confirm cancellation in SafeKey Mobile. The release request may still be pending; wait for ' +
    'it to expire before trying again.',
  master_key_required: 'The plan key is not available from SafeKey Mobile for this account.',
  master_key_cache_clear_failed: 'Could not clear the cached plan keys. Unlock the OS credential store and retry.',
  MasterKeyRelayTimedOut: 'Nobody released the organisation key in SafeKey Mobile in time.',
  master_key_relay_timed_out: 'Nobody released the organisation key in SafeKey Mobile in time.',
  MasterKeyRelayExpired: 'The key release request expired before it was answered. Start the reveal again.',
  master_key_relay_expired: 'The key release request expired before it was answered. Start the reveal again.',
  master_key_relay_unavailable: 'No device holds the organisation key for this operator, so it cannot be released to this host.',
  reveal_stopped_by_dms: 'The dead man\'s switch subject stopped this reveal. Nothing was released.',
  reveal_authorization_ended: 'This reveal ended before it was authorized. Nothing was released.',
  reveal_expired: 'This reveal expired. Start it again.',
  reveal_denied: 'A participant denied this reveal. Nothing was released.',
  reveal_participant_revoked: 'A participant on this plan was revoked, so it cannot be opened.',
  reveal_reconciliation_required: 'This plan is being reconciled with its source. Try again shortly.',
  reveal_restart_required: 'An earlier reveal of this plan cannot continue. Run `inheriti plans abort PLAN_ID` with this plan ' +
    'ID, then retry your reveal command.',
  custodian_share_timed_out: 'Nobody approved the custodian request on SafeKey Mobile in time.',
  custodian_share_unavailable: 'The custodian share is unavailable or does not match this plan and device.',
  safekey_pro_local_device_required: 'This plan uses SafeKey PRO. Open it locally with a connected SafeKey PRO device; this runner cannot release that share.',
  SAFEKEY_INTERACTIVE_REQUIRED: 'SafeKey PRO needs an interactive terminal to enter its PIN.',
  SAFEKEY_ABORTED: 'SafeKey PRO operation canceled.',
  SAFEKEY_TIMEOUT: 'SafeKey PRO did not respond in time. Try again.',
  SAFEKEY_TOUCH_REQUIRED: 'SafeKey PRO did not confirm the touch. Try again.',
  SAFEKEY_INVALID_PIN: 'SafeKey PRO rejected the PIN.',
  SAFEKEY_NOT_FOUND: 'The plan share was not found on this SafeKey PRO.',
  SAFEKEY_SHARE_MISMATCH: 'This SafeKey PRO share does not belong to the requested plan.',
  SAFEKEY_DEVICE_FAILED: 'Could not communicate with SafeKey PRO. Check the device and try again.',
  plan_key_unwrap_failed: 'The Organisation key released by SafeKey Mobile could not open this plan.',
  plan_share_decryption_failed: 'One of the released plan shares could not be decrypted.',
  plan_share_reconstruction_failed: 'The released shares could not reconstruct this plan.',
  plan_reconstruction_failed: 'The plan could not be reconstructed from the released shares.',
  plaintext_acknowledgment_required: 'Plaintext output requires --allow-plaintext-output.',
  plaintext_terminal_rejected: 'Plaintext output requires non-terminal stdout.',
  clipboard_ttl_invalid: 'Invalid clipboard duration.',
  clipboard_unavailable: 'The reveal succeeded, but this terminal could not access the desktop clipboard. Nothing was printed.',
  asset_selector_invalid: 'Use an asset code or ID followed by a field name, for example prod-db.password.',
  asset_not_found: 'The requested asset is not in this plan. List the plan assets and check its code or ID.',
  asset_field_not_found: 'The requested field is not declared for this asset. List the available fields and choose one of them.',
  asset_value_invalid: 'The protected asset could not be decoded or is missing required data. Check the asset in the ' +
    'application where it was created before retrying.',
  asset_decoder_required: 'This integration cannot decode the protected asset. Update the CLI and try again.',
  EEXIST: 'The output file already exists. Choose a new path; downloads never overwrite files.',
  ENOENT: 'The output directory does not exist.',
  EACCES: 'The output file cannot be created at that path.',
  child_process_start_failed: 'The approved executable could not be started. No secret was printed.',
  child_command_failed: 'The executable exited unsuccessfully. No secret was printed by Inheriti.',
  child_command_signaled: 'The executable was terminated by a signal. No secret was printed by Inheriti.',
  secret_delivery_failed: 'The secret could not be delivered to the approved process.',
  secret_delivery_incomplete: 'The approved process exited before receiving every mapped secret.',
  use_ttl_expired: 'The approved use lifetime expired. The child process was stopped and the reveal was closed.',
  action_not_allowed: 'This Application is not allowed to open that. Check the registration\'s capabilities and the asset type.',
  operator_scope_denied: 'This login is missing a scope this command needs. Sign in again.',
  credential_scope_denied: 'This login is missing a scope this command needs. Sign in again.',
  step_up_approval_required: 'This needs a step-up approval before it can continue.',
  ElementsApiRequestFailed: 'The plan service refused the request without a reason. Try again, or check the API log.',
};
