/** Business deployments. TEST/LIVE is the API classification, not the deployment selector. */
export const INTEGRATION_AUTHORITY: 'business' | 'safeid-oidc' = 'business';
export const BUSINESS_DEPLOYMENTS = {
  local: {
    apiUrl: 'http://business.localhost:3400/integrations/',
    issuer: 'https://keycloak-inheriti-dev-3zyv3zh64a-uc.a.run.app/realms/test',
    environment: 'TEST',
  },
  dev: {
    apiUrl: 'https://business-api-dev.inheriti.com/integrations/',
    issuer: 'https://safeid-dev.safetech.io/realms/SafeID',
    environment: 'TEST',
  },
  stg: {
    apiUrl: 'https://business-api-stg.inheriti.com/integrations/',
    issuer: 'https://safeid-stg.safetech.io/realms/SafeID',
    environment: 'TEST',
  },
  prod: {
    apiUrl: 'https://business-api.inheriti.com/integrations/',
    issuer: 'https://safeid-prod.safetech.io/realms/SafeID',
    environment: 'LIVE',
  },
} as const;

export type BusinessDeployment = keyof typeof BUSINESS_DEPLOYMENTS;
export const PROTECTED_FILE_FLAGS = {
  local: false,
  dev: false,
  stg: false,
  prod: false,
} as const satisfies Record<BusinessDeployment, boolean>;
export const HOST_FEATURE_FLAGS = {
  local: { planCreation: false, automation: true },
  dev: { planCreation: false, automation: true },
  stg: { planCreation: false, automation: false },
  prod: { planCreation: false, automation: false },
} as const satisfies Record<BusinessDeployment, { planCreation: boolean; automation: boolean }>;
export const BUSINESS_DEVICE_CLIENT_ID = 'inheriti-business-integrations-device';
export const BUSINESS_INTERACTIVE_CLIENT_ID = 'inheriti-business-integrations-interactive';

export function businessDeployment(value: unknown): BusinessDeployment | undefined {
  return typeof value === 'string' && Object.hasOwn(BUSINESS_DEPLOYMENTS, value)
    ? value as BusinessDeployment : undefined;
}

export function businessUiRpId(deployment: BusinessDeployment): string {
  return deployment === 'local' ? 'business.localhost' : deployment === 'prod'
    ? 'business.inheriti.com' : `business-${deployment}.inheriti.com`;
}
