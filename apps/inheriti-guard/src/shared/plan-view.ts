export type PanelState = (
  | { kind: 'SIGNED_OUT' }
  | { kind: 'SIGNING_IN' }
  | { kind: 'LOADING' }
  | { kind: 'EMPTY' }
  | { kind: 'ERROR'; code: string }
  | { kind: 'PLANS'; plans: readonly { id: string; name: string; status: string }[] }
  | { kind: 'SELECT_ORGANIZATION'; organizations: readonly { id: string; name: string }[]; reason?: string }
) & { readonly organizations?: readonly { id: string; name: string }[]; readonly organizationId?: string };

const MESSAGES: Readonly<Record<string, string>> = {
  operator_reauthentication_required: 'Session expired — sign in again',
  plan_not_found: 'No such plan in this Application',
  plan_request_rate_limited: 'Too many requests — try again shortly',
  elements_api_unavailable: 'The plan service is unavailable — try again shortly',
  plan_request_failed: 'Could not reach the plan service',
  plan_access_denied: 'Could not verify plan access — sign in again',
  configuration_missing: 'Configure Inheriti before signing in',
  master_key_salt_required: 'This Application\'s key salt is missing — check the configuration',
  master_key_salt_unexpected: 'The stored custody and key salt come from different Applications',
  live_environment_unavailable_in_development_build: 'This build supports TEST only',
  login_cancelled: 'Sign-in was cancelled',
  sign_in_failed: 'Could not sign in',
};

/** Only our own stable codes are shown; a runtime code would tell an operator nothing. */
const STABLE_CODE = /^[a-z][a-z0-9_]{2,63}$/u;

export function codeOf(error: unknown, fallback = 'plan_request_failed'): string {
  const code = (error as { code?: unknown })?.code;
  if (typeof code === 'string' && STABLE_CODE.test(code)) return code;
  const status = (error as { status?: unknown })?.status;
  if (status === 401 || status === 403) return 'plan_access_denied';
  if (typeof status === 'number' && status >= 500) return 'elements_api_unavailable';
  return fallback;
}

export function messageFor(code: string): string {
  return MESSAGES[code] ?? 'Something went wrong';
}

export interface PanelRow {
  readonly label: string;
  readonly detail: string;
  readonly avatarId?: string;
  readonly planId?: string;
  readonly draft?: boolean;
}

export function rowsFor(state: PanelState): readonly PanelRow[] {
  if (state.kind === 'SIGNED_OUT') return [{ label: 'Not signed in', detail: 'Choose Sign in to continue' }];
  if (state.kind === 'SIGNING_IN') return [{ label: 'Signing in…', detail: 'Finish in the browser window' }];
  if (state.kind === 'LOADING') return [{ label: 'Loading plans…', detail: '' }];
  if (state.kind === 'EMPTY') return [{ label: 'No plans in this Application', detail: '' }];
  if (state.kind === 'ERROR') return [{ label: messageFor(state.code), detail: state.code }];
  if (state.kind === 'SELECT_ORGANIZATION') return [{ label: state.organizations.length ? 'Choose an organization' : 'No organizations available', detail: state.reason ?? '' }];
  return state.plans.map((plan) => ({ label: plan.name, detail: plan.status, avatarId: plan.id, ...(plan.status.toUpperCase() === 'DRAFT' ? {} : { planId: plan.id }), draft: plan.status.toUpperCase() === 'DRAFT' }));
}
