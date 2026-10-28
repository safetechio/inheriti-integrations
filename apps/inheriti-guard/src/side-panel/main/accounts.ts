import type { SidePanelRequest } from '../../shared/messages.js';
import type { AccountSummary } from '../../shared/plan-view.js';
import { compactButton, el } from './dom.js';
import { organizationDisplayName } from './organizations.js';

type AccountAction = Extract<SidePanelRequest, { type: 'switch-account' | 'remove-account' | 'select-account-organization' | 'select-organization' | 'sign-out' }>;

export function renderAccounts(accountList: HTMLUListElement, accountStatus: HTMLParagraphElement, accounts: readonly AccountSummary[],
  accountAction: (request: AccountAction, confirmation?: string) => Promise<void>): void {
  accountList.replaceChildren(...accounts.map((account) => {
    const item = el('li');
    item.dataset.active = String(account.active);
    const needsSignIn = account.needsSignIn === true;
    item.append(el('strong', 'account-label', account.label),
      el('span', 'account-meta', `${account.environment} · ${account.active ? 'Active' : needsSignIn ? 'Sign in again' : 'Saved until browser exit'}`));
    const actions = el('div', 'account-actions');
    if (!account.active) {
      if (needsSignIn) item.append(el('span', 'account-meta', `Use Add account to sign in again as ${account.label}.`));
      else {
        const activate = compactButton('Switch');
        activate.addEventListener('click', () => {
          void accountAction({ type: 'switch-account', accountId: account.id }, `Switch to ${account.label}?`);
        });
        actions.append(activate);
      }
    }
    const remove = compactButton('Remove');
    remove.addEventListener('click', () => {
      void accountAction({ type: 'remove-account', accountId: account.id }, `Remove ${account.label} from this browser session?`);
    });
    actions.append(remove);
    item.append(actions);
    const organizations = account.organizations;
    if (organizations !== undefined && organizations.length > 0) {
      const destinations = el('ul', 'account-destinations');
      destinations.append(...organizations.map((organization) => {
        const name = organizationDisplayName(organization, organizations);
        const row = el('li');
        const choose = compactButton(name);
        choose.setAttribute('aria-label', `${name} under ${account.label}`);
        choose.addEventListener('click', () => {
          if (needsSignIn) { accountStatus.textContent = `Sign in again as ${account.label} before opening ${name}.`; return; }
          if (account.active) {
            void accountAction({ type: 'select-organization', organizationId: organization.id });
            return;
          }
          void accountAction({ type: 'select-account-organization', accountId: account.id, organizationId: organization.id },
            `Switch to ${account.label} and ${name}?`);
        });
        row.append(choose);
        return row;
      }));
      item.append(destinations);
    }
    return item;
  }));
}
