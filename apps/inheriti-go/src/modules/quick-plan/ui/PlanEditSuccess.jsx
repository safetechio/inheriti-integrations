import { ScreenHeader } from '../../_shared/ui/components/ScreenHeader.jsx';
import { ScreenFooter } from '../../_shared/ui/components/ScreenFooter.jsx';
import { ExternalLinkIcon } from '../../_shared/ui/components/Icons.jsx';
import { PlanSummary } from './components/PlanSummary.jsx';

export function PlanEditSuccess({ messages, planId, planName, replaced, onBack, onOpenApp }) {
  return <section className="tray-screen plan-ready" aria-labelledby="edit-ready-heading">
    <ScreenHeader title={messages.addOrEditAsset} onBack={onBack} />
    <div className="tray-scroll plan-ready-content">
      <span className="plan-ready-check" aria-hidden="true"><svg viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="5,11.5 9,15.5 17,7" /></svg></span>
      <div><h2 id="edit-ready-heading">{messages.ready}</h2><p>{replaced ? messages.assetUpdated : messages.assetAdded}</p></div>
      <PlanSummary planId={planId} title={planName} subtitle={messages.protected} protectedPlan messages={messages} />
    </div>
    <ScreenFooter><div className="plan-ready-actions">
      <button className="plan-open-business" type="button" onClick={onOpenApp}>{messages.viewInBusiness}<ExternalLinkIcon /></button>
      <button className="button-secondary" type="button" onClick={onBack}>{messages.backToHome}</button>
    </div></ScreenFooter>
  </section>;
}
