import { ChevronLeftIcon } from './Icons.jsx';

export function ScreenHeader({ title, organizationName, onBack, backDisabled = false, step }) {
  return <header className="tray-screen-header">
    <div className="tray-screen-heading">
      {onBack && <button className="tray-back" type="button" onClick={onBack} disabled={backDisabled} aria-label="Back"><ChevronLeftIcon /></button>}
      <h1>{title}</h1>
      {organizationName && <span className="tray-header-organization">{organizationName}</span>}
    </div>
    {step && <div className="tray-stepper" aria-label={`Step ${step} of 2`}>
      <span className="tray-step is-active"><i />1 · Details</span>
      <span className={`tray-step ${step === 2 ? 'is-active' : ''}`}><i />2 · Review &amp; protect</span>
    </div>}
  </header>;
}
