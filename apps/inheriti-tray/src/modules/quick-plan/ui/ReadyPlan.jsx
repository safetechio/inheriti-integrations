export function ReadyPlan({ messages, state, onNew }) {
  const teamId = state.creation?.teamId;
  const audience = teamId
    ? state.teams.find(({ id }) => id === teamId)?.name || messages.teamAudience
    : messages.privateAudience;

  return <section id="ready" aria-labelledby="ready-heading">
    <h2 id="ready-heading">{messages.ready}</h2>
    <p>{messages.protected}</p>
    <p>{messages.audience}: {audience}</p>
    <button id="new-capture" type="button" onClick={onNew}>{messages.saveAnother}</button>
  </section>;
}
