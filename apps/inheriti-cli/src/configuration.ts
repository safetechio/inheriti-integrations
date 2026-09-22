import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { ElementsEnvironment } from '@safetech/inheriti-elements-core';
import { assertEnvironmentAllowed } from '@safetech/inheriti-elements-core';
import { BUSINESS_DEPLOYMENTS, BUSINESS_DEVICE_CLIENT_ID, BUSINESS_INTERACTIVE_CLIENT_ID, businessDeployment } from '@safetech/inheriti-elements-core/node';

export interface CliConfiguration {
  apiUrl: string;
  applicationId?: string;
  business?: boolean;
  issuer: string;
  clientId: string;
  /**
   * The interactive code + PKCE client shared with browser hosts in Business mode.
   * Falls back to `clientId` for existing standalone configurations.
   */
  interactiveClientId: string;
  environment: ElementsEnvironment;
  scopes: readonly string[];
  redirectUri: string;
  masterKeyPassphrase?: string;
  masterKeySalt?: string;
}

export class CliConfigurationInvalid extends Error {
  constructor(readonly code: string, detail: string) {
    super(detail);
    this.name = 'CliConfigurationInvalid';
  }
}

/** A development build has no business reaching production data, whatever the operator types. */
declare const __INHERITI_PRODUCTION_BUILD__: boolean;
declare const __INHERITI_DEPLOYMENT__: string;
export const IS_DEVELOPMENT_BUILD = typeof __INHERITI_PRODUCTION_BUILD__ !== 'boolean' || !__INHERITI_PRODUCTION_BUILD__;
export const BUILD_DEPLOYMENT = typeof __INHERITI_DEPLOYMENT__ === 'string'
  ? businessDeployment(__INHERITI_DEPLOYMENT__) : undefined;

const DEFAULT_SCOPES = ['openid', 'plan:list', 'plan:read', 'plan:reveal', 'asset:copy'] as const;

/** Where an installed CLI keeps its configuration when no environment says otherwise. */
export function defaultConfigurationPath(
  environmentVariables: Readonly<Record<string, string | undefined>>,
): string {
  if (environmentVariables.INHERITI_ELEMENTS_CONFIG) return environmentVariables.INHERITI_ELEMENTS_CONFIG;
  const home = environmentVariables.HOME ?? homedir();
  const base = environmentVariables.XDG_CONFIG_HOME ?? resolve(home, '.config');
  return resolve(base, 'inheriti-elements', 'config.json');
}

const FILE_KEYS: Readonly<Record<string, string>> = {
  apiUrl: 'INHERITI_ELEMENTS_API_URL',
  applicationId: 'INHERITI_ELEMENTS_APPLICATION_ID',
  issuer: 'INHERITI_ELEMENTS_ISSUER',
  clientId: 'INHERITI_ELEMENTS_CLIENT_ID',
  environment: 'INHERITI_ELEMENTS_ENVIRONMENT',
  interactiveClientId: 'INHERITI_ELEMENTS_INTERACTIVE_CLIENT_ID',
  redirectUri: 'INHERITI_ELEMENTS_REDIRECT_URI',
  masterKeyPassphrase: 'INHERITI_ELEMENTS_MASTER_KEY_PASSPHRASE',
  masterKeySalt: 'INHERITI_ELEMENTS_MASTER_KEY_SALT',
};

/**
 * The configuration file an installed CLI reads, flattened onto the variable names the rest of this
 * module already speaks. An exported variable still wins: the file is the default, never an override.
 */
function readConfigurationFile(
  environmentVariables: Readonly<Record<string, string | undefined>>,
): { values: Record<string, string | undefined>; business: boolean; deployment?: keyof typeof BUSINESS_DEPLOYMENTS } {
  const path = defaultConfigurationPath(environmentVariables);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return { values: {}, business: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliConfigurationInvalid('configuration_file_invalid', `${path} is not valid JSON.`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CliConfigurationInvalid('configuration_file_invalid', `${path} must hold a JSON object.`);
  }
  const values: Record<string, string | undefined> = {};
  const business = (parsed as Record<string, unknown>).business;
  const deploymentValue = (parsed as Record<string, unknown>).deployment;
  const deployment = businessDeployment(deploymentValue);
  if (deploymentValue !== undefined && deployment === undefined) {
    throw new CliConfigurationInvalid('configuration_file_invalid', `${path}: unknown Business deployment.`);
  }
  if (deployment !== undefined && business !== true) {
    throw new CliConfigurationInvalid('configuration_conflict', `${path}: deployment requires business: true.`);
  }
  if (business !== undefined && typeof business !== 'boolean') {
    throw new CliConfigurationInvalid('configuration_file_invalid', `${path}: "business" must be a boolean.`);
  }
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const name = FILE_KEYS[key];
    if (name === undefined) continue;
    if (typeof value !== 'string') {
      throw new CliConfigurationInvalid('configuration_file_invalid', `${path}: "${key}" must be a string.`);
    }
    values[name] = value;
  }
  return { values, business: business === true, ...(deployment ? { deployment } : {}) };
}

export function resolveConfiguration(
  processEnvironment: Readonly<Record<string, string | undefined>>,
  liveConfirmation?: string,
): CliConfiguration {
  if (BUILD_DEPLOYMENT) {
    return {
      ...BUSINESS_DEPLOYMENTS[BUILD_DEPLOYMENT],
      business: true,
      clientId: BUSINESS_DEVICE_CLIENT_ID,
      interactiveClientId: BUSINESS_INTERACTIVE_CLIENT_ID,
      scopes: ['openid'],
      redirectUri: 'http://127.0.0.1:53682/oauth/callback',
    };
  }
  const file = readConfigurationFile(processEnvironment);
  const preset = file.deployment === undefined ? {} : {
    INHERITI_ELEMENTS_API_URL: BUSINESS_DEPLOYMENTS[file.deployment].apiUrl,
    INHERITI_ELEMENTS_ISSUER: BUSINESS_DEPLOYMENTS[file.deployment].issuer,
    INHERITI_ELEMENTS_ENVIRONMENT: BUSINESS_DEPLOYMENTS[file.deployment].environment,
    INHERITI_ELEMENTS_CLIENT_ID: BUSINESS_DEVICE_CLIENT_ID,
    INHERITI_ELEMENTS_INTERACTIVE_CLIENT_ID: BUSINESS_INTERACTIVE_CLIENT_ID,
  };
  const environmentVariables: Record<string, string | undefined> = file.business
    ? { ...file.values, ...preset } : { ...file.values, ...defined(processEnvironment) };
  const environment = readEnvironment(environmentVariables.INHERITI_ELEMENTS_ENVIRONMENT);
  if (environment === 'LIVE' && IS_DEVELOPMENT_BUILD) {
    throw new CliConfigurationInvalid(
      'live_environment_unavailable_in_development_build',
      'This build supports TEST only. A production build is required for LIVE.',
    );
  }
  assertEnvironmentAllowed(environment, liveConfirmation);
  const masterKeyPassphrase = environmentVariables.INHERITI_ELEMENTS_MASTER_KEY_PASSPHRASE;
  const masterKeySalt = environmentVariables.INHERITI_ELEMENTS_MASTER_KEY_SALT;
  if ((masterKeyPassphrase === undefined) !== (masterKeySalt === undefined)) {
    throw new CliConfigurationInvalid(
      'master_key_configuration_incomplete',
      'Configure both masterKeyPassphrase and masterKeySalt, or neither.',
    );
  }
  if (file.business && environmentVariables.INHERITI_ELEMENTS_APPLICATION_ID) {
    throw new CliConfigurationInvalid('configuration_conflict', 'Business configuration must not include applicationId.');
  }
  return {
    apiUrl: required(environmentVariables, 'INHERITI_ELEMENTS_API_URL', 'apiUrl'),
    ...(file.business ? {} : { applicationId: required(environmentVariables, 'INHERITI_ELEMENTS_APPLICATION_ID', 'applicationId') }),
    business: file.business,
    issuer: required(environmentVariables, 'INHERITI_ELEMENTS_ISSUER', 'issuer'),
    clientId: required(environmentVariables, 'INHERITI_ELEMENTS_CLIENT_ID', 'clientId'),
    interactiveClientId: environmentVariables.INHERITI_ELEMENTS_INTERACTIVE_CLIENT_ID
      ?? required(environmentVariables, 'INHERITI_ELEMENTS_CLIENT_ID', 'clientId'),
    environment,
    scopes: file.business ? ['openid'] : DEFAULT_SCOPES,
    // The device grant never redirects, but the SDK's configuration requires the field.
    redirectUri: environmentVariables.INHERITI_ELEMENTS_REDIRECT_URI ?? 'http://127.0.0.1:53682/oauth/callback',
    ...(masterKeyPassphrase === undefined ? {} : { masterKeyPassphrase, masterKeySalt: masterKeySalt! }),
  };
}

function defined(
  environmentVariables: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environmentVariables).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

function readEnvironment(value: string | undefined): ElementsEnvironment {
  if (value === undefined || value === 'TEST') return 'TEST';
  if (value === 'LIVE') return 'LIVE';
  throw new CliConfigurationInvalid('environment_invalid', `Unknown environment ${value}. Use TEST or LIVE.`);
}

function required(environmentVariables: Readonly<Record<string, string | undefined>>, name: string, setting: string): string {
  const value = environmentVariables[name];
  if (!value) throw new CliConfigurationInvalid('configuration_missing', `Set ${setting} in the CLI configuration.`);
  return value;
}
