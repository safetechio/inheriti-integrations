import { HOST_FEATURE_FLAGS } from '@safetech/inheriti-elements-core/node-base';

// Plan creation is available in the CLI; other hosts keep their own feature policy.
export const CLI_FEATURE_FLAGS = {
  local: { ...HOST_FEATURE_FLAGS.local, planCreation: true },
  dev: { ...HOST_FEATURE_FLAGS.dev, planCreation: true },
  stg: { ...HOST_FEATURE_FLAGS.stg, planCreation: true },
  prod: { ...HOST_FEATURE_FLAGS.prod, planCreation: true },
} as const;
