import type { SidePanelRequest } from '../../shared/messages.js';
import type { AccountSummary } from '../../shared/plan-view.js';
import { compactButton, el } from './dom.js';

type AccountAction = Extract<SidePanelRequest, { type: 'switch-account' | 'remove-account' | 'sign-out' }>;

export function renderAccounts(accountList: HTMLUListElement, accounts: readonly AccountSummary[],
  accountAction: (request: AccountAction, confirmation?: string) => Promise<void>): void {
  const active = accounts.find((account) => account.active);
  const names = new Map(accounts.map((account, index) => [account.id, displayName(account, index)]));
  const triggerAvatar = accountList.closest('.account-menu')?.querySelector('.account-trigger-avatar');
  if (triggerAvatar !== null && triggerAvatar !== undefined) triggerAvatar.textContent = initials(names.get((active ?? accounts[0])?.id ?? ''));
  accountList.replaceChildren(...[...accounts].sort((a, b) => Number(b.active) - Number(a.active)).map((account) => {
    const item = el('li');
    item.dataset.active = String(account.active);
    const needsSignIn = account.needsSignIn === true;
    const name = names.get(account.id) ?? 'Account';
    const identity = account.active || needsSignIn ? el('div', 'account-identity') : compactButton('');
    if (identity instanceof HTMLButtonElement) {
      identity.className = 'account-identity account-switch';
      identity.setAttribute('aria-label', `Switch to ${name}`);
      identity.addEventListener('click', () => {
        void accountAction({ type: 'switch-account', accountId: account.id }, `Switch to ${name}?`);
      });
    }
    identity.append(el('span', 'account-avatar', initials(name)));
    const identityText = el('span', 'account-identity-text');
    identityText.append(el('strong', 'account-label', name));
    if (needsSignIn) identityText.append(el('span', 'account-meta', 'Sign in again'));
    else if (account.active) identityText.append(el('span', 'account-meta account-status-signed', 'Signed in.'));
    identity.append(identityText);
    const row = el('div', 'account-row');
    row.append(identity);
    const actions = el('div', 'account-actions');
    const remove = compactButton('Remove');
    remove.setAttribute('aria-label', `Remove ${name} from this browser session`);
    remove.addEventListener('click', () => {
      void accountAction({ type: 'remove-account', accountId: account.id }, `Remove ${name} from this browser session?`);
    });
    actions.append(remove);
    row.append(actions);
    item.append(row);
    return item;
  }));
}

function displayName(account: AccountSummary, index: number): string {
  const label = account.label.trim();
  return !label || label.includes('@') || label === account.subject || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/iu.test(label)
    || label.startsWith('[') ? `Account ${index + 1}` : label;
}

function initials(label: string | undefined): string {
  const name = label?.trim() ?? '';
  return name.split(/\s+/u).slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase() || '?';
}
