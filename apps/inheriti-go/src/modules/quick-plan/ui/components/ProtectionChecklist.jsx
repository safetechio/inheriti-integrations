export function ProtectionChecklist({ messages, creation, busy }) {
  const phases = Object.entries(messages.creationSteps);
  const phaseIndex = phases.findIndex(([phase]) => phase === creation?.phase);
  const keyDone = phaseIndex >= 0 || creation?.status === 'ready';
  const complete = keyDone ? Math.max(0, phaseIndex + (creation?.status === 'ready' ? 2 : 1)) : 0;
  const steps = [[null, messages.accessingKey], ...phases];

  return <div className="plan-protection"><h3>{messages.planProtection || 'Plan protection'} · {complete} of {steps.length}</h3>
    <ol className="plan-steps" aria-label={messages.planProtection || 'Plan protection'}>
      {steps.map(([phase, label], index) => {
        const status = index < complete ? 'done' : index === complete && busy ? 'current' : creation?.status === 'error' && index === complete ? 'failed' : 'waiting';
        const text = index === 0 && creation?.status === 'awaiting-key' ? `${label} · ${messages.waitingForSafeKey}` : label;
        return <li key={phase || 'key'} data-state={status} aria-current={status === 'current' ? 'step' : undefined}><span className="plan-step-dot" aria-hidden="true" />{text}</li>;
      })}
    </ol>
  </div>;
}
