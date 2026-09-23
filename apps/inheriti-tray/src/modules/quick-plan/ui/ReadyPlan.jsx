export function ReadyPlan({ messages, onNew }) {
  return <section id="ready" aria-labelledby="ready-heading">
    <h2 id="ready-heading">{messages.ready}</h2>
    <p>{messages.protected}</p>
    <button id="new-capture" type="button" onClick={onNew}>{messages.saveAnother}</button>
  </section>;
}
