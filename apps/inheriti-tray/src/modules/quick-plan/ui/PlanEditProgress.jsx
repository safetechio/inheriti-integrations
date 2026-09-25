import React from 'react';

const updateSteps = ['preparing', 'preflighting', 'distributing_validators', 'distributing_data', 'finalizing', 'verifying'];

const accessGroups = {
  acquiring_key: 'key', pending_dms: 'dms', pending_approvals: 'approval',
  pending_auth: 'auth', pending_moderation: 'moderation', revealing: 'validators',
  collecting_validators: 'validators', collecting_shares: 'shares',
  distributing_custodian_share: 'custodian', claiming_custodian_share: 'custodian', releasing_custodian_share: 'custodian',
  reconstructing: 'decrypt', opening_window: 'view', preparing_view: 'view',
};
const accessPreparation = new Set(['key', 'dms', 'approval', 'auth', 'moderation']);
const revealGroups = new Set(['validators', 'shares', 'custodian', 'decrypt', 'view']);

function ProgressSteps({ steps, label }) {
  return <ol className="edit-progress-steps" aria-label={label}>
    {steps.map(({ id, title, description, status }, index) => <li key={id} data-state={status} aria-current={status === 'current' ? 'step' : undefined}>
      <span className="edit-progress-number" aria-hidden="true">{status === 'done' ? '✓' : index + 1}</span>
      <div><strong>{title}</strong>{description && <span>{description}</span>}</div>
    </li>)}
  </ol>;
}

export function PlanEditProgress({ messages, edit, busy }) {
  const active = busy || edit.status === 'loading' || edit.status === 'saving';
  const updateIndex = updateSteps.indexOf(edit.phase);
  if (updateIndex >= 0 && (active || edit.status === 'error' || edit.status === 'recovery-required')) {
    return <ProgressSteps label={messages.editUpdateProgress} steps={updateSteps.map((phase, index) => ({
      id: phase, title: messages.editSteps[phase],
      status: index < updateIndex ? 'done' : index === updateIndex ? active ? 'current' : 'failed' : 'waiting',
      description: index === updateIndex ? active ? messages.inProgress : messages.stopped : '',
    }))} />;
  }

  if (!active && edit.status !== 'error') return null;
  if (!active && !edit.phase && !(edit.phaseHistory || []).length) return null;
  const phases = [...(edit.phaseHistory || []), edit.phase].filter(Boolean);
  const groups = phases.map((phase) => accessGroups[phase]).filter(Boolean);
  const preparation = [...new Set(groups.filter((group) => accessPreparation.has(group)))]
    .filter((group) => group !== 'approval' || !groups.some((item) => item === 'auth' || item === 'moderation'));
  if (edit.keyStatus && !preparation.includes('key')) preparation.push('key');
  const revealing = groups.some((group) => revealGroups.has(group));
  const visible = revealing
    ? [...preparation, 'validators', 'shares', ...(groups.includes('custodian') ? ['custodian'] : []), 'decrypt', 'view']
    : [...preparation];
  if (!revealing && ['loading_context', 'opening_edit', 'checking_edit', 'opening_plan'].includes(edit.phase)) visible.push('opening');
  if (visible.length === 0) {
    const title = messages.editSteps[edit.phase] || messages.loadingPlans;
    return <ProgressSteps label={messages.editAccessProgress} steps={[{ id: 'opening', title, status: active ? 'current' : 'failed' }]} />;
  }
  const reported = edit.keyStatus ? 'key' : accessGroups[edit.phase] || (visible.includes('opening') ? 'opening' : undefined);
  const current = visible.includes(reported) ? reported : visible.at(-1);
  return <ProgressSteps label={messages.editAccessProgress} steps={visible.map((group, index) => {
    const status = index < visible.indexOf(current) ? 'done' : group === current ? active ? 'current' : 'failed' : 'waiting';
    const copy = group === 'opening' ? { title: messages.editSteps[edit.phase], description: '', complete: '' } : messages.editAccessSteps[group];
    return {
      id: group, title: copy.title, status,
      description: status === 'done' ? copy.complete
        : group === 'key' && edit.keyStatus === 'accessing' ? messages.editPreparingKey
        : group === 'custodian' && messages.editCustodianSteps[edit.phase] ? messages.editCustodianSteps[edit.phase]
        : copy.description,
    };
  })} />;
}
