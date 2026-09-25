import { ScreenFooter } from '../../_shared/ui/components/ScreenFooter.jsx';
import { PlanSummary } from './components/PlanSummary.jsx';
import { ExternalLinkIcon } from '../../_shared/ui/components/Icons.jsx';

export function ReadyPlan({ messages, state, readySummary, onNew, onOpenApp, onHome }) {
  const summary = readySummary || {};
  const teamId = summary.teamId || state.creation?.teamId;
  const audience = teamId
    ? state.teams.find(({ id }) => id === teamId)?.name || messages.teamAudience
    : messages.privateAudience;

  return <section id="ready" className="tray-screen plan-ready" aria-labelledby="ready-heading">
    <div className="tray-scroll plan-ready-content">
      <span className="plan-ready-check" aria-hidden="true"><svg viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="5,11.5 9,15.5 17,7" /></svg></span>
      <div><h2 id="ready-heading">{messages.ready}</h2><p>{messages.protected}</p></div>
      <PlanSummary planId={state.creation?.planId} title={summary.title || messages.ready} assetName={summary.assetName} assetType={messages.assetTypes[summary.assetType] || ''} audience={audience} protectedPlan messages={messages} />
    </div>
    <ScreenFooter><div className="plan-ready-actions">
      <button id="new-capture" type="button" onClick={onNew}>{messages.saveAnother}</button>
      <button className="button-secondary plan-open-business" type="button" onClick={onOpenApp}>{messages.viewInBusiness || 'View in Inheriti® Business'}<ExternalLinkIcon /></button>
      <button className="plan-home-action" type="button" onClick={onHome}>{messages.backToHome}</button>
    </div></ScreenFooter>
  </section>;
}
