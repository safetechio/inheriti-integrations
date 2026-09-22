import type { ElementsEnvironment } from '@safetech/inheriti-elements-core';
import { BUSINESS_DEPLOYMENTS, BUSINESS_INTERACTIVE_CLIENT_ID, businessDeployment } from '@safetech/inheriti-elements-core/browser';

/**
 * How this Application's master key comes into existence, as the plan service recorded it when the
 * Application was created. Declared once, server-side, and locked as soon as a plan exists — the
 * host mirrors it rather than choosing it.
 */
export type ChromeMasterKeyCustody = 'DERIVED' | 'EXTERNAL';

export interface ChromeConfiguration {
  apiUrl: string;
  issuer: string;
  clientId: string;
  applicationId?: string;
  environment: ElementsEnvironment;
  scopes: readonly string[];
  masterKeyCustody: ChromeMasterKeyCustody;
  /** The Application's Argon2 salt. `DERIVED` custody only; it is not secret. */
  masterKeySalt?: string;
  /** The operator's passphrase under `DERIVED`, or the key material itself under `EXTERNAL`. */
  masterKeySecret?: string;
}

export class ChromeConfigurationInvalid extends Error {
  public constructor(public readonly code: string, detail: string) {
    super(detail);
    this.name = 'ChromeConfigurationInvalid';
  }
}

/** A development build reaches TEST only, whatever is stored. */
declare const __INHERITI_PRODUCTION_BUILD__: boolean;
declare const __INHERITI_DEPLOYMENT__: string;
export const IS_DEVELOPMENT_BUILD = typeof __INHERITI_PRODUCTION_BUILD__ !== 'boolean' || !__INHERITI_PRODUCTION_BUILD__;
const LOCKED_DEPLOYMENT = typeof __INHERITI_DEPLOYMENT__ === 'string'
  ? businessDeployment(__INHERITI_DEPLOYMENT__) : undefined;

const SCOPES = ['openid', 'plan:list', 'plan:read', 'plan:reveal', 'asset:autofill'] as const;

export function resolveConfiguration(stored: Readonly<Record<string, unknown>>): ChromeConfiguration {
  if (LOCKED_DEPLOYMENT) {
    return {
      ...BUSINESS_DEPLOYMENTS[LOCKED_DEPLOYMENT],
      clientId: BUSINESS_INTERACTIVE_CLIENT_ID,
      scopes: ['openid'],
      masterKeyCustody: 'EXTERNAL',
    };
  }
  // An unconfigured host has to say so first. Deriving custody rules from an empty store reports a
  // missing salt, which reads as a broken Application rather than as a host nobody configured yet.
  const deploymentValue = optional(stored, 'deployment');
  const deployment = deploymentValue ? businessDeployment(deploymentValue) : undefined;
  if (deploymentValue && !deployment) throw new ChromeConfigurationInvalid('deployment_invalid', `Unknown deployment ${deploymentValue}.`);
  const applicationId = optional(stored, 'applicationId');
  if (deployment && applicationId) throw new ChromeConfigurationInvalid('configuration_conflict', 'Business deployment requires a blank Application id.');
  const preset = deployment ? BUSINESS_DEPLOYMENTS[deployment] : undefined;
  const identity = { apiUrl: preset?.apiUrl ?? required(stored, 'apiUrl'),
    issuer: preset?.issuer ?? required(stored, 'issuer'),
    clientId: preset ? BUSINESS_INTERACTIVE_CLIENT_ID : required(stored, 'clientId') };
  const environment = readEnvironment(preset?.environment ?? stored.environment);
  if (environment === 'LIVE' && IS_DEVELOPMENT_BUILD) {
    throw new ChromeConfigurationInvalid(
      'live_environment_unavailable_in_development_build',
      'This build supports TEST only.',
    );
  }
  if (applicationId === undefined) return { ...identity, environment, scopes: ['openid'], masterKeyCustody: 'EXTERNAL' };
  const custody = readCustody(stored.masterKeyCustody);
  const masterKeySalt = optional(stored, 'masterKeySalt');
  // The same rule the Application aggregate enforces: only DERIVED reproduces the key from a
  // secret, so only DERIVED carries a salt. A salt beside EXTERNAL means the two were configured
  // from different Applications, and deriving under it would produce a key nothing was sealed with.
  if (custody === 'DERIVED' && masterKeySalt === undefined) {
    throw new ChromeConfigurationInvalid('master_key_salt_required', 'DERIVED custody requires masterKeySalt.');
  }
  if (custody !== 'DERIVED' && masterKeySalt !== undefined) {
    throw new ChromeConfigurationInvalid('master_key_salt_unexpected', `${custody} custody carries no salt.`);
  }
  return {
    ...identity,
    applicationId,
    environment,
    scopes: SCOPES,
    masterKeyCustody: custody,
    ...(masterKeySalt === undefined ? {} : { masterKeySalt }),
    ...(optional(stored, 'masterKeySecret') === undefined ? {} : { masterKeySecret: optional(stored, 'masterKeySecret')! }),
  };
}

function readCustody(value: unknown): ChromeMasterKeyCustody {
  if (value === undefined || value === '' || value === 'DERIVED') return 'DERIVED';
  if (value === 'EXTERNAL') return 'EXTERNAL';
  throw new ChromeConfigurationInvalid('master_key_custody_invalid', `Unknown custody ${String(value)}.`);
}

function optional(stored: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = typeof stored[key] === 'string' ? (stored[key] as string).trim() : '';
  return value ? value : undefined;
}

function readEnvironment(value: unknown): ElementsEnvironment {
  if (value === undefined || value === '' || value === 'TEST') return 'TEST';
  if (value === 'LIVE') return 'LIVE';
  throw new ChromeConfigurationInvalid('environment_invalid', `Unknown environment ${String(value)}.`);
}

function required(stored: Readonly<Record<string, unknown>>, key: string): string {
  const value = typeof stored[key] === 'string' ? (stored[key] as string).trim() : '';
  if (!value) throw new ChromeConfigurationInvalid('configuration_missing', `${key} is required.`);
  return value;
}
