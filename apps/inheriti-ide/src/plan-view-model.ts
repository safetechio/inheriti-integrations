import type { PlanSummary } from '@safetech/inheriti-elements-core';

export type PlanViewState =
  | { kind: 'SIGNED_OUT' }
  | { kind: 'LOADING' }
  | { kind: 'SELECT_ORGANIZATION'; count: number }
  | { kind: 'EMPTY'; organization?: string }
  | { kind: 'ERROR'; code: string }
  | { kind: 'PLANS'; plans: readonly PlanSummary[]; organization?: string };

export interface PlanRow {
  readonly label: string;
  readonly description: string;
  readonly planId?: string;
  /** Distinguishes a real plan from a placeholder, so a message can never be opened as a plan. */
  readonly contextValue: 'plan' | 'message';
}

const MESSAGES: Readonly<Record<string, string>> = {
  operator_reauthentication_required: 'Session expired — sign in again',
  plan_request_rate_limited: 'Too many requests — try again shortly',
  elements_api_unavailable: 'The plan service is unavailable — try again shortly',
  plan_request_failed: 'Could not reach the plan service',
  configuration_missing: 'Configure Inheriti in settings first',
  live_environment_unavailable_in_development_build: 'This build supports TEST only',
  action_not_allowed: 'This VS Code registration is not allowed to insert that field',
  reveal_insert_unavailable: 'This plan has no text fields available to insert',
  download_asset_unavailable: 'This plan has no binary assets available to download',
  download_local_file_required: 'Choose a local file for this download',
  EEXIST: 'That file already exists. Choose a new name; downloads never overwrite files',
  ENOENT: 'The chosen download folder does not exist',
  EACCES: 'The chosen file cannot be created',
  reveal_authorization_ended: 'The reveal could not be authorized',
  reveal_stopped_by_dms: 'The dead man\'s switch subject stopped this reveal — nothing was released',
  organization_access_denied: 'The selected organization is no longer available',
  organization_required: 'No eligible Business organizations are available',
  organization_selection_required: 'Choose a Business organization to view plans',
  operator_not_signed_in: 'Sign in to choose a Business organization',
};

export function messageFor(code: string, keyOwner: 'Application' | 'Organisation' = 'Application'): string {
  if (code === 'plan_not_found') return `No such plan in this ${keyOwner}`;
  if (code === 'master_key_required') return `The ${keyOwner} key is not available from SafeKey Mobile for this account`;
  return MESSAGES[code] ?? 'Could not load plans';
}

/**
 * Every state renders as a distinct row, so "signed out", "no plans" and "the request failed" are
 * never the same blank list. Server facts only: a row shows what the plan says, nothing derived.
 */
export function rowsFor(state: PlanViewState, keyOwner: 'Application' | 'Organisation' = 'Application'): readonly PlanRow[] {
  if (state.kind === 'SIGNED_OUT') return [message('Not signed in', 'Run “Inheriti: Sign In”')];
  if (state.kind === 'LOADING') return [message('Loading plans…', '')];
  if (state.kind === 'SELECT_ORGANIZATION') return [message(
    state.count === 0 ? 'No eligible Business organizations' : 'Choose a Business organization',
    state.count === 0 ? '' : 'Run “Inheriti: Select Business Organization”',
  )];
  if (state.kind === 'EMPTY') return [message(state.organization ? `No plans in ${state.organization}` : `No plans in this ${keyOwner}`, '')];
  if (state.kind === 'ERROR') return [message(messageFor(state.code, keyOwner), state.code)];
  return [
    ...(state.organization ? [message(`Organization: ${state.organization}`, '')] : []),
    ...state.plans.map((plan) => ({
    label: plan.name,
    description: statusOf(plan),
    planId: plan.id,
    contextValue: 'plan' as const,
    })),
  ];
}

function statusOf(plan: PlanSummary): string {
  const status = plan.status as string | { kind: 'UNKNOWN'; raw: string };
  return typeof status === 'string' ? status : status.raw;
}

function message(label: string, description: string): PlanRow {
  return { label, description, contextValue: 'message' };
}
