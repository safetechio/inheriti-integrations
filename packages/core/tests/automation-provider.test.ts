import { describe, expect, it } from 'vitest';
import { AutomationProviderValue } from '../src/automation-provider.js';
import type { AutomationTrust } from '../src/automation-setup.js';

describe('AutomationProviderValue', () => {
  it.each([
    ['GITHUB', 'GITHUB_ACTIONS_OIDC'],
    ['AWS', 'AWS_IAM_ROLE'],
    ['GOOGLE_CLOUD', 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC'],
    ['PORTABLE', 'PORTABLE_SIGNED_ASSERTION'],
  ] as const)('maps %s to its trust method', (value, method) => {
    const provider = AutomationProviderValue.from(value);
    expect(provider.value).toBe(value);
    expect(provider.trustMethod).toBe(method);
    expect(provider.accepts({ method } as AutomationTrust)).toBe(true);
  });

  it('rejects unknown values and mismatched trust', () => {
    expect(() => AutomationProviderValue.from('UNKNOWN')).toThrow('automation_provider_invalid');
    expect(() => AutomationProviderValue.from('__proto__')).toThrow('automation_provider_invalid');
    expect(AutomationProviderValue.from('AWS').accepts({ method: 'GITHUB_ACTIONS_OIDC' } as AutomationTrust)).toBe(false);
  });

  it('returns the provider-specific expected audience', () => {
    const id = '97d5493c-6e86-44a7-9079-df7a447624fa';
    expect(AutomationProviderValue.from('GITHUB').expectedAudience(id))
      .toBe(`urn:inheriti:automation:connection:${id}`);
    expect(AutomationProviderValue.from('GOOGLE_CLOUD').expectedAudience(id, { method: 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC', audience: 'https://example.test/workload', serviceAccountSubject: '123' }))
      .toBe('https://example.test/workload');
    expect(AutomationProviderValue.from('AWS').expectedAudience(id, { method: 'AWS_IAM_ROLE' } as AutomationTrust)).toBeUndefined();
    expect(AutomationProviderValue.from('PORTABLE').expectedAudience(id)).toBe(`urn:inheriti:automation:connection:${id}`);
    expect(() => AutomationProviderValue.from('AWS').expectedAudience(id, { method: 'GITHUB_ACTIONS_OIDC' } as AutomationTrust))
      .toThrow('automation_provider_trust_invalid');
    expect(() => AutomationProviderValue.from('PORTABLE').expectedAudience(id, { method: 'AWS_IAM_ROLE' } as AutomationTrust))
      .toThrow('automation_provider_trust_invalid');
    expect(() => AutomationProviderValue.from('GOOGLE_CLOUD').expectedAudience(id)).toThrow('automation_provider_trust_invalid');
  });

  it('lists each provider once for form options', () => {
    expect(AutomationProviderValue.values).toEqual(['GITHUB', 'GOOGLE_CLOUD', 'AWS', 'PORTABLE']);
  });
});
