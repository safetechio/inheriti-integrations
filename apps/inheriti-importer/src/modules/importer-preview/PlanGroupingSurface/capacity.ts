import type { PlanDraft } from './types';

export function planCapacity(plan: PlanDraft) {
  const limit = Number.parseInt(plan.capacity.split('/')[1], 10);
  return Number.isFinite(limit) && limit > 0 ? limit : 10;
}

export function planUsage(plan: PlanDraft) {
  return Math.max(0, plan.assets);
}

export function hasPlanCapacity(plan: PlanDraft) {
  return planUsage(plan) < planCapacity(plan);
}

export function isPlanOverCapacity(plan: PlanDraft) {
  return planUsage(plan) > planCapacity(plan);
}
