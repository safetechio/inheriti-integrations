import React from 'react';
import { planAvatarSvg } from '@safetech/inheriti-elements-brand';

export function PlanSummary({ planId, title, assetName, assetType, audience, subtitle, protectedPlan = false, messages }) {
  return <div className="plan-summary">
    <img className="plan-summary-avatar" data-placeholder={!planId}
      src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(planAvatarSvg(planId || 'empty'))}`} alt="" />
    <div className="plan-summary-text"><strong>{title}</strong><small>{subtitle || (protectedPlan ? `${messages.audience}: ${audience}` : `${assetName} · ${assetType}`)}</small></div>
    <span className={protectedPlan ? 'plan-summary-badge protected' : 'plan-summary-badge'}>{protectedPlan ? (messages.protectedBadge || 'Protected') : audience}</span>
  </div>;
}
