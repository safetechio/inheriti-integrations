import { ScreenFooter } from '../../../_shared/ui/components/ScreenFooter.jsx';
import { ExternalLinkIcon } from '../../../_shared/ui/components/Icons.jsx';
import { useAppVersion } from '../hooks/useAppVersion.js';

export function SignedOut({ messages, status, authorizing, sessionUnavailable, accounts = [], activeSubject, onChooseAccount, onRestore, onSignIn, onCancelSignIn, onSignOutAll, onOpenApp }) {
  const version = useAppVersion();
  return <main className="tray-screen tray-signed-out">
    <div className="tray-sign-in-center">
      <img src="tray.png" alt="" className="tray-sign-in-logo" />
      <div><h1>{messages.appName}</h1><p id="status" role="status">{status}</p></div>
      <div className="tray-sign-in-actions">
        {sessionUnavailable && <button id="retry-session" type="button" onClick={onRestore}>{messages.retrySession}</button>}
        <button id="sign-in" type="button" className={sessionUnavailable ? 'button-secondary' : undefined} disabled={authorizing} onClick={onSignIn}>{messages.signIn}</button>
        {authorizing && <button id="sign-out" className="button-secondary" type="button" onClick={onCancelSignIn}>{messages.cancelSignIn}</button>}
        {!sessionUnavailable && <span>You'll continue in your browser.</span>}
      </div>
      {!authorizing && accounts.length > 0 && <div className="tray-recovery-accounts">
        <strong>Saved accounts</strong>
        {accounts.map((account) => <div key={account.subject}>
          <span title={account.name}>{account.name}{account.subject === activeSubject ? ' · Current account' : ''}</span>
          {account.subject !== activeSubject && account.status === 'ready' && <button type="button" className="button-secondary" onClick={() => onChooseAccount(account)}>Switch</button>}
          {account.status === 'sign-in-again' && <small>Sign in again</small>}
        </div>)}
        <button id="sign-out-all" type="button" className="button-secondary" onClick={onSignOutAll}>Sign out all accounts</button>
      </div>}
      {version && <small className="tray-version">Version {version}</small>}
    </div>
    <ScreenFooter><button id="app" className="tray-link" type="button" onClick={onOpenApp}>{messages.openApp}<ExternalLinkIcon /></button></ScreenFooter>
  </main>;
}
