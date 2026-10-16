import type { AutomationProvider as Provider, AutomationTrust } from './automation-setup.js';

export const AUTOMATION_PROVIDERS = ['GITHUB', 'GOOGLE_CLOUD', 'AWS', 'PORTABLE'] as const satisfies readonly Provider[];

const trustMethods = {
  GITHUB: 'GITHUB_ACTIONS_OIDC',
  AWS: 'AWS_IAM_ROLE',
  GOOGLE_CLOUD: 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC',
  PORTABLE: 'PORTABLE_SIGNED_ASSERTION',
} as const satisfies Record<Provider, AutomationTrust['method']>;

export class AutomationProviderValue {
  static readonly values = AUTOMATION_PROVIDERS;

  private constructor(readonly value: Provider) {}

  static from(value: unknown): AutomationProviderValue {
    if (typeof value !== 'string' || !Object.prototype.hasOwnProperty.call(trustMethods, value)) {
      throw new Error('automation_provider_invalid');
    }
    return new AutomationProviderValue(value as Provider);
  }

  get trustMethod(): AutomationTrust['method'] {
    return trustMethods[this.value];
  }

  accepts(trust: AutomationTrust): boolean {
    return trust.method === this.trustMethod;
  }

  expectedAudience(connectionId: string, trust?: AutomationTrust): string | undefined {
    if (trust && !this.accepts(trust)) throw new Error('automation_provider_trust_invalid');
    if (this.value === 'GITHUB' || this.value === 'PORTABLE') return `urn:inheriti:automation:connection:${connectionId}`;
    if (!trust) throw new Error('automation_provider_trust_invalid');
    if (trust.method === 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC') return trust.audience;
    return undefined;
  }
}
