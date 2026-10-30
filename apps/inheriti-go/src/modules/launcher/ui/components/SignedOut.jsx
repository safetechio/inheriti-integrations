import { ScreenFooter } from '../../../_shared/ui/components/ScreenFooter.jsx';
import { ExternalLinkIcon } from '../../../_shared/ui/components/Icons.jsx';
import { AccountAvatar } from '../../../_shared/ui/components/AccountAvatar.jsx';
import { accountDisplayName } from './account-display-name.js';

export function SignedOut({ messages, status, authorizing, sessionUnavailable, accounts = [], activeSubject, onChooseAccount, onRemoveAccount, onRestore, onSignIn, onCancelSignIn, onSignOutAll, onOpenApp }) {
  const choosingAccount = !activeSubject && accounts.length > 0;
  const mustSignIn = status === messages.signInAgain;
  return <main className="tray-screen tray-signed-out">
    <div className="tray-sign-in-center">
      <img src="tray.png" alt="" className="tray-sign-in-logo" />
      <div><h1>{messages.appName}</h1><p id="status" role="status">{status}</p></div>
      <div className="tray-sign-in-actions">
        {sessionUnavailable && !mustSignIn && <button id="retry-session" type="button" onClick={onRestore}>{messages.retrySession}</button>}
        <button id="sign-in" type="button" className={sessionUnavailable && !mustSignIn ? 'button-secondary' : undefined} disabled={authorizing} onClick={onSignIn}>{choosingAccount ? 'Add another account' : mustSignIn ? 'Sign in again' : messages.signIn}</button>
        {authorizing && <button id="sign-out" className="button-secondary" type="button" onClick={onCancelSignIn}>{messages.cancelSignIn}</button>}
        {!sessionUnavailable && <span>You'll continue in your browser.</span>}
      </div>
      {!authorizing && accounts.length > 0 && <div className="tray-recovery-accounts">
        <strong>{choosingAccount ? 'Choose a saved account' : 'Saved accounts'}</strong>
        {accounts.map((account) => {
          const name = accountDisplayName(account);
          return <div className="tray-recovery-account" key={account.subject}>
            <AccountAvatar name={name} />
            <span className="tray-account-details"><strong title={name}>{name}</strong>{account.email && name !== account.email && <small>{account.email}</small>}{account.subject === activeSubject && <small>Selected</small>}{account.status === 'sign-in-again' && <small>Sign in again</small>}</span>
            {account.status === 'ready' && account.subject !== activeSubject && <button type="button" className="button-secondary" onClick={() => onChooseAccount(account)}>Switch</button>}
            <button type="button" className="tray-account-remove" aria-label={`Unlink ${name} from this device`} title={`Unlink ${name} from this device`} onClick={() => onRemoveAccount(account)}>×</button>
          </div>;
        })}
        <button id="sign-out-all" type="button" className="tray-recovery-logoff" onClick={onSignOutAll}>Sign out all accounts</button>
      </div>}
    </div>
    <ScreenFooter><button id="app" className="tray-link" type="button" onClick={onOpenApp}>{messages.openApp}<ExternalLinkIcon /></button></ScreenFooter>
  </main>;
}
