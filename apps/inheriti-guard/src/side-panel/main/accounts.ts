import type { SidePanelRequest } from '../../shared/messages.js';
import type { AccountSummary } from '../../shared/plan-view.js';
import { compactButton, el } from './dom.js';

type AccountAction = Extract<SidePanelRequest, { type: 'switch-account' | 'remove-account' | 'sign-out' }>;

export function renderAccounts(accountList: HTMLUListElement, accounts: readonly AccountSummary[],
  accountAction: (request: AccountAction, confirmation?: string) => Promise<void>): void {
  const active = accounts.find((account) => account.active);
  const names = new Map(accounts.map((account) => [account.id, accountDisplayName(account)]));
  const triggerAvatar = accountList.closest('.account-menu')?.querySelector('.account-trigger-avatar');
  if (triggerAvatar !== null && triggerAvatar !== undefined) triggerAvatar.textContent = initials(names.get((active ?? accounts[0])?.id ?? ''));
  accountList.replaceChildren(...[...accounts].sort((a, b) => Number(b.active) - Number(a.active)).map((account) => {
    const item = el('li');
    item.dataset.active = String(account.active);
    if (account.active) item.setAttribute('aria-current', 'true');
    const name = names.get(account.id) ?? 'Account';
    const identity = account.active ? el('div', 'account-identity') : compactButton('');
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
    if (account.email?.includes('@') && account.email !== name) identityText.append(el('span', 'account-meta', account.email));
    if (account.role?.trim()) identityText.append(el('span', 'account-meta', account.role.trim()));
    identity.append(identityText);
    const row = el('div', 'account-row');
    row.append(identity);
    const actions = el('div', 'account-actions');
    const remove = compactButton('×');
    remove.setAttribute('aria-label', `Unlink ${name} from this browser`);
    remove.title = `Unlink ${name} from this browser`;
    remove.addEventListener('click', () => {
      void accountAction({ type: 'remove-account', accountId: account.id }, `Unlink ${name}?`);
    });
    actions.append(remove);
    row.append(actions);
    item.append(row);
    return item;
  }));
}

export function accountDisplayName(account: AccountSummary): string {
  const label = account.label.trim();
  if (label && !label.includes('@') && label !== account.subject && !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/iu.test(label)
    && !label.startsWith('[')) return label;
  return 'Saved account';
}

function initials(label: string | undefined): string {
  const name = label?.trim() ?? '';
  return name.split(/\s+/u).slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase() || '?';
}
