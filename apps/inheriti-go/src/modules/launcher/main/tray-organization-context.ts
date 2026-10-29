import type { BusinessOrganization } from '@safetech/inheriti-elements-core/node';
import type { TrayQuickPlans } from '../../quick-plan/main/quick-plans.js';
import type { TrayPlanEdit } from '../../quick-plan/main/plan-edit.js';
import type { TrayInbox } from '../../inbox/main/inbox.js';
import { trayMessages as messages } from '../../../messages.js';
import type { TrayAuthRuntime } from './tray-auth-runtime.js';

export class TrayOrganizationContext {
  private known: BusinessOrganization[] = [];
  private selected: string | undefined;
  private role: string | undefined;
  private revision = 0;
  private selections = 0;

  constructor(private readonly auth: TrayAuthRuntime, private readonly quickPlans: TrayQuickPlans,
    private readonly planEdit: TrayPlanEdit, private readonly inbox: TrayInbox,
    private readonly clearKeys: () => Promise<void>, private readonly cancelInboxAccess: () => void,
    private readonly isSignedIn: () => boolean, private readonly isSigningOut: () => boolean) {}

  get organizations(): BusinessOrganization[] { return this.known; }
  get selectedId(): string | undefined { return this.selected; }
  get selectedRole(): string | undefined { return this.role; }
  get pendingSelections(): number { return this.selections; }

  reset(): void {
    ++this.revision;
    this.known = [];
    this.selected = undefined;
    this.role = undefined;
  }

  invalidate(): void { ++this.revision; }

  async select(id: string): Promise<void> {
    if (this.isSigningOut()) throw new Error('sign_out_in_progress');
    if (this.selections) throw new Error('organization_selection_in_progress');
    if (!this.known.some((organization) => organization.id === id)) throw new Error('organization_access_denied');
    ++this.revision;
    this.selections += 1;
    try {
      this.quickPlans.assertCanSelectOrganization(id);
      if (this.selected !== id) {
        this.cancelInboxAccess();
        this.inbox.clear();
        await this.clearKeys();
      }
      await this.planEdit.selectOrganization(id);
      await this.quickPlans.selectOrganization(id);
      this.selected = id;
      this.role = undefined;
      try { this.role = await this.auth.currentRole(id); } catch { /* The role is optional in the menu. */ }
      try { this.auth.sessions.saveSelectedOrganization(id); } catch { /* Organisation selection still works without a saved preference. */ }
    } finally {
      this.selections -= 1;
      if (this.isSignedIn() && this.selected && !this.isSigningOut()) this.inbox.listen();
    }
  }

  async discover(signal: AbortSignal | undefined, onReady: (message: string | undefined) => void): Promise<void> {
    const revision = ++this.revision;
    const core = this.auth.core;
    const organizations = await core.listOrganizations();
    if (signal?.aborted || revision !== this.revision || core !== this.auth.core) return;
    this.known = organizations;
    if (!this.selected) {
      try { this.selected = this.auth.sessions.selectedOrganization(); } catch { /* Use the organisation picker if secure storage is unavailable. */ }
    }
    if (!this.known.some(({ id }) => id === this.selected)) {
      this.quickPlans.clear();
      this.cancelInboxAccess();
      this.inbox.clear();
      this.planEdit.reset();
      this.selected = this.known.length === 1 ? this.known[0]?.id : undefined;
      this.role = undefined;
    }
    if (this.selected) {
      try { this.auth.sessions.saveSelectedOrganization(this.selected); } catch { /* The active organisation remains usable. */ }
    }
    if (this.selected) {
      await this.quickPlans.selectOrganization(this.selected);
      if (signal?.aborted || revision !== this.revision || core !== this.auth.core) return;
      await this.planEdit.selectOrganization(this.selected);
      if (signal?.aborted || revision !== this.revision || core !== this.auth.core) return;
      let role: string | undefined;
      try { role = await this.auth.currentRole(this.selected); } catch { /* The role is optional in the menu. */ }
      if (signal?.aborted || revision !== this.revision || core !== this.auth.core) return;
      this.role = role;
      onReady(this.known.length === 0 ? messages.noOrganizations : undefined);
      this.inbox.listen();
      return;
    }
    onReady(this.known.length === 0 ? messages.noOrganizations : undefined);
  }

  async refresh(): Promise<{ changed: boolean; message: string | undefined }> {
    if (!this.isSignedIn() || this.selections) return { changed: false, message: undefined };
    const revision = ++this.revision;
    const selectedId = this.selected;
    const organizations = await this.auth.core.listOrganizations();
    if (revision !== this.revision || !this.isSignedIn() || this.selections || this.selected !== selectedId) return { changed: false, message: undefined };
    if (selectedId && !organizations.some(({ id }) => id === selectedId)) {
      try {
        this.quickPlans.assertIdle();
        this.planEdit.assertIdle();
      } catch { // shortcut: defer revocation during active plan work, retry when the tray opens again.
        return { changed: false, message: undefined };
      }
    }
    this.known = organizations;
    if (selectedId && !organizations.some(({ id }) => id === selectedId)) {
      this.quickPlans.clear();
      this.cancelInboxAccess();
      this.inbox.clear();
      this.planEdit.reset();
      this.selected = undefined;
      this.role = undefined;
      await this.clearKeys();
    } else if (selectedId) {
      let role: string | undefined;
      try { role = await this.auth.currentRole(selectedId); } catch { /* The role is optional in the menu. */ }
      if (revision !== this.revision || !this.isSignedIn() || this.selected !== selectedId) return { changed: false, message: undefined };
      this.role = role;
    }
    return { changed: true, message: organizations.length === 0 ? messages.noOrganizations : undefined };
  }
}
