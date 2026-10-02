import { ChevronLeftIcon, LockIcon } from '../../../_shared/ui/components/Icons.jsx';

export function InboxSetup({ onClose, onRetry, organizationSelected, state, error }) {
  const preparing = state?.status === 'preparing';
  const failed = state?.status === 'error' || state?.status === 'unavailable' || !!error;
  const message = !organizationSelected ? 'Select an organization on the home screen to set up Secure Inbox.'
    : preparing ? state?.message || 'Setting up this device…'
    : failed ? error || state?.message || 'Secure Inbox setup could not finish.'
    : 'Checking this device…';

  return <main className="tray-screen inbox-panel">
    <header className="tray-screen-header tray-screen-heading inbox-header">
      <button className="tray-back" type="button" aria-label="Back to home" onClick={onClose}><ChevronLeftIcon /></button>
      <h1>Secure Inbox</h1>
    </header>
    <div className="tray-scroll inbox-setup">
      <div className="inbox-setup-heading">
        <span className="inbox-setup-icon" aria-hidden="true"><LockIcon /></span>
        <h2>Set up Secure Inbox</h2>
      </div>
      <div className="inbox-setup-status" role="status">{organizationSelected && !failed && <span className="inbox-setup-spinner" aria-hidden="true" />}<p>{message}</p></div>
      {organizationSelected && failed && <button type="button" onClick={onRetry}>Try setup again</button>}
      {!organizationSelected && <button type="button" onClick={onClose}>Choose organization</button>}
    </div>
  </main>;
}
