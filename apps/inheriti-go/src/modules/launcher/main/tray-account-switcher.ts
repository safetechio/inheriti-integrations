import type { OperatorSession, createOrganizationKeys } from '@safetech/inheriti-elements-core/node';
import type { TrayInbox } from '../../inbox/main/inbox.js';
import type { CustodianPrompt } from '../../quick-plan/main/custodian-prompt.js';
import type { TrayPlanEdit } from '../../quick-plan/main/plan-edit.js';
import type { TrayQuickPlans } from '../../quick-plan/main/quick-plans.js';
import type { createTraySafeKeyPro } from '../../quick-plan/main/safekey-pro.js';
import type { SavedAccountSummary } from './operator-session-store.js';
import type { TrayAuthRuntime } from './tray-auth-runtime.js';
import type { TrayInboxAccess } from './tray-inbox-access.js';
import type { TrayOrganizationContext } from './tray-organization-context.js';

export class TrayAccountSwitcher {
  private accounts: SavedAccountSummary[] = [];
  private activeSubject: string | undefined;
  private readonly accountOrganizations = new Map<string, { id: string; name: string }[]>();
  private switching = false;

  constructor(private readonly auth: TrayAuthRuntime, private readonly organization: TrayOrganizationContext,
    private readonly inboxAccess: TrayInboxAccess, private readonly inbox: TrayInbox,
    private readonly quickPlans: TrayQuickPlans, private readonly planEdit: TrayPlanEdit,
    private readonly keys: ReturnType<typeof createOrganizationKeys>, private readonly prompt: CustodianPrompt,
    private readonly proDevice: ReturnType<typeof createTraySafeKeyPro>, private readonly isSigningOut: () => boolean) {}

  get isSwitching(): boolean { return this.switching; }
  get snapshot(): { accounts: Array<SavedAccountSummary & { organizations: { id: string; name: string }[] }>; activeSubject: string | undefined } {
    return {
      accounts: this.accounts.map(({ subject, name, status }) => ({ subject, name, status,
        organizations: this.accountOrganizations.get(subject)?.map(({ id, name: organizationName }) => ({ id, name: organizationName })) ?? [] })),
      activeSubject: this.activeSubject,
    };
  }

  rememberOrganizations(subject: string, organizations: { id: string; name: string }[]): void {
    this.accountOrganizations.set(subject, organizations.map(({ id, name }) => ({ id, name })));
  }

  assertCanSwitch(): void {
    if (this.isSigningOut() || this.switching) throw new Error('account_transition_in_progress');
    if (this.organization.pendingSelections) throw new Error('organization_selection_in_progress');
    this.quickPlans.assertIdle();
    const creation = this.quickPlans.state().creation;
    if (creation && creation.status !== 'ready') throw new Error('creation_abandon_required');
    this.planEdit.assertIdle();
    if (this.planEdit.state().canDiscard) throw new Error('edit_discard_required');
    this.inbox.assertIdle();
  }

  async transition(subject: string, session: OperatorSession | undefined, onStart: () => void,
    onReady: (name: string | undefined, message: string | undefined) => void): Promise<void> {
    this.assertCanSwitch();
    this.inbox.beginAccountTransition();
    this.switching = true;
    try {
      onStart();
      this.organization.invalidate();
      this.inboxAccess.reset();
      this.prompt.cancel();
      this.proDevice?.clearPin();
      this.inbox.clear();
      await this.planEdit.clear();
      await this.keys.clear();
      this.quickPlans.clear();
      this.organization.reset();
      if (session) await this.auth.enroll(session);
      await this.auth.activate(subject);
      if (!await this.auth.getAccessToken()) throw new Error('reauthentication_required');
      const name = (await this.auth.sessions.load())?.principal.subject;
      await this.organization.discover(undefined, (message) => onReady(name, message));
      await this.refresh(true);
    } finally {
      this.inbox.endAccountTransition();
      this.switching = false;
    }
  }

  async refresh(signedIn: boolean): Promise<void> {
    const summary = await this.auth.accountSummaries();
    this.accounts = summary.accounts;
    this.activeSubject = summary.activeSubject;
    const saved = new Set(summary.accounts.map(({ subject }) => subject));
    for (const subject of this.accountOrganizations.keys()) if (!saved.has(subject)) this.accountOrganizations.delete(subject);
    if (summary.activeSubject && signedIn) this.rememberOrganizations(summary.activeSubject, this.organization.organizations);
  }
}
