import { ScreenFooter } from '../../../_shared/ui/components/ScreenFooter.jsx';
import { ChevronRightIcon, EditIcon, ExternalLinkIcon } from '../../../_shared/ui/components/Icons.jsx';

export function Home({ messages, organizations, selectedId, onOrganizationChange, canCreate, canEdit, onCreate, onEdit, onOpenApp, onSignOut, signOutDisabled, status, notice, accountName }) {
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
        <button id="save-plan" type="button" disabled={!canCreate} onClick={onCreate}><span className="tray-plus" aria-hidden="true"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M6 2v8M2 6h8" /></svg></span>{messages.savePlan}</button>
      </section>
      <div className="tray-home-section">
        <h2>Protection plans</h2>
        <div className="tray-home-actions">
          <button id="add-asset" type="button" disabled={!canEdit} onClick={onEdit}>
            <span className="tray-action-icon"><EditIcon /></span><span><strong>{messages.addOrEditAsset}</strong><small>Update a plan that's already protected</small></span><span className="tray-action-arrow"><ChevronRightIcon /></span>
          </button>
          <button id="app" type="button" onClick={onOpenApp}>
            <img src="tray.png" alt="" /><span><strong>{messages.openApp}</strong><small>Manage plans, teams and members</small></span><span className="tray-external-arrow"><ExternalLinkIcon /></span>
          </button>
        </div>
      </div>
    </div>
    <ScreenFooter><div className="tray-account"><span className="tray-account-avatar">{initials}</span><span><strong>{accountName || 'Your account'}</strong><small><i />{status}</small></span></div><button id="sign-out" type="button" disabled={signOutDisabled} onClick={onSignOut}>{messages.signOut}</button></ScreenFooter>
  </main>;
}
