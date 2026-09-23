export function ReviewPlan({ messages, state, form, busy, error, onEdit, onStartOver, onSubmit }) {
  const organizationName = state.organizations.find(({ id }) => id === state.selectedId)?.name || '';
  const audienceName = form.audience === 'team'
    ? state.teams.find(({ id }) => id === form.teamId)?.name || ''
    : messages.privateAudience;
  const creationError = state.creation?.status === 'error'
    ? state.creation.message || messages.secureError
    : '';

  return <section id="review" aria-labelledby="review-heading">
    <h2 id="review-heading">{messages.reviewPlan}</h2>
    <dl>
      <dt>{messages.organization}</dt><dd>{organizationName}</dd>
      <dt>{messages.audience}</dt><dd>{audienceName}</dd>
      <dt>{messages.title}</dt><dd>{form.title}</dd>
      <dt>{messages.assetType}</dt><dd>{messages.assetTypes[form.assetType] || ''}</dd>
      <dt>{messages.assetName}</dt><dd>{form.assetName}</dd>
    </dl>
    <p id="creation-status" role="status" aria-live="polite">
      {error || creationError || (busy ? messages.securing : '')}
    </p>
    <div className="buttons">
      <button id="edit-capture" type="button" disabled={busy} onClick={onEdit}>{messages.edit}</button>
      {state.creation?.status === 'error' && <button
        id="start-over" type="button" disabled={busy} onClick={onStartOver}
      >{messages.startOver}</button>}
      <button id="submit-capture" type="button" disabled={busy} onClick={onSubmit}>{messages.savePlan}</button>
    </div>
  </section>;
}
