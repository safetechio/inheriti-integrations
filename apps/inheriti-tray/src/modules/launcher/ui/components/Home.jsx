import { ScreenFooter } from '../../../_shared/ui/components/ScreenFooter.jsx';
import { ChevronRightIcon, EditIcon, ExternalLinkIcon, LockIcon, PlusIcon } from '../../../_shared/ui/components/Icons.jsx';
import { useAppVersion } from '../hooks/useAppVersion.js';

export function Home({ messages, organizations, selectedId, onOrganizationChange, canCreate, canEdit, onCreate, onEdit, onOpenInbox, inboxHasNew, onOpenApp, onSignOut, signOutDisabled, status, notice, accountName }) {
  const version = useAppVersion();
  const initials = accountName?.trim().split(/\s+/u).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '✓';
  const firstName = accountName?.trim().split(/\s+/u)[0];
  return <main className="tray-screen tray-home">
    <p id="status" className="sr-only" role="status">{status}</p>
    <header className="tray-home-header">
      <img src="tray.png" alt="" />
      <strong>Inheriti<span>®</span> <em>tray</em></strong>
      <label className="tray-organization-picker">
        <span className="sr-only">{messages.organization}</span>
        <select id="organization" value={selectedId || ''} onChange={(event) => onOrganizationChange(event.target.value)} disabled={!organizations.length}>
          <option value="">{messages.chooseOrganization}</option>
          {organizations.map(({ id, name }) => <option value={id} key={id}>{name}</option>)}
        </select>
      </label>
    </header>
    <div className="tray-scroll tray-home-content">
      {notice && <p className="tray-home-notice error" role="alert">{notice}</p>}
      <section className="tray-hero">
        <h1>Hello{firstName ? ` ${firstName}` : ''} 👋</h1><p>Protect a secret in a few steps.</p>
      </section>
      <div className="tray-home-section">
        <h2>Protection plans</h2>
        <div className="tray-home-actions">
          <button id="save-plan" type="button" disabled={!canCreate} onClick={onCreate}>
            <span className="tray-action-icon"><PlusIcon /></span><span><strong>{messages.savePlan}</strong><small>Protect a secret in a new plan</small></span><span className="tray-action-arrow"><ChevronRightIcon /></span>
          </button>
          <button id="add-asset" type="button" disabled={!canEdit} onClick={onEdit}>
            <span className="tray-action-icon"><EditIcon /></span><span><strong>{messages.addOrEditAsset}</strong><small>Update a plan that's already protected</small></span><span className="tray-action-arrow"><ChevronRightIcon /></span>
          </button>
          <button id="app" type="button" onClick={onOpenApp}>
            <img src="tray.png" alt="" /><span><strong>{messages.openApp}</strong><small>Manage plans, teams and members</small></span><span className="tray-external-arrow"><ExternalLinkIcon /></span>
          </button>
        </div>
      </div>
      <div className="tray-home-section">
        <h2>Secure Inbox</h2>
        <div className="tray-home-actions"><button id="open-inbox" type="button" onClick={onOpenInbox}>
          <span className="tray-action-icon"><LockIcon /></span><span><strong>Open Secure Inbox</strong><small>Private messages and files</small></span>{inboxHasNew && <span className="inbox-unread-badge" aria-label="New protected message">•</span>}<span className="tray-action-arrow"><ChevronRightIcon /></span>
        </button></div>
      </div>
    </div>
    <ScreenFooter><div className="tray-account"><span className="tray-account-avatar">{initials}</span><span><strong>{accountName || 'Your account'}</strong><small><i />{status}{version && <span className="tray-version">· v{version}</span>}</small></span></div><button id="sign-out" type="button" disabled={signOutDisabled} onClick={onSignOut}>{messages.signOut}</button></ScreenFooter>
  </main>;
}
