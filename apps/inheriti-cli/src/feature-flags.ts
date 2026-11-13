// Plan creation is available in every bound CLI build.
export const CLI_FEATURE_FLAGS = {
  local: { planCreation: true },
  dev: { planCreation: true },
  stg: { planCreation: true },
  prod: { planCreation: true },
} as const;
