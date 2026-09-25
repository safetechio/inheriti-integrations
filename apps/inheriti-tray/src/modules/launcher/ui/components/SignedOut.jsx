import { ScreenFooter } from '../../../_shared/ui/components/ScreenFooter.jsx';
import { ExternalLinkIcon } from '../../../_shared/ui/components/Icons.jsx';

export function SignedOut({ messages, status, authorizing, onSignIn, onCancelSignIn, onOpenApp }) {
  return <main className="tray-screen tray-signed-out">
    <div className="tray-sign-in-center">
      <img src="tray.png" alt="" className="tray-sign-in-logo" />
      <div><h1>{messages.appName}</h1><p id="status" role="status">{status}</p></div>
      <div className="tray-sign-in-actions">
        <button id="sign-in" type="button" disabled={authorizing} onClick={onSignIn}>{messages.signIn}</button>
        {authorizing && <button id="sign-out" className="button-secondary" type="button" onClick={onCancelSignIn}>{messages.cancelSignIn}</button>}
        <span>You'll continue in your browser.</span>
      </div>
    </div>
    <ScreenFooter><button id="app" className="tray-link" type="button" onClick={onOpenApp}>{messages.openApp}<ExternalLinkIcon /></button></ScreenFooter>
  </main>;
}
