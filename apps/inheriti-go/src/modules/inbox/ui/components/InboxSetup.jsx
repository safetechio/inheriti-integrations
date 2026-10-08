import { ChevronLeftIcon, LockIcon } from '../../../_shared/ui/components/Icons.jsx';

export function InboxSetup({ onClose, onRetry, onReplace, organizationSelected, state, error }) {
  const preparing = state?.status === 'preparing';
  const failed = state?.status === 'error' || state?.status === 'unavailable' || !!error;
  const replacementRequired = state?.status === 'replacement_required';
  const message = !organizationSelected ? 'Select an organization on the home screen to set up Secure Chat.'
    : preparing ? state?.message || 'Setting up this computer…'
    : failed || replacementRequired ? error || state?.message || 'Secure Chat setup could not finish.'
    : 'Checking this computer…';

  return <main className="tray-screen inbox-panel">
    <header className="tray-screen-header tray-screen-heading inbox-header">
      <button className="tray-back" type="button" aria-label="Back to home" onClick={onClose}><ChevronLeftIcon /></button>
      <h1>Secure Chat</h1>
    </header>
    <div className="tray-scroll inbox-setup">
      <div className="inbox-setup-heading">
        <span className="inbox-setup-icon" aria-hidden="true"><LockIcon /></span>
        <h2>Set up Secure Chat</h2>
      </div>
      <div className="inbox-setup-status" role="status">{organizationSelected && !failed && !replacementRequired && <span className="inbox-setup-spinner" aria-hidden="true" />}<p>{message}</p></div>
      {organizationSelected && replacementRequired && <p>Replacing Secure Chat access on this computer will remove access to protected messages sent to the previous keys. Past Secure Chat history cannot be recovered on this computer.</p>}
      {organizationSelected && replacementRequired && <button type="button" onClick={onReplace}>Reset Secure Chat on this computer</button>}
      {organizationSelected && failed && !replacementRequired && <button type="button" onClick={onRetry}>Try setup again</button>}
      {!organizationSelected && <button type="button" onClick={onClose}>Choose organization</button>}
    </div>
  </main>;
}
