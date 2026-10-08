import { useState } from 'react';
import { custodianShareCopy } from '@safetech/inheriti-elements-core/browser';
import { ScreenHeader } from '../../_shared/ui/components/ScreenHeader.jsx';
import { ScreenFooter } from '../../_shared/ui/components/ScreenFooter.jsx';

export function CustodianPrompt({ prompt, onCancel }) {
  const [error, setError] = useState('');
  const choice = custodianShareCopy.choice;
  const first = custodianShareCopy.firstAccess;
  const later = custodianShareCopy.laterAccess;

  async function select(device) {
    setError('');
    try { await window.inheritiTray.selectCustodianDevice(device); }
    catch { setError('Could not select the custodian device. Try again.'); }
  }

  async function submit(event) {
    event.preventDefault();
    const field = event.currentTarget.elements.namedItem('pin');
    const pin = field.value;
    field.value = '';
    setError('');
    try { await window.inheritiTray.submitSafeKeyProPin(pin); }
    catch { setError('Could not use that PIN. Check it and try again.'); }
  }

  return <section className="tray-screen custodian-screen" aria-label={choice.title}>
    <ScreenHeader title={prompt.kind === 'choice' ? choice.title : choice.proOption} onBack={onCancel} />
    <div className="tray-scroll custodian-content">
      {prompt.kind === 'choice' && <>
        <p>{choice.intro}</p>
        <fieldset className="custodian-options">
          <legend>{choice.question}</legend>
          <button type="button" onClick={() => void select('SK_MOBILE')}><img src="./safekey-mobile.png" alt="" /><span><strong>{choice.mobileOption}</strong><small>{choice.mobileDescription}</small></span></button>
          {prompt.proAvailable && <button type="button" onClick={() => void select('SK_PRO')}><img src="./safekey-pro.png" alt="" /><span><strong>{choice.proOption}</strong><small>{choice.proDescription}</small></span></button>}
        </fieldset>
      </>}
      {prompt.kind === 'connect' && <p role="status">{choice.proConnect}</p>}
      {prompt.kind === 'working' && <p role="status">{prompt.firstAccess ? 'Saving the custodian share to your SafeKey PRO…' : 'Reading the custodian share from your SafeKey PRO…'}</p>}
      {prompt.kind === 'pin' && <form id="custodian-pin-form" onSubmit={(event) => void submit(event)}>
        <p>{prompt.firstAccess ? first.proPin : later.proPin}</p>
        {prompt.invalidPin && <p className="error" role="alert">SafeKey PRO rejected the PIN. Check it and try again.</p>}
        <label htmlFor="custodian-pin">SafeKey PRO PIN</label>
        <input id="custodian-pin" name="pin" type="password" autoComplete="off" maxLength={128} required autoFocus />
        <button type="submit">Continue</button>
      </form>}
      {prompt.kind === 'touch' && <p role="status">{choice.proTouch} ({prompt.attempt}/{prompt.limit})</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
    <ScreenFooter><button className="button-secondary" type="button" onClick={onCancel}>Cancel</button></ScreenFooter>
  </section>;
}
