export function InboxProgressSteps({ label, steps }) {
  return <div className="inbox-step-progress" role="status" aria-label={label}>
    <span className="inbox-progress-track is-indeterminate" aria-hidden="true"><span /></span>
    <ol>{steps.map((step, index) => <li key={step}>
      <span className="inbox-step-mark" aria-hidden="true">{index + 1}</span>
      <span>{step}</span>
    </li>)}</ol>
  </div>;
}
