/** Business deployments. TEST/LIVE is the API classification, not the deployment selector. */
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
export const BUSINESS_DEVICE_CLIENT_ID = 'inheriti-business-integrations-device';
export const BUSINESS_INTERACTIVE_CLIENT_ID = 'inheriti-business-integrations-interactive';

export function businessDeployment(value: unknown): BusinessDeployment | undefined {
  return typeof value === 'string' && Object.hasOwn(BUSINESS_DEPLOYMENTS, value)
    ? value as BusinessDeployment : undefined;
}
