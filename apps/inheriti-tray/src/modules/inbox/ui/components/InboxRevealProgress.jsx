const steps = ['Checking this device', 'Unlocking your message', 'Confirming the one-time read'];

export function InboxRevealProgress() {
  return <div className="inbox-reveal-progress" role="status" aria-label="Opening protected message">
    <span className="inbox-progress-track is-indeterminate" aria-hidden="true"><span /></span>
    <ol>{steps.map((step, index) => <li key={step}>
      <span className="inbox-reveal-step-mark" aria-hidden="true">{index + 1}</span>
      <span>{step}</span>
    </li>)}</ol>
  </div>;
}
