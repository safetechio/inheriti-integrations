import type { PlanDetail } from '@safetech/inheriti-elements-core';

/**
 * A plan opens as a read-only JSON document rather than a webview: this extension contributes no HTML
 * surface at all, so there is nothing for a hostile page to reach.
 */
export function renderPlanDetail(plan: PlanDetail): string {
  return JSON.stringify(plan, null, 2);
}

export function planUriPath(planId: string): string {
  return `/${encodeURIComponent(planId)}.json`;
}

export function planIdFromUriPath(path: string): string {
  return decodeURIComponent(path.replace(/^\//u, '').replace(/\.json$/u, ''));
}
