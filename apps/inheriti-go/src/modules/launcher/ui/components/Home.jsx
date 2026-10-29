import { useEffect, useRef } from 'react';
import { AccountAvatar } from '../../../_shared/ui/components/AccountAvatar.jsx';
import { ChevronDownIcon, ChevronRightIcon, EditIcon, ExternalLinkIcon, LockIcon, PlusIcon } from '../../../_shared/ui/components/Icons.jsx';

export function organizationDisplayName(organization, organizations = []) {
  if (organizations.filter(({ name }) => name === organization.name).length < 2) return organization.name;
  const suffix = organization.id.slice(-8);
  const ambiguous = organizations.some(({ id, name }) => name === organization.name && id !== organization.id && id.endsWith(suffix));
  return `${organization.name} · ${ambiguous ? organization.id : suffix}`;
}

export function Home({ messages, organizations, selectedId, onOrganizationChange, accounts = [], activeSubject, onChooseAccount, onAddAccount, showPlanActions, canCreate, canEdit, onCreate, onEdit, onOpenInbox, inboxHasNew, onOpenApp, onSignOut, onSignOutAll, signOutDisabled, status, notice, accountName, accountRole, pendingInboxControls }) {
  const accountMenuRef = useRef(null);
  useEffect(() => {
    const closeOutside = (event) => {
      if (accountMenuRef.current?.open && !accountMenuRef.current.contains(event.target)) accountMenuRef.current.open = false;
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape' && accountMenuRef.current?.open) {
        accountMenuRef.current.open = false;
        accountMenuRef.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeOnEscape); };
  }, []);
  const firstName = accountName?.trim().split(/\s+/u)[0];
  const otherAccounts = accounts.filter((account) => account.subject !== activeSubject);
  return <main className="tray-screen tray-home">
    <p id="status" className="sr-only" role="status">{status}</p>
    <header className="tray-home-header">
      <label className="tray-organization-picker">
        <span className="sr-only">{messages.organization}</span>
        <select id="organization" value={selectedId || ''} onChange={(event) => onOrganizationChange(event.target.value)} disabled={!organizations.length}>
          <option value="">{messages.chooseOrganization}</option>
          {organizations.map((organization) => <option value={organization.id} key={organization.id}>{organizationDisplayName(organization, organizations)}</option>)}
        </select>
        <ChevronDownIcon />
      </label>
      <details className="tray-account-menu" ref={accountMenuRef}>
        <summary aria-label="Open account menu" title={accountName || 'Your account'} tabIndex={0}><AccountAvatar name={accountName} online /></summary>
        <div className="tray-account-popover">
          <h2 className="sr-only">Saved accounts</h2>
          <div className="tray-account-group is-active">
            <AccountAvatar name={accountName} />
            <span className="tray-account-details"><strong title={accountName}>{accountName}</strong>{accountRole && <small>{accountRole}</small>}<small className="tray-account-status">{status}</small></span>
          </div>
          {otherAccounts.map((account) => <button className="tray-account-option" type="button" key={account.subject}
            disabled={signOutDisabled} onClick={() => account.status === 'ready' ? onChooseAccount(account) : onAddAccount()}>
            <AccountAvatar name={account.name} />
            <span><strong title={account.name}>{account.name}</strong>
              {account.status === 'sign-in-again' && <small>Sign in again</small>}</span>
          </button>)}
          <button id="add-account" type="button" disabled={signOutDisabled} onClick={onAddAccount}><span aria-hidden="true">＋</span>Add another account</button>
          <button id="sign-out" type="button" disabled={signOutDisabled} onClick={onSignOut}>Log out of this account</button>
          <button id="sign-out-all" type="button" disabled={signOutDisabled} onClick={onSignOutAll}>{otherAccounts.length ? 'Log out of all accounts' : 'Log out'}</button>
        </div>
      </details>
    </header>
    <div className="tray-scroll tray-home-content">
      {notice && <p className="tray-home-notice error" role="alert">{notice}</p>}
      {pendingInboxControls}
      <section className="tray-hero">
        <h1>Hello{firstName ? ` ${firstName}` : ''} 👋</h1><p>Protect a secret in a few steps.</p>
      </section>
      <div className="tray-home-section">
        <h2>Plan management</h2>
        <div className="tray-home-actions">
          {showPlanActions && <button id="save-plan" type="button" disabled={!canCreate} onClick={onCreate}>
            <span className="tray-action-icon"><PlusIcon /></span><span><strong>{messages.savePlan}</strong><small>Protect a secret in a new plan</small></span><span className="tray-action-arrow"><ChevronRightIcon /></span>
          </button>}
          {showPlanActions && <button id="add-asset" type="button" disabled={!canEdit} onClick={onEdit}>
            <span className="tray-action-icon"><EditIcon /></span><span><strong>{messages.addOrEditAsset}</strong><small>Update a plan that's already protected</small></span><span className="tray-action-arrow"><ChevronRightIcon /></span>
          </button>}
          <button id="app" type="button" onClick={onOpenApp}>
            <img src="tray.png" alt="" /><span><strong>{messages.openApp}</strong><small>Manage plans, teams and members</small></span><span className="tray-external-arrow"><ExternalLinkIcon /></span>
          </button>
        </div>
      </div>
      <div className="tray-home-section">
        <h2>Secure Chat</h2>
        <div className="tray-home-actions">
          <button id="open-inbox" type="button" disabled={!selectedId} onClick={onOpenInbox}>
            <span className="tray-action-icon"><LockIcon /></span><span><strong>Open Secure Chat</strong><small>Private messages and files</small></span>{inboxHasNew && <span className="inbox-unread-badge" aria-label="New message">•</span>}<span className="tray-action-arrow"><ChevronRightIcon /></span>
          </button>
        </div>
      </div>
    </div>
  </main>;
}
