import { BUSINESS_DEPLOYMENTS } from '@safetech/inheriti-elements-core/node-base';

// Promote CLI usage; keep MCP plan creation, reveal and automation disabled until further notice.
export const MCP_FEATURE_FLAGS: Record<keyof typeof BUSINESS_DEPLOYMENTS, { planCreation: boolean; planReveal: boolean; automation: boolean }> = {
  local: { planCreation: false, planReveal: false, automation: false },
  dev: { planCreation: false, planReveal: false, automation: false },
  stg: { planCreation: false, planReveal: false, automation: false },
  prod: { planCreation: false, planReveal: false, automation: false },
};
