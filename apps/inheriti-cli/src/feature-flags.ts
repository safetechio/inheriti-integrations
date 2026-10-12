import { BUSINESS_DEPLOYMENTS } from '@safetech/inheriti-elements-core/node-base';

export const CLI_FEATURE_FLAGS = {
  local: { automation: true },
  dev: { automation: false },
  stg: { automation: false },
  prod: { automation: false },
} as const satisfies Record<keyof typeof BUSINESS_DEPLOYMENTS, { automation: boolean }>;
