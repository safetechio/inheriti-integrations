import { describe, expect, it } from 'vitest';
import { BUSINESS_DEPLOYMENTS, businessDeployment } from '../src/deployment.js';

describe('Business deployment selection', () => {
  it('resolves only the four owned API and issuer pairs', () => {
    expect(Object.keys(BUSINESS_DEPLOYMENTS)).toEqual(['local', 'dev', 'stg', 'prod']);
    expect(BUSINESS_DEPLOYMENTS).toEqual({
      local: { apiUrl: 'http://business.localhost:3400/integrations/', issuer: 'https://keycloak-inheriti-dev-3zyv3zh64a-uc.a.run.app/realms/test', environment: 'TEST' },
      dev: { apiUrl: 'https://business-api-dev.inheriti.com/integrations/', issuer: 'https://safeid-dev.safetech.io/realms/SafeID', environment: 'TEST' },
      stg: { apiUrl: 'https://business-api-stg.inheriti.com/integrations/', issuer: 'https://safeid-stg.safetech.io/realms/SafeID', environment: 'TEST' },
      prod: { apiUrl: 'https://business-api.inheriti.com/integrations/', issuer: 'https://safeid-prod.safetech.io/realms/SafeID', environment: 'LIVE' },
    });
    expect(businessDeployment('https://foreign.example')).toBeUndefined();
  });
});
